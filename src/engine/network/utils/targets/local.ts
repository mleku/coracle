import {uniq, prop} from "ramda"
import {sleep} from "hurdak"
import {Emitter, hasValidSignature, matchFilters} from "paravel"
import {LOCAL_RELAY_URL} from "src/util/nostr"
import {events, eventsByKind} from "src/engine/events/derived"

export class LocalTarget extends Emitter {
  constructor() {
    super()

    this.setMaxListeners(100)
  }

  get connections() {
    return []
  }

  async onREQ(subId, ...filters) {
    const {cache, getKey} = hasValidSignature

    // Make sure this is async, listeners don't otherwise get attached
    await sleep(10)

    const tryEvent = event => {
      if (event && matchFilters(filters, event)) {
        // Make sure we're not wasting time validating signatures
        cache.set(getKey([event]), true)

        this.emit("EVENT", LOCAL_RELAY_URL, subId, event)
      }
    }

    if (filters.length === 1 && filters[0].ids) {
      for (const id of filters[0].ids) {
        tryEvent(events.key(id).get())
      }
    } else {
      let $events

      // Optimization: only iterate over events with the kinds we want
      if (filters.every(prop("kinds"))) {
        const kinds = uniq(filters.flatMap(prop("kinds")))
        const $eventsByKind = eventsByKind.get()

        $events = kinds.flatMap(k => $eventsByKind[k] || [])
      } else {
        $events = events.get()
      }

      for (const event of $events) {
        tryEvent(event)
      }
    }
  }

  send(verb, subid, ...args) {
    if (verb === "REQ") {
      this.onREQ(subid, ...args)
    }
  }

  cleanup = () => {
    this.removeAllListeners()
  }
}
