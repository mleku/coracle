import {nip19} from "nostr-tools"
import type {Readable} from "svelte/store"
import {sortBy, nth, inc} from "ramda"
import {fuzzy} from "src/util/misc"
import {Tags} from "src/util/nostr"
import {Table, watch} from "src/util/loki"
import type {System} from "src/system/system"

export type Topic = {
  name: string
  count?: number
}

export type List = {
  name: string
  naddr: string
  pubkey: string
  tags: string[][]
  updated_at: number
  created_at: number
  deleted_at?: number
}

export class Content {
  system: System
  topics: Table<Topic>
  lists: Table<List>
  searchTopics: Readable<(query: string) => Topic[]>
  constructor(system) {
    this.system = system

    this.topics = new Table(system.key("content/topics"), "name", {sort: sortBy(e => -e.count)})

    this.lists = new Table(system.key("content/lists"), "naddr")

    this.searchTopics = watch(this.topics, () =>
      fuzzy(this.topics.all(), {keys: ["name"], threshold: 0.3})
    )

    const processTopics = e => {
      const tagTopics = Tags.from(e).topics()
      const contentTopics = Array.from(e.content.toLowerCase().matchAll(/#(\w{2,100})/g)).map(
        nth(1)
      )

      for (const name of tagTopics.concat(contentTopics)) {
        const topic = this.topics.get(name)

        this.topics.patch({name, count: inc(topic?.count || 0)})
      }
    }

    system.sync.addHandler(1, processTopics)
    system.sync.addHandler(42, processTopics)

    system.sync.addHandler(30001, e => {
      const {pubkey, kind, created_at} = e
      const name = Tags.from(e).getMeta("d")
      const naddr = nip19.naddrEncode({identifier: name, pubkey, kind})
      const list = this.lists.get(naddr)

      if (created_at < list?.updated_at) {
        return
      }

      this.lists.patch({
        ...list,
        name,
        naddr,
        pubkey,
        tags: e.tags,
        updated_at: created_at,
        created_at: list?.created_at || created_at,
        deleted_at: null,
      })
    })

    system.sync.addHandler(5, e => {
      Tags.from(e)
        .type("a")
        .values()
        .all()
        .forEach(naddr => {
          const list = this.lists.get(naddr)

          if (list) {
            this.lists.patch({
              naddr: list.naddr,
              deleted_at: e.created_at,
            })
          }
        })
    })
  }

  getLists = (spec = null) => this.lists.all({...spec, deleted_at: {$eq: null}})
}
