import {prop} from "ramda"
import {sessions} from "src/engine/session/state"
import {getUserHints} from "src/engine/relays/utils"
import {load} from "src/engine/network/utils"
import {deletesLastUpdated} from "./state"

export const loadDeletes = () => {
  const since = deletesLastUpdated.get()
  const authors = Object.values(sessions.get()).map(prop("pubkey"))

  return load({
    relays: getUserHints("write"),
    filters: [{kinds: [5], authors, since}],
  })
}
