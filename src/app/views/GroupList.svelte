<script>
  import {onMount, onDestroy} from "svelte"
  import {derived} from "svelte/store"
  import {partition} from "ramda"
  import {fuzzy, createScroller} from "src/util/misc"
  import {getModal} from "src/partials/state"
  import Content from "src/partials/Content.svelte"
  import Anchor from "src/partials/Anchor.svelte"
  import Input from "src/partials/Input.svelte"
  import GroupListItem from "src/app/views/GroupListItem.svelte"
  import {groups, loadGroups, deriveGroupAccess, session} from "src/engine"

  const loadMore = async () => {
    limit += 50
  }

  const scroller = createScroller(loadMore, {element: getModal()})

  const groupList = derived([groups, session], ([$groups, $session]) => {
    const [joined, other] = partition(g => deriveGroupAccess(g.address).get(), $groups)

    return {joined, other}
  })

  let q = ""
  let limit = 50

  $: searchGroups = fuzzy($groupList.other, {
    keys: [{name: "id", weight: 0.2}, "name", "description"],
  })

  document.title = "Groups"

  onMount(loadGroups)

  onDestroy(() => {
    scroller.stop()
  })
</script>

<Content>
  <div class="flex justify-between">
    <div class="flex items-center gap-2">
      <i class="fa fa-circle-nodes fa-lg" />
      <h2 class="staatliches text-2xl">Your groups</h2>
    </div>
    <Anchor modal theme="button-accent" href="/groups/new">
      <i class="fa-solid fa-plus" /> Create Group
    </Anchor>
  </div>
  {#each $groupList.joined as group (group.address)}
    <GroupListItem {group} />
  {:else}
    <p class="text-center py-8">You haven't yet joined any groups.</p>
  {/each}
  <div class="mb-2 border-b border-solid border-gray-6 pt-2" />
  <Input bind:value={q} type="text" wrapperClass="flex-grow" placeholder="Search groups">
    <i slot="before" class="fa-solid fa-search" />
  </Input>
  {#each searchGroups(q).slice(0, limit) as group (group.address)}
    <GroupListItem {group} />
  {/each}
</Content>
