import { describe, expect, it } from 'vitest';

import { writePodcastId3 } from '../writePodcastId3';

const empty = { title: '', artist: '', description: '' };
const decoder = new TextDecoder('utf-8', { fatal: true });

function sizeAt(bytes: Uint8Array, offset: number): number {
    const digits = Array.from(bytes.subarray(offset, offset + 4));
    expect(digits).toHaveLength(4);
    expect(digits.every((digit) => digit < 128)).toBe(true);
    return digits.reduce((size, digit) => size * 128 + digit, 0);
}

function parse(bytes: Uint8Array): { frames: Record<string, Uint8Array>; end: number } {
    expect(Array.from(bytes.subarray(0, 6))).toEqual([73, 68, 51, 4, 0, 0]);
    const end = 10 + sizeAt(bytes, 6);
    const frames: Record<string, Uint8Array> = {};
    let offset = 10;
    while (offset < end) {
        const id = decoder.decode(bytes.subarray(offset, offset + 4));
        const size = sizeAt(bytes, offset + 4);
        expect(Array.from(bytes.subarray(offset + 8, offset + 10))).toEqual([0, 0]);
        frames[id] = bytes.subarray(offset + 10, offset + 10 + size);
        offset += 10 + size;
    }
    expect(offset).toBe(end);
    return { frames, end };
}

describe('writePodcastId3', () => {
    it('writes Unicode title, artist and undetermined-language comment with synchsafe sizes', () => {
        const encodedBytes = new Uint8Array([255, 251, 176, 0, 128, 255, 0]);
        const metadata = {
            title: 'Épisode 🌊'.repeat(30),
            artist: 'José 音楽',
            description: 'Voix\n世界 🌍'.repeat(50),
        };
        const tagged = writePodcastId3({ metadata, encodedBytes });
        const { frames, end } = parse(tagged);
        expect(Object.keys(frames)).toEqual(['TIT2', 'TPE1', 'COMM']);
        expect(frames.TIT2![0]).toBe(3);
        expect(decoder.decode(frames.TIT2!.subarray(1))).toBe(metadata.title);
        expect(frames.TPE1![0]).toBe(3);
        expect(decoder.decode(frames.TPE1!.subarray(1))).toBe(metadata.artist);
        expect(Array.from(frames.COMM!.subarray(0, 5))).toEqual([3, 117, 110, 100, 0]);
        expect(decoder.decode(frames.COMM!.subarray(5))).toBe(metadata.description);
        expect(tagged.subarray(end)).toEqual(encodedBytes);
        expect(encodedBytes).toEqual(new Uint8Array([255, 251, 176, 0, 128, 255, 0]));
    });

    it('omits empty fields and emits no empty tag', () => {
        const encodedBytes = new Uint8Array([255, 251]);
        expect(writePodcastId3({ metadata: empty, encodedBytes })).toBe(encodedBytes);
        expect(
            Object.keys(parse(writePodcastId3({ metadata: { ...empty, artist: 'One' }, encodedBytes })).frames)
        ).toEqual(['TPE1']);
    });

    it.each(['title', 'artist', 'description'] as const)('rejects embedded NUL in %s', (field) => {
        expect(() =>
            writePodcastId3({ metadata: { ...empty, [field]: 'before\0after' }, encodedBytes: new Uint8Array() })
        ).toThrow('unsupported text separator');
    });

    it.each([
        ['title', 4096],
        ['artist', 4096],
        ['description', 16384],
    ] as const)('enforces the exact UTF-8 byte limit for %s without truncation', (field, limit) => {
        const accepted = { ...empty, [field]: 'é'.repeat(limit / 2) };
        const { end, frames } = parse(writePodcastId3({ metadata: accepted, encodedBytes: new Uint8Array() }));
        expect(end - 10).toBeLessThanOrEqual(32768);
        expect(Object.values(frames)[0]!.length).toBe(limit + (field === 'description' ? 5 : 1));
        for (const value of ['x'.repeat(limit + 1), `${'é'.repeat(limit / 2)}x`]) {
            expect(() =>
                writePodcastId3({ metadata: { ...empty, [field]: value }, encodedBytes: new Uint8Array() })
            ).toThrow(`at most ${limit} UTF-8 bytes`);
        }
    });

    it('bounds the combined maximum tag and refuses newline text-frame separators', () => {
        const tagged = writePodcastId3({
            metadata: { title: 'x'.repeat(4096), artist: 'y'.repeat(4096), description: 'z'.repeat(16384) },
            encodedBytes: new Uint8Array(),
        });
        expect(parse(tagged).end).toBe(tagged.length);
        expect(tagged.length - 10).toBeLessThanOrEqual(32768);
        expect(() =>
            writePodcastId3({ metadata: { ...empty, title: 'first\nsecond' }, encodedBytes: new Uint8Array() })
        ).toThrow('unsupported text separator');
    });
});
