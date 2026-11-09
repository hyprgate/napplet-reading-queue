import { parseNoteContent } from '@hyprgate/utils';
import type { QueueItemType } from './reading-queue-store';

/** What a saved target actually points at, so it can be opened and described. */
export type QueueReference =
  | { type: 'note'; kind: 'event'; id: string; author?: string }
  | { type: 'note'; kind: 'address'; address: { kind: number; pubkey: string; identifier: string } }
  | { type: 'profile'; kind: 'profile'; pubkey: string }
  | { type: 'relay'; kind: 'relay'; url: string }
  | { type: 'media'; kind: 'web'; url: string };

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Read a pasted or received target. A bare hex key can't say what it is, so `hint`
 * (the type another app sent) decides, and otherwise it's taken as a note id.
 */
export function resolveReference(target: string, hint?: QueueItemType): QueueReference | null {
  const value = target.trim();
  if (!value) return null;
  if (/^wss?:\/\/\S+$/i.test(value)) return { type: 'relay', kind: 'relay', url: value };
  if (/^https?:\/\/\S+$/i.test(value)) return { type: 'media', kind: 'web', url: value };
  if (HEX_64.test(value)) {
    return hint === 'profile'
      ? { type: 'profile', kind: 'profile', pubkey: value }
      : { type: 'note', kind: 'event', id: value };
  }

  const bare = value.replace(/^nostr:/i, '');
  if (!/^(npub|nprofile|note|nevent|naddr)1[a-z0-9]+$/i.test(bare)) return null;
  const [block] = parseNoteContent(`nostr:${bare}`);
  if (block?.type === 'profile') return { type: 'profile', kind: 'profile', pubkey: block.value };
  if (block?.type === 'event') {
    return { type: 'note', kind: 'event', id: block.value, ...(block.author ? { author: block.author } : {}) };
  }
  if (block?.type === 'address') {
    const [kind, pubkey, ...identifier] = block.value.split(':');
    const parsedKind = Number(kind);
    if (Number.isInteger(parsedKind) && pubkey) {
      return { type: 'note', kind: 'address', address: { kind: parsedKind, pubkey, identifier: identifier.join(':') } };
    }
  }
  return null;
}

export const TYPE_LABELS: Record<QueueItemType, { one: string; many: string }> = {
  note: { one: 'Note', many: 'Notes' },
  profile: { one: 'Person', many: 'People' },
  relay: { one: 'Relay', many: 'Relays' },
  media: { one: 'Link', many: 'Links' },
  app: { one: 'App', many: 'Apps' },
};
