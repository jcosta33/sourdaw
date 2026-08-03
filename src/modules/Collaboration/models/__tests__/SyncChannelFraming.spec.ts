import { describe, it, expect } from 'vitest';

import {
    ChunkAssembler,
    parseChunkFrame,
    resolveMaxFrameBytes,
    splitMessageIntoFrames,
    utf8ByteLength,
} from '../SyncChannelFraming';

/** Rebuild a message by feeding every frame through a fresh assembler. */
function reassemble(frames: string[]): string | null {
    const assembler = new ChunkAssembler();
    let result: string | null = null;
    for (const frame of frames) {
        const parsed = parseChunkFrame(frame);
        result = parsed ? assembler.accept(parsed) : frame;
    }
    return result;
}

describe('resolveMaxFrameBytes', () => {
    it("clamps Chrome's negotiated 262144 to the RFC 8831 §6.6 16 KB ceiling", () => {
        expect(resolveMaxFrameBytes(262_144)).toBe(16 * 1024);
    });

    it('honours a negotiated limit below the ceiling', () => {
        expect(resolveMaxFrameBytes(4096)).toBe(4096);
    });

    it('clamps an unbounded association, which W3C §6.1.1.2 allows to be +Infinity', () => {
        expect(resolveMaxFrameBytes(Number.POSITIVE_INFINITY)).toBe(16 * 1024);
    });

    it('falls back to the 64K default from RFC 8841 §6.1 when no transport is readable', () => {
        // min(65536, 16384) — the fallback is still bounded by the §6.6 ceiling.
        expect(resolveMaxFrameBytes(undefined)).toBe(16 * 1024);
        expect(resolveMaxFrameBytes(Number.NaN)).toBe(16 * 1024);
    });
});

describe('splitMessageIntoFrames', () => {
    it('leaves a message that already fits unframed', () => {
        const text = JSON.stringify({ type: 'presence', data: { peerId: 'a' } });

        const frames = splitMessageIntoFrames({ text, maxFrameBytes: 16 * 1024, messageId: 'm1' });

        expect(frames).toEqual([text]);
        expect(parseChunkFrame(frames[0]!)).toBeNull();
    });

    it('keeps every frame within the negotiated byte ceiling', () => {
        const text = JSON.stringify({ type: 'crdt-sync', docId: 'root', data: 'a'.repeat(50_000) });

        const frames = splitMessageIntoFrames({ text, maxFrameBytes: 4096, messageId: 'm1' });

        expect(frames.length).toBeGreaterThan(12);
        for (const frame of frames) {
            expect(utf8ByteLength(frame)).toBeLessThanOrEqual(4096);
        }
    });

    it('rebuilds a multi-byte payload exactly, never cutting inside a code point', () => {
        // Each 🥖 is four UTF-8 bytes, so an unaligned cut lands inside one.
        const text = JSON.stringify({ type: 'crdt-sync', docId: 'root', data: '🥖é'.repeat(3000) });

        const frames = splitMessageIntoFrames({ text, maxFrameBytes: 1024, messageId: 'm1' });

        expect(frames.length).toBeGreaterThan(1);
        expect(reassemble(frames)).toBe(text);
    });

    it('refuses a ceiling too small to carry a frame header', () => {
        expect(() => splitMessageIntoFrames({ text: 'x'.repeat(200), maxFrameBytes: 66, messageId: 'm1' })).toThrow(
            /no room for a chunk frame header/
        );
    });
});

describe('parseChunkFrame', () => {
    it('reads back the index and count a frame was built with', () => {
        const frames = splitMessageIntoFrames({ text: 'y'.repeat(9000), maxFrameBytes: 1024, messageId: 'abc' });

        const first = parseChunkFrame(frames[0]!);
        const last = parseChunkFrame(frames.at(-1)!);

        expect(first).toMatchObject({ messageId: 'abc', index: 0, count: frames.length });
        expect(last).toMatchObject({ messageId: 'abc', index: frames.length - 1 });
    });

    it('treats a whole JSON message as unframed', () => {
        expect(parseChunkFrame('{"type":"presence"}')).toBeNull();
    });

    it.each([
        ['sdaw-chunk:', 'no separators'],
        ['sdaw-chunk:id:0:', 'a truncated header'],
        ['sdaw-chunk:id:x:2:body', 'a non-numeric index'],
        ['sdaw-chunk:id:2:2:body', 'an index at or past the count'],
        ['sdaw-chunk:id:0:0:body', 'a zero count'],
    ])('rejects %s (%s)', (frame) => {
        expect(parseChunkFrame(frame)).toBeNull();
    });
});

describe('ChunkAssembler', () => {
    const frames = splitMessageIntoFrames({ text: 'z'.repeat(9000), maxFrameBytes: 1024, messageId: 'm1' });

    it('returns null until the final frame lands', () => {
        const assembler = new ChunkAssembler();
        const parsed = frames.map((frame) => parseChunkFrame(frame)!);

        for (const frame of parsed.slice(0, -1)) {
            expect(assembler.accept(frame)).toBeNull();
        }

        expect(assembler.accept(parsed.at(-1)!)).toBe('z'.repeat(9000));
    });

    it('drops the message when a frame arrives out of order', () => {
        const assembler = new ChunkAssembler();
        const parsed = frames.map((frame) => parseChunkFrame(frame)!);

        assembler.accept(parsed[0]!);
        expect(assembler.accept(parsed[2]!)).toBeNull();

        // The partial was discarded, so the rest of the run completes nothing.
        for (const frame of parsed.slice(1)) {
            expect(assembler.accept(frame)).toBeNull();
        }
    });

    it('ignores a continuation for a message it is not tracking', () => {
        const assembler = new ChunkAssembler();

        expect(assembler.accept({ messageId: 'unknown', index: 3, count: 9, payload: 'x' })).toBeNull();
    });

    it('drops every partial on clear, so a reconnect cannot complete a stale message', () => {
        const assembler = new ChunkAssembler();
        const parsed = frames.map((frame) => parseChunkFrame(frame)!);
        for (const frame of parsed.slice(0, -1)) {
            assembler.accept(frame);
        }

        assembler.clear();

        expect(assembler.accept(parsed.at(-1)!)).toBeNull();
    });

    it('stops tracking beyond eight concurrent messages rather than growing', () => {
        const assembler = new ChunkAssembler();
        for (let index = 0; index < 9; index++) {
            assembler.accept({ messageId: `m${index}`, index: 0, count: 4, payload: 'head' });
        }

        // The ninth start cleared the table, so the first message can no longer
        // take its second frame.
        expect(assembler.accept({ messageId: 'm0', index: 1, count: 4, payload: 'tail' })).toBeNull();
        expect(assembler.accept({ messageId: 'm8', index: 1, count: 4, payload: 'tail' })).toBeNull();
    });
});
