import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PresenceDelta } from '../../../models/CollaborationTypes';
import { usePresence } from '../usePresence';

// Capture the listener that usePresence registers so the test can push deltas.
const presence = vi.hoisted(() => ({ listener: null as ((data: PresenceDelta) => void) | null }));

vi.mock('../../../useCases/collaboration/onPresence', () => ({
    onPresence: (listener: (data: PresenceDelta) => void) => {
        presence.listener = listener;
        return () => {
            presence.listener = null;
        };
    },
}));

function emit(delta: PresenceDelta): void {
    act(() => {
        presence.listener?.(delta);
    });
}

describe('usePresence (§fix-9 presence deltas)', () => {
    beforeEach(() => {
        presence.listener = null;
    });

    it('a cursor-only delta does not wipe the playhead set by a prior heartbeat delta', () => {
        const { result } = renderHook(() => usePresence());

        // Heartbeat delta: carries playhead, omits cursor fields.
        emit({ peerId: 'p1', name: 'Alice', color: '#f00', playheadBeat: 12 });
        // Cursor delta: carries cursor, omits playhead.
        emit({ peerId: 'p1', name: 'Alice', color: '#f00', cursorBeat: 30, cursorTrackId: 't1' });

        const entry = result.current.find((data) => data.peerId === 'p1');
        // The cursor update must NOT have nulled the playhead.
        expect(entry?.playheadBeat).toBe(12);
        expect(entry?.cursorBeat).toBe(30);
        expect(entry?.cursorTrackId).toBe('t1');
    });

    it('a heartbeat delta does not wipe the cursor set by a prior cursor delta', () => {
        const { result } = renderHook(() => usePresence());

        emit({ peerId: 'p1', name: 'Alice', color: '#f00', cursorBeat: 30, cursorTrackId: 't1' });
        emit({ peerId: 'p1', name: 'Alice', color: '#f00', playheadBeat: 99 });

        const entry = result.current.find((data) => data.peerId === 'p1');
        expect(entry?.cursorBeat).toBe(30);
        expect(entry?.cursorTrackId).toBe('t1');
        expect(entry?.playheadBeat).toBe(99);
    });

    it("a peer's first delta seeds a complete record (omitted fields are defined, not undefined)", () => {
        const { result } = renderHook(() => usePresence());

        // First-ever delta for this peer is a playhead-only heartbeat.
        emit({ peerId: 'p1', name: 'Alice', color: '#f00', playheadBeat: 5 });

        const entry = result.current.find((data) => data.peerId === 'p1');
        // Cursor fields the heartbeat omitted must be seeded to null — never
        // undefined — so PresenceOverlay's `!== null` checks behave correctly.
        expect(entry?.cursorBeat).toBeNull();
        expect(entry?.cursorTrackId).toBeNull();
        expect(entry?.playheadBeat).toBe(5);
    });
});
