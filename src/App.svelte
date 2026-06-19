<script lang="ts">
  import { onMount } from 'svelte';
  import { inc as ipc } from '@napplet/sdk';
  import { READING_QUEUE_ADD_TOPIC, parseReadingQueueAddPayload } from '@hyprgate/utils';
  import {
    addQueueItem,
    groupedQueueItems,
    persistQueueState,
    restoreQueueState,
    selectedQueueItem,
    setQueueItemStatus,
    type QueueItem,
    type QueueItemStatus,
    type QueueItemType,
    type QueueState,
  } from './lib/reading-queue-store';

  let state = $state<QueueState>({ items: [], selectedId: null, filter: 'all' });
  let draftType = $state<QueueItemType>('note');
  let draftTarget = $state('');
  let draftTitle = $state('');
  let draftSummary = $state('');
  const groups = $derived(groupedQueueItems(state));
  const selected = $derived(selectedQueueItem(state));

  const filters: Array<QueueItemType | 'all'> = ['all', 'note', 'profile', 'relay', 'media', 'app'];

  onMount(() => {
    restoreQueueState().then((restored) => {
      state = restored;
    });
    const sub = ipc.on(READING_QUEUE_ADD_TOPIC, (payload) => {
      const capture = parseReadingQueueAddPayload(payload);
      if (!capture) return;
      state = addQueueItem(state, capture);
      persistQueueState(state);
    });
    return () => sub.close();
  });

  function selectItem(item: QueueItem): void {
    state = { ...state, selectedId: item.id };
    persistQueueState(state);
  }

  function setFilter(filter: QueueState['filter']): void {
    state = { ...state, filter };
    persistQueueState(state);
  }

  function updateStatus(item: QueueItem, status: QueueItemStatus): void {
    state = setQueueItemStatus(state, item.id, status);
    persistQueueState(state);
  }

  function saveDraft(): void {
    state = addQueueItem(state, {
      type: draftType,
      target: draftTarget,
      title: draftTitle,
      summary: draftSummary,
      source: { napplet: 'reading-queue' },
    });
    draftTarget = '';
    draftTitle = '';
    draftSummary = '';
    persistQueueState(state);
  }

  function openItem(item: QueueItem): void {
    if (item.type === 'profile') {
      ipc.emit('profile:open', [], JSON.stringify({ pubkey: item.target }));
      return;
    }
    if (item.type === 'note') {
      ipc.emit('note:open', [], JSON.stringify({ target: item.target }));
      return;
    }
    if (item.type === 'relay') {
      ipc.emit('relay-browser:inspect', [], JSON.stringify({ relay: item.target }));
      return;
    }
    ipc.emit('reading-queue:open-target', [], JSON.stringify({ type: item.type, target: item.target }));
  }
</script>

<main class="queue-shell">
  <header class="toolbar">
    <div class="filters" aria-label="Queue filters">
      {#each filters as filter}
        <button type="button" class:active={state.filter === filter} onclick={() => setFilter(filter)}>
          {filter}
        </button>
      {/each}
    </div>
  </header>

  <section class="content">
    <div class="groups" aria-label="Saved items">
      <form class="capture" onsubmit={(event) => { event.preventDefault(); saveDraft(); }}>
        <select aria-label="Item type" bind:value={draftType}>
          {#each filters.filter((filter) => filter !== 'all') as filter}
            <option value={filter}>{filter}</option>
          {/each}
        </select>
        <input aria-label="Target" placeholder="note1 / npub / wss / naddr" bind:value={draftTarget} />
        <input aria-label="Title" placeholder="title" bind:value={draftTitle} />
        <input aria-label="Summary" placeholder="context" bind:value={draftSummary} />
        <button type="submit">Add</button>
      </form>
      {#each groups as group}
        <section class="group">
          <h2>{group.type}</h2>
          {#each group.items as item}
            <button
              type="button"
              class="item"
              class:selected={selected?.id === item.id}
              onclick={() => selectItem(item)}
            >
              <span class="status">{item.status}</span>
              <span class="title">{item.title}</span>
              <span class="summary">{item.summary}</span>
            </button>
          {/each}
        </section>
      {/each}
      {#if groups.length === 0}
        <p class="empty-list">No queued items yet.</p>
      {/if}
    </div>

    <aside class="detail">
      {#if selected}
        <p class="eyebrow">{selected.type} from {selected.source}</p>
        <h2>{selected.title}</h2>
        <p>{selected.summary}</p>
        <code>{selected.target}</code>
        <div class="actions">
          <button type="button" onclick={() => openItem(selected)}>Open</button>
          <button type="button" onclick={() => updateStatus(selected, 'pinned')}>Pin</button>
          <button type="button" onclick={() => updateStatus(selected, 'deferred')}>Defer</button>
          <button type="button" onclick={() => updateStatus(selected, 'done')}>Done</button>
        </div>
      {:else}
        <p class="empty">No queue item selected.</p>
      {/if}
    </aside>
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
    background: var(--hg-bg, #070707);
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
  }

  h2, p {
    margin: 0;
    letter-spacing: 0;
  }

  h2 {
    font-size: 14px;
    text-transform: uppercase;
  }

  .eyebrow {
    color: var(--hg-accent, #9ee493);
    font-size: 11px;
    text-transform: uppercase;
  }

  .filters, .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  input, select, button {
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #111);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 7px 10px;
    cursor: pointer;
  }

  input:focus, select:focus, button:hover, button.active, button.selected {
    border-color: var(--hg-accent, #9ee493);
    outline: none;
  }

  .content {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.7fr);
  }

  .groups {
    overflow: auto;
    padding: 12px;
  }

  .capture {
    display: grid;
    grid-template-columns: 92px minmax(160px, 1fr) minmax(120px, 0.6fr) minmax(120px, 0.8fr) auto;
    gap: 8px;
    margin-bottom: 12px;
  }

  .group {
    margin-bottom: 16px;
  }

  .group h2 {
    margin-bottom: 8px;
    color: var(--hg-text-muted, #b8b1a4);
  }

  .item {
    width: 100%;
    display: grid;
    grid-template-columns: 82px minmax(120px, 0.4fr) minmax(0, 1fr);
    gap: 10px;
    text-align: left;
    margin-bottom: 8px;
  }

  .status {
    color: var(--hg-accent, #9ee493);
  }

  .summary, .empty-list {
    min-width: 0;
    color: var(--hg-text-muted, #b8b1a4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    border-left: 1px solid var(--hg-border, #303030);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--hg-surface, #101010);
  }

  code {
    overflow-wrap: anywhere;
    color: var(--hg-accent-cyan, #82d8f7);
  }

  .empty {
    color: var(--hg-text-muted, #b8b1a4);
  }

  @media (max-width: 720px) {
    .toolbar, .content {
      display: flex;
      flex-direction: column;
    }

    .detail {
      border-left: 0;
      border-top: 1px solid var(--hg-border, #303030);
    }

    .item {
      grid-template-columns: 1fr;
    }

    .capture {
      grid-template-columns: 1fr;
    }
  }
</style>
