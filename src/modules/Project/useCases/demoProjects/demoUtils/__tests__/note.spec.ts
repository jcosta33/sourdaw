import { describe, it, expect } from 'vitest';

import { note } from '../note';

// A canonical RFC-4122 UUID after the `note-` prefix. The previous implementation
// truncated to `crypto.randomUUID().slice(0, 8)`, yielding an 8-hex-char id with a
// high collision rate at scale; this regression pins the full-UUID id.
const NOTE_ID_PATTERN = /^note-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('note', () => {
    it('assigns a full-UUID id (not an 8-char truncation)', () => {
        const created = note(60, 0, 1);
        expect(created.id).toMatch(NOTE_ID_PATTERN);
    });

    it('does not collide across many notes', () => {
        const ids = new Set<string>();
        for (let index = 0; index < 2000; index++) {
            ids.add(note(60, 0, 1).id);
        }
        expect(ids.size).toBe(2000);
    });

    it('carries through pitch, start, duration and velocity', () => {
        const created = note(64, 2, 1.5, 90);
        expect(created.pitch).toBe(64);
        expect(created.startBeat).toBe(2);
        expect(created.duration).toBe(1.5);
        expect(created.velocity).toBe(90);
    });
});
