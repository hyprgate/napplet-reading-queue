import { describe, expect, it } from 'vitest';
import { resolveReference } from './queue-reference';
import { metadataFromEvent, noteTitle } from './queue-metadata';

const HEX = 'a'.repeat(64);
// The same key encoded by nostr-tools' nip19: real bech32 vectors, not placeholders.
const NOTE = 'note1424242424242424242424242424242424242424242424242424qv3q9y6';
const NPUB = 'npub1424242424242424242424242424242424242424242424242424qamrcaj';
const NPROFILE = 'nprofile1qy8hwumn8ghj7u3wv4uxzmtsd3jsqg924242424242424242424242424242424242424242424242424g7pwvpq';
const NEVENT = 'nevent1qqs242424242424242424242424242424242424242424242424242s7c3tw2';
const NADDR = 'naddr1qvzqqqr4gupzp242424242424242424242424242424242424242424242424242qqpkzwnz2aqqqa';

describe('resolveReference', () => {
  it('reads the bech32 forms people paste, with or without nostr:', () => {
    expect(resolveReference(NOTE)).toEqual({ type: 'note', kind: 'event', id: HEX });
    expect(resolveReference(`nostr:${NOTE}`)).toEqual({ type: 'note', kind: 'event', id: HEX });
    expect(resolveReference(NPUB)).toEqual({ type: 'profile', kind: 'profile', pubkey: HEX });
    expect(resolveReference(NPROFILE)?.type).toBe('profile');
    expect(resolveReference(NEVENT)).toMatchObject({ kind: 'event', id: HEX });
  });

  it('reads an naddr as an address', () => {
    expect(resolveReference(NADDR)).toEqual({
      type: 'note', kind: 'address', address: { kind: 30023, pubkey: HEX, identifier: 'a:b' },
    });
  });

  it('tells relays from web links', () => {
    expect(resolveReference('wss://relay.example')?.type).toBe('relay');
    expect(resolveReference('https://a.example/x.png')).toEqual({ type: 'media', kind: 'web', url: 'https://a.example/x.png' });
  });

  it('uses the sender\'s type for a bare hex key', () => {
    expect(resolveReference(HEX, 'profile')?.type).toBe('profile');
    expect(resolveReference(HEX)?.type).toBe('note');
  });

  it('rejects anything it cannot act on', () => {
    expect(resolveReference('')).toBeNull();
    expect(resolveReference('hello world')).toBeNull();
    expect(resolveReference('npub1notreal')).toBeNull();
  });
});

describe('item metadata', () => {
  const event = (kind: number, content: string, tags: string[][] = []) => ({ id: HEX, pubkey: HEX, created_at: 1, kind, tags, content, sig: 's' });

  it('titles a note from its first real line', () => {
    expect(noteTitle('\n  First line \nSecond')).toBe('First line');
    expect(metadataFromEvent(event(1, 'Hello\nthere'))).toEqual({ title: 'Hello', summary: 'Hello\nthere' });
  });

  it('uses an article title and summary', () => {
    expect(metadataFromEvent(event(30023, '# Body', [['title', 'T'], ['summary', 'S']]))).toEqual({ title: 'T', summary: 'S' });
  });

  it('reads a profile, and survives bad metadata', () => {
    expect(metadataFromEvent(event(0, JSON.stringify({ name: 'n', display_name: 'D', picture: 'https://a.example/p.png' })))).toMatchObject({ title: 'D', picture: 'https://a.example/p.png' });
    expect(metadataFromEvent(event(0, 'not json'))).toBeNull();
  });
});
