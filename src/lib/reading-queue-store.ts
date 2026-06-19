import { storage } from '@napplet/sdk';
import {
  parseReadingQueueAddPayload,
  type ReadingQueueAddPayload,
  type ReadingQueueItemType,
} from '@hyprgate/utils';

export type QueueItemType = ReadingQueueItemType;
export type QueueItemStatus = 'queued' | 'pinned' | 'deferred' | 'done';

export interface QueueItem {
  id: string;
  type: QueueItemType;
  title: string;
  summary: string;
  target: string;
  source: string;
  status: QueueItemStatus;
  createdAt: number;
}

export interface QueueState {
  items: QueueItem[];
  selectedId: string | null;
  filter: QueueItemType | 'all';
}

export const READING_QUEUE_KEY = 'reading-queue:v1';

export function createInitialQueueState(): QueueState {
  return {
    items: [],
    selectedId: null,
    filter: 'all',
  };
}

function normalizeItems(items: QueueItem[]): QueueItem[] {
  return items
    .filter((item) => item.id && item.title && item.target)
    .map((item) => ({
      ...item,
      status: ['queued', 'pinned', 'deferred', 'done'].includes(item.status) ? item.status : 'queued',
      type: ['note', 'profile', 'relay', 'media', 'app'].includes(item.type) ? item.type : 'note',
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function visibleQueueItems(state: QueueState): QueueItem[] {
  const items = state.filter === 'all'
    ? state.items
    : state.items.filter((item) => item.type === state.filter);
  return normalizeItems(items).sort((a, b) => {
    const rank = (status: QueueItemStatus) => status === 'pinned' ? 0 : status === 'queued' ? 1 : status === 'deferred' ? 2 : 3;
    return rank(a.status) - rank(b.status) || b.createdAt - a.createdAt;
  });
}

export function groupedQueueItems(state: QueueState): Array<{ type: QueueItemType; items: QueueItem[] }> {
  const groups = new Map<QueueItemType, QueueItem[]>();
  for (const item of visibleQueueItems(state)) {
    const existing = groups.get(item.type) ?? [];
    existing.push(item);
    groups.set(item.type, existing);
  }
  return Array.from(groups.entries()).map(([type, items]) => ({ type, items }));
}

export function selectedQueueItem(state: QueueState): QueueItem | null {
  return state.items.find((item) => item.id === state.selectedId) ?? visibleQueueItems(state)[0] ?? null;
}

export function setQueueItemStatus(state: QueueState, itemId: string, status: QueueItemStatus): QueueState {
  return {
    ...state,
    items: state.items.map((item) => item.id === itemId ? { ...item, status } : item),
    selectedId: itemId,
  };
}

export function addQueueItem(state: QueueState, payload: ReadingQueueAddPayload, now = Date.now()): QueueState {
  const parsed = parseReadingQueueAddPayload(payload);
  if (!parsed) return state;

  const existing = state.items.find((item) => item.type === parsed.type && item.target === parsed.target);
  const source = parsed.source?.napplet ?? 'Manual';
  if (existing) {
    return {
      ...state,
      items: normalizeItems(state.items.map((item) => item.id === existing.id
        ? {
            ...item,
            title: parsed.title ?? item.title,
            summary: parsed.summary ?? item.summary,
            source,
            status: item.status === 'done' ? 'queued' : item.status,
          }
        : item)),
      selectedId: existing.id,
    };
  }

  const item: QueueItem = {
    id: `queue-${now}-${parsed.type}-${hashTarget(parsed.target)}`,
    type: parsed.type,
    title: parsed.title ?? fallbackTitle(parsed),
    summary: parsed.summary ?? '',
    target: parsed.target,
    source,
    status: 'queued',
    createdAt: now,
  };

  return {
    ...state,
    items: normalizeItems([item, ...state.items]),
    selectedId: item.id,
  };
}

export async function restoreQueueState(): Promise<QueueState> {
  const fallback = createInitialQueueState();
  try {
    const raw = await storage.getItem(READING_QUEUE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<QueueState>;
    const items = Array.isArray(parsed.items)
      ? normalizeItems(parsed.items as QueueItem[])
      : fallback.items;
    return {
      items,
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : items[0]?.id ?? null,
      filter: parsed.filter === 'all' || ['note', 'profile', 'relay', 'media', 'app'].includes(String(parsed.filter))
        ? parsed.filter as QueueState['filter']
        : 'all',
    };
  } catch {
    return fallback;
  }
}

export function persistQueueState(state: QueueState): void {
  void storage.setItem(READING_QUEUE_KEY, JSON.stringify(state)).catch(() => {
    // Storage is best-effort; the UI keeps the in-memory state.
  });
}

function fallbackTitle(payload: ReadingQueueAddPayload): string {
  return payload.target.length > 32 ? `${payload.target.slice(0, 32)}...` : payload.target;
}

function hashTarget(target: string): string {
  let hash = 0;
  for (let i = 0; i < target.length; i += 1) {
    hash = Math.imul(31, hash) + target.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}
