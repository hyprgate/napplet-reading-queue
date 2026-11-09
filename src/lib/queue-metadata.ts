import { relay, type Subscription } from '@napplet/sdk';
import type { NostrEvent } from '@hyprgate/types';
import type { QueueItem } from './reading-queue-store';
import { resolveReference } from './queue-reference';

export interface ItemMetadata {
  title?: string;
  summary?: string;
  picture?: string;
}

/** The first non-empty line of a note, as its title. */
export function noteTitle(content: string): string {
  const line = content.split('\n').map((text) => text.trim()).find(Boolean) ?? '';
  return line.length > 90 ? `${line.slice(0, 90).trimEnd()}...` : line;
}

export function metadataFromEvent(event: NostrEvent): ItemMetadata | null {
  if (event.kind === 0) {
    try {
      const profile = JSON.parse(event.content) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
      return {
        title: text(profile.display_name) ?? text(profile.displayName) ?? text(profile.name) ?? text(profile.nip05),
        summary: text(profile.about),
        picture: text(profile.picture),
      };
    } catch {
      return null;
    }
  }
  const tag = (name: string) => event.tags.find((entry) => entry[0] === name && entry[1])?.[1];
  const title = tag('title') ?? tag('name');
  return title
    ? { title, summary: tag('summary') }
    : { title: noteTitle(event.content), summary: event.content.trim() };
}

/** Which item ids an incoming event describes. */
function matchKey(event: NostrEvent): string[] {
  const identifier = event.tags.find((entry) => entry[0] === 'd')?.[1];
  return [event.kind === 0 ? `profile:${event.pubkey}` : `event:${event.id}`,
    ...(identifier !== undefined ? [`address:${event.kind}:${event.pubkey}:${identifier}`] : [])];
}

function keyOf(item: QueueItem): string | null {
  const reference = resolveReference(item.target, item.type);
  if (!reference) return null;
  if (reference.kind === 'event') return `event:${reference.id}`;
  if (reference.kind === 'profile') return `profile:${reference.pubkey}`;
  if (reference.kind === 'address') return `address:${reference.address.kind}:${reference.address.pubkey}:${reference.address.identifier}`;
  return null;
}

/** Look up what saved notes and people are, keyed by item id. Unknowns simply never arrive. */
export function subscribeItemMetadata(items: QueueItem[], onMetadata: (itemId: string, metadata: ItemMetadata) => void): Subscription {
  const idsByKey = new Map<string, string[]>();
  const ids: string[] = [];
  const authors: string[] = [];
  const filters: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    idsByKey.set(key, [...(idsByKey.get(key) ?? []), item.id]);
    const reference = resolveReference(item.target, item.type)!;
    if (reference.kind === 'event') ids.push(reference.id);
    if (reference.kind === 'profile') authors.push(reference.pubkey);
    if (reference.kind === 'address') {
      filters.push({ kinds: [reference.address.kind], authors: [reference.address.pubkey], '#d': [reference.address.identifier] });
    }
  }
  if (ids.length > 0) filters.push({ ids });
  if (authors.length > 0) filters.push({ kinds: [0], authors });
  if (filters.length === 0) return { close: () => {} };

  const newestAt = new Map<string, number>();
  return relay.subscribe(filters as never, (result) => {
    const event = result.event as NostrEvent;
    const metadata = metadataFromEvent(event);
    if (!metadata) return;
    for (const key of matchKey(event)) {
      if ((newestAt.get(key) ?? -1) > event.created_at) continue;
      for (const itemId of idsByKey.get(key) ?? []) {
        newestAt.set(key, event.created_at);
        onMetadata(itemId, metadata);
      }
    }
  }, () => {});
}
