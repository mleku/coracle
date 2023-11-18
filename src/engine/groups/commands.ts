import {generatePrivateKey, getPublicKey} from "nostr-tools"
import {now, createEvent} from "paravel"
import {without, prop} from "ramda"
import {updateIn, randomId, filterVals} from "hurdak"
import {Naddr} from "src/util/nostr"
import {updateRecord} from "src/engine/core/commands"
import {Publisher} from "src/engine/network/utils"
import {pubkey, sessions} from "src/engine/session/state"
import {nip59, signer, session} from "src/engine/session/derived"
import {displayPubkey} from "src/engine/people/utils"
import {publishCommunitiesList} from "src/engine/lists/commands"
import {
  getPubkeyHints,
  getUserRelayUrls,
  getGroupHints,
  getGroupRelayUrls,
  mergeHints,
} from "src/engine/relays/utils"
import {groups, groupAdminKeys, groupSharedKeys} from "./state"
import {deriveGroupAccess, deriveAdminKeyForGroup, deriveSharedKeyForGroup} from "./utils"

// Key state management

export const initSharedKey = address => {
  const privkey = generatePrivateKey()
  const pubkey = getPublicKey(privkey)
  const key = {
    group: address,
    pubkey: pubkey,
    privkey: privkey,
    created_at: now(),
    members: [],
  }

  groupSharedKeys.key(pubkey).set(key)

  return key
}

export const initGroup = (members, relays) => {
  const id = randomId()
  const privkey = generatePrivateKey()
  const pubkey = getPublicKey(privkey)
  const address = `34550:${pubkey}:${id}`
  const sharedKey = initSharedKey(address)
  const adminKey = {
    group: address,
    pubkey: pubkey,
    privkey: privkey,
    created_at: now(),
    relays,
    members,
  }

  groupAdminKeys.key(pubkey).set(adminKey)

  groups.key(address).set({id, pubkey, address, relays})

  return {id, address, adminKey, sharedKey}
}

// Utils for publishing

export const getGroupPublishRelays = (address, overrides = null) => {
  if (overrides?.length > 0) {
    return overrides
  }

  const canonical = getGroupRelayUrls(address)

  if (canonical.length > 0) {
    return canonical
  }

  return getGroupHints(address)
}

export const publishToGroupAdmin = async (address, template) => {
  const group = groups.key(address).get()
  const {pubkey} = Naddr.fromTagValue(address)
  const relays = group?.relays || getUserRelayUrls("write")
  const event = await nip59.get().wrap(template, {
    wrap: {
      author: generatePrivateKey(),
      recipient: pubkey,
    },
  })

  return Publisher.publish({event, relays})
}

export const publishAsGroupAdminPublicly = async (address, template, relays = null) => {
  const adminKey = deriveAdminKeyForGroup(address).get()
  const event = await signer.get().signWithKey(template, adminKey.privkey)

  return Publisher.publish({event, relays: getGroupPublishRelays(relays)})
}

export const publishAsGroupAdminPrivately = async (address, template, relays = null) => {
  const adminKey = deriveAdminKeyForGroup(address).get()
  const sharedKey = deriveSharedKeyForGroup(address).get()

  const event = await nip59.get().wrap(template, {
    author: adminKey.privkey,
    wrap: {
      author: sharedKey.privkey,
      recipient: sharedKey.pubkey,
    },
  })

  return Publisher.publish({event, relays: getGroupPublishRelays(relays)})
}

export const publishToGroupsPublicly = async (addresses, template, relays = null) => {
  for (const address of addresses) {
    const {access} = groups.key(address).get()

    if (access === "closed") {
      throw new Error("Attempted to publish publicly to a closed group")
    }

    template.tags.push(["a", address])
  }

  return Publisher.publish({
    event: await signer.get().signAsUser(template),
    relays: relays || mergeHints(addresses.map(getGroupPublishRelays)),
  })
}

export const publishToGroupsPrivately = async (addresses, template, relays = null) => {
  const pubs = []
  for (const address of addresses) {
    const thisTemplate = updateIn("tags", (tags: string[][]) => [...tags, ["a", address]], template)
    const {access} = groups.key(address).get()
    const sharedKey = deriveSharedKeyForGroup(address).get()
    const userAccess = deriveGroupAccess(address).get()

    if (access === "open") {
      throw new Error("Attempted to publish privately to a group that does not allow it")
    }

    if (userAccess !== "granted") {
      throw new Error("Attempted to publish privately to a group the user is not a member of")
    }

    const event = await nip59.get().wrap(thisTemplate, {
      wrap: {
        author: sharedKey.privkey,
        recipient: sharedKey.pubkey,
      },
    })

    pubs.push(
      Publisher.publish({event, relays: relays || mergeHints(addresses.map(getGroupPublishRelays))})
    )
  }

  return pubs
}

// Admin functions

export const publishKeyRotations = async (address, pubkeys, template) => {
  const adminKey = deriveAdminKeyForGroup(address).get()

  return await Promise.all(
    pubkeys.map(async pubkey => {
      const relays = getPubkeyHints(pubkey, "read")
      const event = await nip59.get().wrap(template, {
        author: adminKey.privkey,
        wrap: {
          author: generatePrivateKey(),
          recipient: pubkey,
        },
      })

      return Publisher.publish({event, relays})
    })
  )
}

export const publishGroupInvites = async (address, pubkeys, relays, gracePeriod = 0) => {
  const template = createEvent(24, {
    tags: [
      ["a", address],
      ["grace_period", String(gracePeriod)],
      ["privkey", deriveSharedKeyForGroup(address).get().privkey],
      ...relays.map(url => ["relay", url]),
    ],
  })

  return publishKeyRotations(address, pubkeys, template)
}

export const publishGroupEvictions = async (address, pubkeys, gracePeriod) => {
  const template = createEvent(24, {
    tags: [
      ["a", address],
      ["grace_period", String(gracePeriod)],
    ],
  })

  publishKeyRotations(address, pubkeys, template)
}

export const publishGroupMeta = async (address, meta) => {
  const template = createEvent(34550, {
    tags: [
      ["d", meta.id],
      ["name", meta.name],
      ["image", meta.image],
      ["description", meta.description],
      ["access", meta.access],
      ...meta.relays.map(url => ["relay", url]),
    ],
  })

  return meta.access === "closed"
    ? publishAsGroupAdminPrivately(address, template, meta.relays)
    : publishAsGroupAdminPublicly(address, template, meta.relays)
}

// Member functions

export const modifyGroupStatus = (session, address, timestamp, updates) => {
  session.groups = session.groups || {}
  session.groups[address] = updateRecord(session.groups[address], timestamp, updates)

  return session
}

export const setGroupStatus = (pubkey, address, timestamp, updates) =>
  sessions.update($sessions => ({
    ...$sessions,
    [pubkey]: modifyGroupStatus($sessions[pubkey], address, timestamp, updates),
  }))

export const resetGroupAccess = address =>
  setGroupStatus(pubkey.get(), address, now(), {access: null})

export const publishGroupEntryRequest = address => {
  setGroupStatus(pubkey.get(), address, now(), {access: "requested"})

  return publishToGroupAdmin(
    address,
    createEvent(25, {
      content: `${displayPubkey(pubkey.get())} would like to join the group`,
      tags: [["a", address]],
    })
  )
}

export const publishGroupExitRequest = address => {
  setGroupStatus(pubkey.get(), address, now(), {access: null})

  return publishToGroupAdmin(
    address,
    createEvent(26, {
      content: `${displayPubkey(pubkey.get())} is leaving the group`,
      tags: [["a", address]],
    })
  )
}

export const joinPublicGroup = address =>
  publishCommunitiesList(
    Object.keys(filterVals(prop("joined"), session.get().groups)).concat(address)
  )

export const leavePublicGroup = address =>
  publishCommunitiesList(
    without([address], Object.keys(filterVals(prop("joined"), session.get().groups)))
  )

export const joinGroup = address => {
  const group = groups.key(address)

  if (group.get()?.access === "open") {
    joinPublicGroup(address)
  } else {
    publishGroupEntryRequest(address)
  }
}

export const leaveGroup = address => {
  const group = groups.key(address)

  if (group.get().access === "open") {
    leavePublicGroup(address)
  } else {
    publishGroupExitRequest(address)
  }
}
