import { describe, expect, it, vi, beforeEach } from 'vitest';
import { storage } from '@napplet/sdk';
import {
  READING_QUEUE_KEY,
  addQueueItem,
  hasPlaceholderTitle,
  removeQueueItem,
  restoreQueueItem,
  createInitialQueueState,
  groupedQueueItems,
  persistQueueState,
  restoreQueueState,
  selectedQueueItem,
  setQueueItemStatus,
  visibleQueueItems,
} from './reading-queue-store';

vi.mock('@napplet/sdk', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(storage.getItem).mockReset();
  vi.mocked(storage.setItem).mockReset();
});

describe('reading queue store', () => {
  it('starts empty instead of loading sample items', () => {
    const state = createInitialQueueState();

    expect(state.items).toEqual([]);
    expect(groupedQueueItems(state)).toEqual([]);
  });

  it('adds queue captures and groups them by status', () => {
    const state = addQueueItem(createInitialQueueState(), {
      type: 'note',
      target: 'note1realcapture',
      title: 'Real capture',
      source: { napplet: 'feed' },
    }, 42);

    expect(groupedQueueItems(state)[0]?.status).toBe('queued');
    expect(selectedQueueItem(state)?.source).toBe('feed');
  });

  it('dedupes repeated captures by type and target', () => {
    const first = addQueueItem(createInitialQueueState(), { type: 'relay', target: 'wss://relay.example' }, 1);
    const second = addQueueItem(first, { type: 'relay', target: 'wss://relay.example', title: 'Relay' }, 2);

    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.title).toBe('Relay');
  });

  it('filters visible items by type', () => {
    const state = {
      ...addQueueItem(createInitialQueueState(), { type: 'profile', target: 'a'.repeat(64) }, 1),
      filter: 'profile' as const,
    };

    expect(visibleQueueItems(state).every((item) => item.type === 'profile')).toBe(true);
  });

  it('updates item status and selection', () => {
    const state = addQueueItem(createInitialQueueState(), { type: 'note', target: 'note1x' }, 1);
    const item = state.items[0]!;
    const next = setQueueItemStatus(state, item.id, 'done');

    expect(selectedQueueItem(next)?.id).toBe(item.id);
    expect(next.items.find((candidate) => candidate.id === item.id)?.status).toBe('done');
  });

  it('restores stored queue state through shell-mediated storage', async () => {
    vi.mocked(storage.getItem).mockResolvedValue(JSON.stringify({
      items: [{ id: 'stored', type: 'note', title: 'Stored', summary: '', target: 'note1x', source: 'test', status: 'done', createdAt: 1 }],
      selectedId: 'stored',
      filter: 'note',
    }));

    const restored = await restoreQueueState();

    expect(storage.getItem).toHaveBeenCalledWith(READING_QUEUE_KEY);
    expect(restored.filter).toBe('note');
    expect(restored.items[0]!.status).toBe('done');
  });

  it('persists through shell-mediated storage', () => {
    const state = createInitialQueueState();
    vi.mocked(storage.setItem).mockResolvedValue(undefined);

    persistQueueState(state);

    expect(storage.setItem).toHaveBeenCalledWith(READING_QUEUE_KEY, JSON.stringify(state));
  });

  it('keeps the selection on an item the filter shows', () => {
    let state = addQueueItem(createInitialQueueState(), { type: 'note', target: 'a', title: 'A' }, 1);
    state = addQueueItem(state, { type: 'relay', target: 'wss://b', title: 'B' }, 2);

    expect(selectedQueueItem({ ...state, filter: 'note' })?.target).toBe('a');
  });

  it('groups by status with pinned first, and removal can be undone', () => {
    let state = addQueueItem(createInitialQueueState(), { type: 'note', target: 'a', title: 'A' }, 1);
    state = addQueueItem(state, { type: 'note', target: 'b', title: 'B' }, 2);
    const first = state.items.find((item) => item.target === 'a')!;
    state = setQueueItemStatus(state, first.id, 'pinned');

    expect(groupedQueueItems(state).map((group) => group.status)).toEqual(['pinned', 'queued']);

    const removed = removeQueueItem(state, first.id);
    expect(removed.items.map((item) => item.target)).toEqual(['b']);
    expect(restoreQueueItem(removed, first).items).toHaveLength(2);
  });

  it('knows when a title is just the raw target', () => {
    const long = 'n'.repeat(60);
    const state = addQueueItem(createInitialQueueState(), { type: 'note', target: long }, 1);
    expect(hasPlaceholderTitle(state.items[0]!)).toBe(true);
    expect(hasPlaceholderTitle({ title: 'My title', target: long })).toBe(false);
  });
});
