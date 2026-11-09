<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { inc as ipc, link, type Subscription } from '@napplet/sdk';
  import { createIntentRequest, parseIntentResult, type IntentRequest } from '@hyprgate/types';
  import {
    invokeNappletIntent,
    READING_QUEUE_ADD_TOPIC,
    createNoteViewerOpenIntentRequest,
    createNoteViewerOpenPayload,
    createProfileIntentRequest,
    parseReadingQueueAddPayload,
    resourceImage,
  } from '@hyprgate/utils';
  import {
    addQueueItem,
    groupedQueueItems,
    hasPlaceholderTitle,
    persistQueueState,
    queueTypeCounts,
    removeQueueItem,
    restoreQueueItem,
    restoreQueueState,
    selectedQueueItem,
    setQueueItemStatus,
    STATUS_LABELS,
    type QueueItem,
    type QueueItemStatus,
    type QueueItemType,
    type QueueState,
  } from './lib/reading-queue-store';
  import { resolveReference, TYPE_LABELS } from './lib/queue-reference';
  import { subscribeItemMetadata, type ItemMetadata } from './lib/queue-metadata';

  let state = $state.raw<QueueState>({ items: [], selectedId: null, filter: 'all' });
  let draftTarget = $state('');
  let draftTitle = $state('');
  let draftSummary = $state('');
  let draftError = $state<string | null>(null);
  let detailsOpen = $state(false);
  let targetInput = $state<HTMLInputElement | null>(null);
  let metadata = $state.raw<Record<string, ItemMetadata>>({});
  let removed = $state.raw<QueueItem | null>(null);
  let openMessage = $state<string | null>(null);
  let detailOpen = $state(false);
  let backButton = $state<HTMLButtonElement | null>(null);
  let metadataSub: Subscription | null = null;

  const groups = $derived(groupedQueueItems(state));
  const selected = $derived(selectedQueueItem(state));
  const counts = $derived(queueTypeCounts(state.items));
  const draftReference = $derived(draftTarget.trim() ? resolveReference(draftTarget) : null);
  const itemKeys = $derived(state.items.map((item) => `${item.id}\u0000${item.target}`).join('\n'));
  const filterTypes = $derived((Object.keys(TYPE_LABELS) as QueueItemType[]).filter((type) => counts[type] || state.filter === type));

  onMount(() => {
    restoreQueueState().then((restored) => {
      state = restored;
    });
    const sub = ipc.on(READING_QUEUE_ADD_TOPIC, (event) => {
      const capture = parseReadingQueueAddPayload(event.payload);
      if (!capture) return;
      state = addQueueItem(state, capture);
      persistQueueState(state);
    });
    return () => {
      sub.close();
      metadataSub?.close();
    };
  });

  // Only look things up again when the set of saved items changes, not on every click.
  $effect(() => {
    void itemKeys;
    metadataSub?.close();
    metadataSub = subscribeItemMetadata(state.items, (itemId, next) => {
      metadata = { ...metadata, [itemId]: next };
    });
  });

  function displayTitle(item: QueueItem): string {
    if (!hasPlaceholderTitle(item)) return item.title;
    if (metadata[item.id]?.title) return metadata[item.id]!.title!;
    if (item.type === 'profile') return `${item.target.slice(0, 12)}...${item.target.slice(-6)}`;
    if (item.type === 'relay') return item.target.replace(/^wss?:\/\//, '');
    return item.title;
  }

  function displaySummary(item: QueueItem): string {
    return item.summary || metadata[item.id]?.summary || '';
  }

  function sourceLabel(item: QueueItem): string {
    return item.source === 'reading-queue' || item.source === 'Manual' ? 'Saved by you' : `Sent from ${item.source}`;
  }

  async function selectItem(item: QueueItem): Promise<void> {
    state = { ...state, selectedId: item.id };
    openMessage = null;
    detailOpen = true;
    persistQueueState(state);
    await tick();
    if (backButton?.offsetParent) backButton.focus();
  }

  async function closeDetail(): Promise<void> {
    detailOpen = false;
    await tick();
    document.querySelector<HTMLElement>('.item.selected')?.focus();
  }

  function setFilter(filter: QueueState['filter']): void {
    state = { ...state, filter };
    persistQueueState(state);
  }

  function toggleStatus(item: QueueItem, status: QueueItemStatus): void {
    state = setQueueItemStatus(state, item.id, item.status === status ? 'queued' : status);
    persistQueueState(state);
  }

  function removeItem(item: QueueItem): void {
    removed = item;
    state = removeQueueItem(state, item.id);
    persistQueueState(state);
  }

  function undoRemove(): void {
    if (!removed) return;
    state = restoreQueueItem(state, removed);
    removed = null;
    persistQueueState(state);
  }

  function saveDraft(): void {
    const reference = resolveReference(draftTarget);
    if (!reference) {
      draftError = draftTarget.trim()
        ? "That doesn't look like something we can save. Try a note1, nevent1, naddr1, npub1, wss:// or https:// link."
        : 'Paste a link or reference first.';
      return;
    }
    draftError = null;
    removed = null;
    state = addQueueItem(state, {
      type: reference.type,
      target: draftTarget.trim().replace(/^nostr:/i, ''),
      title: draftTitle,
      summary: draftSummary,
      source: { napplet: 'reading-queue' },
    });
    if (state.filter !== 'all' && state.filter !== reference.type) state = { ...state, filter: 'all' };
    draftTarget = '';
    draftTitle = '';
    draftSummary = '';
    persistQueueState(state);
    targetInput?.focus();
  }

  // Forms don't submit under sandbox=allow-scripts, so Enter is handled by hand.
  function saveOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    saveDraft();
  }

  async function invokeNavigation(request: IntentRequest | null): Promise<void> {
    if (!request) {
      openMessage = "This item can't be opened.";
      return;
    }
    try {
      const result = parseIntentResult(await invokeNappletIntent(request));
      if (!result?.ok) openMessage = "Nothing is available to open this right now.";
    } catch {
      openMessage = "Nothing is available to open this right now.";
    }
  }

  function canOpen(item: QueueItem): boolean {
    return resolveReference(item.target, item.type) !== null;
  }

  async function openItem(item: QueueItem): Promise<void> {
    openMessage = null;
    const reference = resolveReference(item.target, item.type);
    if (!reference) {
      openMessage = "This item can't be opened.";
      return;
    }
    if (reference.kind === 'profile') {
      await invokeNavigation(createProfileIntentRequest({ pubkey: reference.pubkey }));
    } else if (reference.kind === 'relay') {
      await invokeNavigation(createIntentRequest({ archetype: 'relay-browser', action: 'inspect', payload: { relay: reference.url } }));
    } else if (reference.kind === 'web') {
      try {
        const result = await link.open(reference.url);
        if (!result.ok) openMessage = "That link didn't open.";
      } catch {
        openMessage = "That link didn't open.";
      }
    } else {
      // The note app locates an address through its nip19 form, and an event's can carry relay hints.
      const nip19 = /^(note|nevent|naddr)1/.test(item.target) ? { nip19: item.target } : {};
      const payload = createNoteViewerOpenPayload({
        target: reference.kind === 'event' ? { type: 'event', id: reference.id, ...nip19 } : { type: 'address', ...reference.address, ...nip19 },
        source: { napplet: 'reading-queue' },
      });
      await invokeNavigation(payload ? createNoteViewerOpenIntentRequest(payload) : null);
    }
  }
</script>

<main class="queue-shell">
  <header class="capture">
    <div class="capture-row">
      <input
        bind:this={targetInput}
        aria-label="Link or reference to save"
        aria-invalid={!!draftError}
        placeholder="Paste a note, person, relay or web link to save it"
        bind:value={draftTarget}
        oninput={() => (draftError = null)}
        onkeydown={saveOnEnter}
      />
      <button type="button" class="primary" onclick={saveDraft}>Add</button>
    </div>
    <div class="capture-meta">
      {#if draftError}
        <p class="draft-error" role="alert">{draftError}</p>
      {:else if draftReference}
        <p class="muted">Will save as: {TYPE_LABELS[draftReference.type].one}</p>
      {/if}
      <button type="button" class="link" aria-expanded={detailsOpen} onclick={() => (detailsOpen = !detailsOpen)}>
        {detailsOpen ? 'Hide title and note' : 'Add a title or note'}
      </button>
    </div>
    {#if detailsOpen}
      <div class="capture-row">
        <input aria-label="Title" placeholder="Title (optional)" bind:value={draftTitle} onkeydown={saveOnEnter} />
        <input aria-label="Note" placeholder="Why you saved it (optional)" bind:value={draftSummary} onkeydown={saveOnEnter} />
      </div>
    {/if}
  </header>

  {#if state.items.length > 0}
    <div class="filters" role="group" aria-label="Show">
      <button type="button" aria-pressed={state.filter === 'all'} onclick={() => setFilter('all')}>All <span class="count">{state.items.length}</span></button>
      {#each filterTypes as type (type)}
        <button type="button" aria-pressed={state.filter === type} onclick={() => setFilter(type)}>
          {TYPE_LABELS[type].many} <span class="count">{counts[type] ?? 0}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if removed}
    <div class="removed-note" role="status">
      <span>Removed {displayTitle(removed)}</span>
      <button type="button" class="link" onclick={undoRemove}>Undo</button>
    </div>
  {/if}

  <section class="content" class:detail-open={detailOpen && selected} class:no-selection={!selected}>
    <div class="groups" aria-label="Saved items">
      {#each groups as group (group.status)}
        <section class="group">
          <h2>{STATUS_LABELS[group.status]} <span class="count">{group.items.length}</span></h2>
          {#each group.items as item (item.id)}
            <button
              type="button"
              class="item"
              class:selected={selected?.id === item.id}
              class:done={item.status === 'done'}
              aria-current={selected?.id === item.id ? 'true' : undefined}
              onclick={() => selectItem(item)}
            >
              <span class="item-head">
                <span class="kind">{TYPE_LABELS[item.type].one}</span>
                <span class="title">{displayTitle(item)}</span>
              </span>
              {#if displaySummary(item) && displaySummary(item) !== displayTitle(item)}<span class="summary">{displaySummary(item)}</span>{/if}
            </button>
          {/each}
        </section>
      {/each}
      {#if state.items.length === 0}
        <div class="empty">
          <p class="empty-title">Nothing saved yet</p>
          <p class="empty-hint">Paste a note, person, relay or web link above and it'll wait here until you're ready for it.</p>
        </div>
      {:else if groups.length === 0}
        <div class="empty">
          <p class="empty-title">Nothing of that type saved</p>
          <button type="button" onclick={() => setFilter('all')}>Show everything</button>
        </div>
      {/if}
    </div>

    {#if selected}
      <aside class="detail" aria-label="Item detail">
        <button type="button" class="back" bind:this={backButton} onclick={closeDetail}>Back to your list</button>
        <p class="eyebrow">{TYPE_LABELS[selected.type].one} · {sourceLabel(selected)}</p>
        <div class="detail-title">
          {#if selected.type === 'profile'}
            <span class="avatar" aria-hidden="true">
              <span>{metadata[selected.id]?.title?.slice(0, 1).toUpperCase() ?? '?'}</span>
              {#if metadata[selected.id]?.picture}
                <img use:resourceImage={metadata[selected.id]?.picture} alt="" loading="lazy" />
              {/if}
            </span>
          {/if}
          <h2>{displayTitle(selected)}</h2>
        </div>
        {#if displaySummary(selected) && displaySummary(selected) !== displayTitle(selected)}
          <p class="detail-summary">{displaySummary(selected)}</p>
        {/if}
        <code title={selected.target}>{selected.target}</code>
        <div class="actions">
          {#if canOpen(selected)}
            <button type="button" class="primary" onclick={() => openItem(selected)}>Open</button>
          {/if}
          <button type="button" aria-pressed={selected.status === 'pinned'} onclick={() => toggleStatus(selected, 'pinned')}>
            {selected.status === 'pinned' ? 'Pinned ✓' : 'Pin'}
          </button>
          <button type="button" aria-pressed={selected.status === 'deferred'} onclick={() => toggleStatus(selected, 'deferred')}>
            {selected.status === 'deferred' ? 'Later ✓' : 'Later'}
          </button>
          <button type="button" aria-pressed={selected.status === 'done'} onclick={() => toggleStatus(selected, 'done')}>
            {selected.status === 'done' ? 'Done ✓' : 'Done'}
          </button>
          <button type="button" class="danger" onclick={() => removeItem(selected)}>Remove</button>
        </div>
        {#if openMessage}<p class="draft-error" role="alert">{openMessage}</p>{/if}
      </aside>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--hg-bg, #070707);
    color: var(--hg-text, #f3f1e8);
    font-family: var(--hg-font-body, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }

  .queue-shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .capture {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--hg-surface, #101010);
    border-bottom: 1px solid var(--hg-border, #303030);
  }

  .capture-row {
    display: flex;
    gap: 8px;
  }

  .capture-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    min-height: 18px;
  }

  .capture-meta .link {
    margin-left: auto;
  }

  input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-bg, #070707);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
  }

  input:focus {
    outline: none;
    border-color: var(--hg-accent, #9ee493);
  }

  input[aria-invalid='true'] {
    border-color: var(--hg-accent-danger, #ff6b6b);
  }

  button {
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #111);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 7px 10px;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--hg-accent, #9ee493);
  }

  button:focus-visible {
    outline: 2px solid var(--hg-accent, #9ee493);
    outline-offset: 1px;
  }

  button[aria-pressed='true'] {
    border-color: var(--hg-accent, #9ee493);
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 18%, transparent);
  }

  .primary {
    border-color: var(--hg-accent, #9ee493);
    color: var(--hg-accent, #9ee493);
  }

  .danger:hover {
    border-color: var(--hg-accent-danger, #ff6b6b);
    color: var(--hg-accent-danger, #ff6b6b);
  }

  .link {
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--hg-accent, #9ee493);
    font-size: 12px;
    text-decoration: underline;
  }

  p, h2 {
    margin: 0;
    letter-spacing: 0;
  }

  .muted {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }

  .draft-error {
    color: var(--hg-accent-danger, #ff6b6b);
    font-size: 12px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--hg-border, #303030);
  }

  .filters button {
    padding: 3px 9px;
    font-size: 12px;
  }

  .count {
    color: var(--hg-text-muted, #b8b1a4);
    font-weight: 400;
  }

  .removed-note {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--hg-text-muted, #b8b1a4);
    border-bottom: 1px solid var(--hg-border, #303030);
  }

  .removed-note span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 0.8fr);
  }

  .content.no-selection {
    grid-template-columns: minmax(0, 1fr);
  }

  .groups {
    min-width: 0;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .group h2 {
    font-size: 12px;
    font-weight: 600;
    color: var(--hg-text-muted, #b8b1a4);
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    min-width: 0;
    text-align: left;
    padding: 9px 10px;
  }

  .item.selected {
    border-color: var(--hg-accent, #9ee493);
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 10%, transparent);
  }

  .item.done .title {
    color: var(--hg-text-muted, #b8b1a4);
    text-decoration: line-through;
  }

  .item-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .kind, .eyebrow {
    flex: none;
    color: var(--hg-accent, #9ee493);
    font-size: 11px;
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 56px 16px;
    text-align: center;
  }

  .empty-title {
    font-weight: 600;
  }

  .empty-hint {
    max-width: 44ch;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 13px;
  }

  .detail {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    border-left: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .back {
    display: none;
    align-self: flex-start;
  }

  .detail-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .detail-title h2 {
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  .detail-summary {
    color: var(--hg-text-muted, #b8b1a4);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    max-height: 40vh;
    overflow-y: auto;
  }

  code {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  .avatar {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
  }

  .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  @media (max-width: 760px) {
    .content, .content.no-selection {
      grid-template-columns: minmax(0, 1fr);
    }

    .detail {
      border-left: 0;
      display: none;
    }

    .content.detail-open .groups {
      display: none;
    }

    .content.detail-open .detail {
      display: flex;
    }

    .back {
      display: block;
    }
  }
</style>
