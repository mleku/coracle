import {getUserRelayUrls, mergeHints} from "src/engine/relays/utils"
import {load, subscribe} from "src/engine/network/utils"
import {getGroupReqInfo} from "./utils"

export const loadGroups = () => {
  const {admins, recipients, relays} = getGroupReqInfo()

  load({
    relays: mergeHints([relays, getUserRelayUrls("read")]),
    filters: [{kinds: [1059], "#p": recipients, limit: 1000}],
  })

  load({
    relays: getUserRelayUrls("read"),
    filters: [
      {kinds: [34550], authors: admins},
      {kinds: [34550], limit: 20},
    ],
  })
}

export const listenForGroupNotes = address => {
  const {recipients, relays} = getGroupReqInfo(address)

  return subscribe({relays, filters: [{kinds: [1059], "#p": recipients}]})
}
