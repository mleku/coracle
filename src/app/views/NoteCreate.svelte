<script lang="ts">
  import {onMount} from "svelte"
  import {nip19} from "nostr-tools"
  import {without, uniqBy, prop} from "ramda"
  import {throttle, quantify} from "hurdak"
  import {createEvent} from "paravel"
  import {writable} from "svelte/store"
  import {annotateMedia} from "src/util/misc"
  import {asNostrEvent} from "src/util/nostr"
  import Anchor from "src/partials/Anchor.svelte"
  import Card from "src/partials/Card.svelte"
  import Compose from "src/app/shared/Compose.svelte"
  import ImageInput from "src/partials/ImageInput.svelte"
  import FieldInline from "src/partials/FieldInline.svelte"
  import Toggle from "src/partials/Toggle.svelte"
  import Media from "src/partials/Media.svelte"
  import Content from "src/partials/Content.svelte"
  import Modal from "src/partials/Modal.svelte"
  import Input from "src/partials/Input.svelte"
  import Field from "src/partials/Field.svelte"
  import Heading from "src/partials/Heading.svelte"
  import RelayCard from "src/app/shared/RelayCard.svelte"
  import GroupSummary from "src/app/shared/GroupSummary.svelte"
  import NoteContent from "src/app/shared/NoteContent.svelte"
  import RelaySearch from "src/app/shared/RelaySearch.svelte"
  import {
    Publisher,
    mergeHints,
    displayRelay,
    getUserRelayUrls,
    getGroupRelayUrls,
    mention,
  } from "src/engine"
  import {toastProgress} from "src/app/state"
  import {router} from "src/app/router"
  import {
    env,
    session,
    signer,
    getEventHints,
    displayGroup,
    groups,
    publishToGroupsPublicly,
    publishToGroupsPrivately,
    deriveGroupAccess,
  } from "src/engine"

  export let quote = null
  export let pubkey = null
  export let group: string | null = quote?.group

  let q = ""
  let view = null
  let images = []
  let warning = null
  let compose = null
  let wordCount = 0
  let shouldWrap = true
  let showPreview = false
  let groupAddrs = group ? [group] : []
  let relays = writable(getUserRelayUrls("write"))
  let relaysDirty = false
  let canPostPrivately, canPostPublicly

  const groupOptions = session.derived($session => {
    const options = []

    for (const address of Object.keys($session.groups || {})) {
      const group = groups.key(address).get()

      if (group) {
        options.push(group)
      }
    }

    for (const address of groupAddrs) {
      options.push({address})
    }

    return uniqBy(prop("address"), options)
  })

  const onSubmit = async () => {
    const tags = []
    const content = compose.parse().trim()

    if (!content) {
      return
    }

    if (warning) {
      tags.push(["content-warning", warning])
    }

    if (quote) {
      tags.push(mention(quote.pubkey))

      // Re-broadcast the note we're quoting
      if (!groupAddrs.length) {
        Publisher.publish({
          relays: $relays,
          event: asNostrEvent(quote),
        })
      }
    }

    const template = createEvent(1, {content, tags})

    if (groupAddrs.length > 0) {
      if (shouldWrap) {
        const pubs = await publishToGroupsPrivately(groupAddrs, template, $relays)

        pubs[0].on("progress", toastProgress)
      } else {
        const pub = await publishToGroupsPublicly(groupAddrs, template, $relays)

        pub.on("progress", toastProgress)
      }
    } else {
      const pub = Publisher.publish({
        relays: $relays,
        event: await signer.get().signAsUser(template),
      })

      pub.on("progress", toastProgress)
    }

    router.clearModals()
  }

  const addImage = url => {
    images = images.concat(url)
    compose.write("\n" + url)
  }

  const removeImage = url => {
    const content = compose.parse()

    compose.clear()
    compose.write(content.replace(url, ""))

    images = without([url], images)
  }

  const addRelay = url => {
    q = ""
    relays.update($r => $r.concat(url))
    relaysDirty = true
  }

  const removeRelay = url => {
    relays.update(without([url]))
    relaysDirty = true
  }

  const setGroup = address => {
    // Reset this, it'll get reset reactively below
    shouldWrap = true

    if (groupAddrs.includes(address)) {
      groupAddrs = without([address], groupAddrs)
    } else {
      groupAddrs = groupAddrs.concat(address)
    }

    if (!relaysDirty) {
      if (groupAddrs.length > 0) {
        relays.set(mergeHints(groupAddrs.map(getGroupRelayUrls)))
      } else {
        relays.set(getUserRelayUrls("write"))
      }
    }
  }

  const togglePreview = () => {
    showPreview = !showPreview
  }

  const setWordCount = throttle(300, () => {
    if (compose) {
      wordCount = compose.parse().match(/\s+/g)?.length || 0
    }
  })

  const showSettings = () => {
    view = "settings"
  }

  const showGroups = () => {
    view = "groups"
  }

  const hideView = () => {
    q = ""
    view = null
  }

  $: {
    canPostPrivately = groupAddrs.length > 0
    canPostPublicly = true

    for (const address of groupAddrs) {
      const group = groups.key(address).get()
      const access = deriveGroupAccess(address).get()

      if (group.access === "open" || access !== "granted") {
        canPostPrivately = false
      } else if (group.access === "closed") {
        canPostPublicly = false
      }
    }

    shouldWrap = shouldWrap && canPostPrivately
  }

  onMount(() => {
    if (pubkey && pubkey !== $session.pubkey) {
      compose.mention(pubkey)
    }

    if (quote) {
      const nevent = nip19.neventEncode({id: quote.id, relays: getEventHints(quote)})

      compose.nevent("nostr:" + nevent)
    }
  })
</script>

<form on:submit|preventDefault={onSubmit}>
  <Content size="lg">
    <Heading class="text-center">Create a note</Heading>
    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <strong>What do you want to say?</strong>
          {#if $groupOptions.length > 0}
            <div
              class="flex items-center gap-2"
              class:cursor-pointer={!quote?.group}
              on:click={quote?.group ? null : showGroups}>
              <i class="fa fa-circle-nodes" />
              {#if groupAddrs.length === 1}
                {displayGroup(groups.key(groupAddrs[0]).get())}
              {:else}
                {quantify(groupAddrs.length, "group")}
              {/if}
            </div>
          {/if}
        </div>
        <div
          class="mt-4 rounded-xl border border-solid border-gray-6 p-3"
          class:bg-input={!showPreview}
          class:text-black={!showPreview}
          class:bg-gray-7={showPreview}>
          {#if showPreview}
            <NoteContent note={{content: compose.parse(), tags: []}} />
          {/if}
          <div class:hidden={showPreview}>
            <Compose on:keyup={setWordCount} bind:this={compose} {onSubmit} />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 text-gray-5">
          <small class="hidden sm:block">
            {wordCount} words
          </small>
          <span>•</span>
          <small on:click={togglePreview} class="cursor-pointer underline">
            {showPreview ? "Hide" : "Show"} Preview
          </small>
        </div>
      </div>
      {#if images.length > 0}
        <div class="columns-2 gap-2 lg:columns-3">
          {#each images as url}
            <div class="mb-2">
              <Media link={annotateMedia(url)} onClose={() => removeImage(url)} />
            </div>
          {/each}
        </div>
      {/if}
      <div class="flex gap-2">
        <Anchor tag="button" theme="button" type="submit" class="flex-grow text-center"
          >Send</Anchor>
        <ImageInput multi onChange={addImage} />
      </div>
      <small class="flex cursor-pointer items-center justify-end gap-4" on:click={showSettings}>
        <span><i class="fa fa-server" /> {$relays.length}</span>
        <span><i class="fa fa-warning" /> {warning || 0}</span>
      </small>
    </div>
  </Content>
</form>

{#if view}
  <Modal onEscape={hideView}>
    <form on:submit|preventDefault={(canPostPrivately || canPostPublicly) && hideView}>
      <Content>
        {#if view === "settings"}
          <div class="mb-4 flex items-center justify-center">
            <Heading>Note settings</Heading>
          </div>
          <Field icon="fa-warning" label="Content warnings">
            <Input bind:value={warning} placeholder="Why might people want to skip this post?" />
          </Field>
          {#if $env.FORCE_RELAYS.length === 0}
            <Field icon="fa-database" label="Select which relays to publish to">
              <div>
                {#each $relays as url}
                  <div
                    class="mb-2 mr-1 inline-block rounded-full border border-solid border-gray-1 px-2 py-1">
                    <button
                      type="button"
                      class="fa fa-times cursor-pointer"
                      on:click={() => removeRelay(url)} />
                    {displayRelay({url})}
                  </div>
                {/each}
              </div>
              <RelaySearch bind:q limit={3} hideIfEmpty>
                <div slot="item" let:relay>
                  <RelayCard {relay}>
                    <button
                      slot="actions"
                      class="underline"
                      on:click|preventDefault={() => addRelay(relay.url)}>
                      Add relay
                    </button>
                  </RelayCard>
                </div>
              </RelaySearch>
            </Field>
          {/if}
          <Anchor tag="button" theme="button" type="submit" class="w-full text-center">Done</Anchor>
        {:else if view === "groups"}
          <div class="mb-4 flex items-center justify-center">
            <Heading>Post to a group</Heading>
          </div>
          {#if canPostPrivately && canPostPublicly}
            <FieldInline label="Post privately">
              <Toggle bind:value={shouldWrap} />
              <p slot="info">
                When enabled, your note will only be visible to other members of the group.
              </p>
            </FieldInline>
          {/if}
          {#if !canPostPrivately && !canPostPublicly}
            <p class="rounded-full border border-solid border-danger bg-gray-8 px-4 py-2">
              You have selected a mix of public and private groups. Please choose one or the other.
            </p>
          {/if}
          <div>Select any groups you'd like to post to:</div>
          <div class="flex flex-col gap-2">
            {#each $groupOptions as g (g.address)}
              <Card invertColors interactive on:click={() => setGroup(g.address)}>
                <GroupSummary address={g.address}>
                  <div slot="actions">
                    {#if groupAddrs.includes(g.address)}
                      <i class="fa fa-circle-check text-accent" />
                    {/if}
                  </div>
                </GroupSummary>
              </Card>
            {/each}
          </div>
          <Anchor
            tag="button"
            theme="button"
            type="submit"
            class="text-center"
            disabled={!canPostPrivately && !canPostPublicly}>Done</Anchor>
        {/if}
      </Content>
    </form>
  </Modal>
{/if}
