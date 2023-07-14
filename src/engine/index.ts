import {Alerts} from "./components/Alerts"
import {Builder} from "./components/Builder"
import {Content} from "./components/Content"
import {Crypt} from "./components/Crypt"
import {Directory} from "./components/Directory"
import {Events} from "./components/Events"
import {Keys} from "./components/Keys"
import {Meta} from "./components/Meta"
import {Network} from "./components/Network"
import {Nip02} from "./components/Nip02"
import {Nip04} from "./components/Nip04"
import {Nip05} from "./components/Nip05"
import {Nip28} from "./components/Nip28"
import {Nip57} from "./components/Nip57"
import {Nip65} from "./components/Nip65"
import {Outbox} from "./components/Outbox"
import {PubkeyLoader} from "./components/PubkeyLoader"
import {Storage} from "./components/Storage"
import {User} from "./components/User"

export const createEngine = (engine, components) => {
  for (const component of components) {
    engine[component.name] = {}
  }

  const componentState = components.map(c => [c, c.contributeState?.(engine)])

  for (const [component, state] of componentState) {
    Object.assign(engine[component.name], state)
  }

  const componentSelectors = components.map(c => [c, c.contributeSelectors?.(engine)])

  for (const [component, selectors] of componentSelectors) {
    Object.assign(engine[component.name], selectors)
  }

  const componentActions = components.map(c => [c, c.contributeActions?.(engine)])

  for (const [component, actions] of componentActions) {
    Object.assign(engine[component.name], actions)
  }

  for (const component of components) {
    component.initialize?.(engine)
  }

  return engine
}

export const createDefaultEngine = Env => {
  return createEngine({Env}, [
    Alerts,
    Builder,
    Content,
    Crypt,
    Directory,
    Events,
    Keys,
    Meta,
    Network,
    Nip02,
    Nip04,
    Nip05,
    Nip28,
    Nip57,
    Nip65,
    Outbox,
    PubkeyLoader,
    Storage,
    User,
  ])
}