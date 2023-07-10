import {last, sortBy, pick, uniq, fromPairs, pluck, without} from "ramda"
import {tryJson, now, tryFunc} from "src/util/misc"
import {Tags, channelAttrs} from "src/util/nostr"
import {Table} from "src/util/loki"
import type {System} from "src/system/system"

const getHints = e => pluck("url", Tags.from(e).relays())

export type Channel = {
  id: string
  type: "public" | "private"
  pubkey: string
  updated_at: number
  last_sent?: number
  last_received?: number
  last_checked?: number
  joined?: boolean
  hints: string[]
}

export type Message = {
  id: string
  channel: string
  pubkey: string
  created_at: number
  content: string
  tags: string[][]
}

export class Chat {
  system: System
  channels: Table<Channel>
  messages: Table<Message>
  constructor(system) {
    this.system = system

    this.channels = new Table(system.key("chat/channels"), "id", {
      sort: sortBy(x => {
        if (x.joined || x.type === "private") return 0
        if (!x.name || x.name.match(/test/i)) return Infinity

        return x.updated_at
      }),
    })

    this.messages = new Table(system.key("chat/messages"), "id", {
      sort: xs => {
        const channelIds = new Set(
          pluck("id", this.channels.all({$or: [{joined: true}, {type: "private"}]}))
        )

        return sortBy(x => (channelIds.has(x.id) ? 0 : x.created_at), xs)
      },
    })

    system.sync.addHandler(40, e => {
      const channel = this.channels.get(e.id)

      if (e.created_at < channel?.updated_at) {
        return
      }

      const content = tryJson(() => pick(channelAttrs, JSON.parse(e.content)))

      if (!content?.name) {
        return
      }

      this.channels.patch({
        id: e.id,
        type: "public",
        pubkey: e.pubkey,
        updated_at: now(),
        hints: getHints(e),
        ...content,
      })
    })

    system.sync.addHandler(41, e => {
      const channelId = Tags.from(e).getMeta("e")

      if (!channelId) {
        return
      }

      const channel = this.channels.get(channelId)

      if (e.created_at < channel?.updated_at) {
        return
      }

      if (e.pubkey !== channel?.pubkey) {
        return
      }

      const content = tryJson(() => pick(channelAttrs, JSON.parse(e.content)))

      if (!content?.name) {
        return
      }

      this.channels.patch({
        id: channelId,
        type: "public",
        pubkey: e.pubkey,
        updated_at: now(),
        hints: getHints(e),
        ...content,
      })
    })

    system.sync.addHandler(30078, async e => {
      if (Tags.from(e).getMeta("d") === "coracle/last_checked/v1") {
        await tryJson(async () => {
          const payload = await this.system.user.crypt.decryptJson(e.content)

          for (const key of Object.keys(payload)) {
            // Backwards compat from when we used to prefix id/pubkey
            const channelId = last(key.split("/"))
            const channel = this.channels.get(channelId)
            const last_checked = Math.max(payload[channelId], channel?.last_checked || 0)

            // A bunch of junk got added to this setting. Integer keys, settings, etc
            if (isNaN(last_checked) || last_checked < 1577836800) {
              continue
            }

            this.channels.patch({id: channelId, last_checked})
          }
        })
      }
    })

    system.sync.addHandler(30078, async e => {
      if (Tags.from(e).getMeta("d") === "coracle/rooms_joined/v1") {
        await tryJson(async () => {
          const channelIds = await this.system.user.crypt.decryptJson(e.content)

          // Just a bug from when I was building the feature, remove someday
          if (!Array.isArray(channelIds)) {
            return
          }

          this.channels.all({type: "public"}).forEach(channel => {
            if (channel.joined && !channelIds.includes(channel.id)) {
              this.channels.patch({id: channel.id, joined: false})
            } else if (!channel.joined && channelIds.includes(channel.id)) {
              this.channels.patch({id: channel.id, joined: true})
            }
          })
        })
      }
    })

    system.sync.addHandler(4, async e => {
      if (!this.system.user.canSign()) {
        return
      }

      const author = e.pubkey
      const recipient = Tags.from(e).type("p").values().first()

      if (![author, recipient].includes(this.system.user.getPubkey())) {
        return
      }

      if (this.messages.get(e.id)) {
        return
      }

      await tryFunc(async () => {
        const other = this.system.user.getPubkey() === author ? recipient : author

        this.messages.patch({
          id: e.id,
          channel: other,
          pubkey: e.pubkey,
          created_at: e.created_at,
          content: await this.system.user.crypt.decrypt(other, e.content),
          tags: e.tags,
        })

        if (this.system.user.getPubkey() === author) {
          const channel = this.channels.get(recipient)

          this.channels.patch({
            id: recipient,
            type: "private",
            last_sent: e.created_at,
            hints: uniq(getHints(e).concat(channel?.hints || [])),
          })
        } else {
          const channel = this.channels.get(author)

          this.channels.patch({
            id: author,
            type: "private",
            last_received: e.created_at,
            hints: uniq(getHints(e).concat(channel?.hints || [])),
          })
        }
      })
    })

    system.sync.addHandler(42, e => {
      if (this.messages.get(e.id)) {
        return
      }

      const tags = Tags.from(e)
      const channelId = tags.getMeta("e")
      const channel = this.channels.get(channelId)
      const hints = uniq(pluck("url", tags.relays()).concat(channel?.hints || []))

      this.messages.patch({
        id: e.id,
        channel: channelId,
        pubkey: e.pubkey,
        created_at: e.created_at,
        content: e.content,
        tags: e.tags,
      })

      this.channels.patch({
        id: channelId,
        type: "public",
        last_sent: e.created_at,
        hints,
      })
    })
  }

  setLastChecked = (channelId, timestamp) => {
    const lastChecked = fromPairs(
      this.channels.all({last_checked: {$type: "number"}}).map(r => [r.id, r.last_checked])
    )

    return this.system.user.setAppData("last_checked/v1", {...lastChecked, [channelId]: timestamp})
  }

  joinChannel = channelId => {
    const channelIds = uniq(pluck("id", this.channels.all({joined: true})).concat(channelId))

    return this.system.user.setAppData("rooms_joined/v1", channelIds)
  }

  leaveChannel = channelId => {
    const channelIds = without([channelId], pluck("id", this.channels.all({joined: true})))

    return this.system.user.setAppData("rooms_joined/v1", channelIds)
  }
}
