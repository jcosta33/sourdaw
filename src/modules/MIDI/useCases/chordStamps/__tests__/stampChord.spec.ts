import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stampChord } from '../stampChord';

type MidiStoreValue = {
    notesByClipId: Record<
        string,
        { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[]
    >;
    ccByClipId: Record<string, unknown>;
    pitchBendByClipId: Record<string, unknown>;
};

const mocks = vi.hoisted(() => {
    const midiStoreValue: { value: MidiStoreValue | null } = {
        value: {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        },
    };
    return {
        midiStoreValue,
        midiStoreSet: vi.fn<(newState: MidiStoreValue) => void>(),
    };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('stampChord', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('should not write when the MIDI store is null', () => {
        mocks.midiStoreValue.value = null;
        const created = stampChord('c1', 60, 0, 1, 100, 'major');
        expect(created).toEqual([]);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should stamp every chord tone for an in-range root', () => {
        const created = stampChord('c1', 60, 0, 1, 100, 'major');
        // major = [0, 4, 7] -> 60, 64, 67
        expect(created.map((node) => node.pitch)).toEqual([60, 64, 67]);
        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
    });

    it('should octave-shift out-of-range tones into [0, 127] instead of dropping them', () => {
        // Root near the ceiling: major thirds/fifths would exceed 127.
        // Regression: previously the > 127 tones were silently dropped, so a
        // 3-note chord came back as fewer notes. Now they are octave-shifted in.
        const created = stampChord('c1', 125, 0, 1, 100, 'major');
        expect(created).toHaveLength(3);
        for (const node of created) {
            expect(node.pitch).toBeGreaterThanOrEqual(0);
            expect(node.pitch).toBeLessThanOrEqual(127);
        }
        // Pitch classes are preserved: 125 % 12, (125 + 4) % 12, (125 + 7) % 12.
        expect(created.map((node) => node.pitch % 12).sort((alpha, b) => alpha - b)).toEqual(
            [125 % 12, 129 % 12, 132 % 12].sort((alpha, b) => alpha - b)
        );
    });

    it('should octave-shift a negative root up into range', () => {
        const created = stampChord('c1', -3, 0, 1, 100, 'major');
        expect(created).toHaveLength(3);
        for (const node of created) {
            expect(node.pitch).toBeGreaterThanOrEqual(0);
            expect(node.pitch).toBeLessThanOrEqual(127);
        }
    });

    it('should clamp velocity to [1, 127] before creating notes', () => {
        const silent = stampChord('c1', 60, 0, 1, 0, 'major');
        expect(silent.every((node) => node.velocity === 1)).toBe(true);

        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        const loud = stampChord('c1', 60, 0, 1, 999, 'major');
        expect(loud.every((node) => node.velocity === 127)).toBe(true);
    });
});
