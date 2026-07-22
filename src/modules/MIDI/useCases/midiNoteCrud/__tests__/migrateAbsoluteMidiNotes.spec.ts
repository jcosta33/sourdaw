import { describe, it, expect, vi, beforeEach } from 'vitest';

import { migrateAbsoluteMidiNotes } from '../migrateAbsoluteMidiNotes';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { current: unknown } = { current: null };
    return {
        midiStoreValue: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
        midiStoreSet: vi.fn(),
        trackStoreValue,
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

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.current;
        },
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('migrateAbsoluteMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        // A legacy AI-named clip at startBeat 4 whose first note sits at
        // (what used to be) an absolute beat.
        mocks.trackStoreValue.current = {
            tracks: [
                {
                    id: 'track-1',
                    clips: [{ id: 'clip-1', type: 'midi', name: 'Melody take 2', startBeat: 4, endBeat: 36 }],
                },
            ],
        };
    });

    it('migrates a legacy absolute clip exactly once across repeated loads', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                'clip-1': [
                    { pitch: 60, startBeat: 32, duration: 1 },
                    { pitch: 64, startBeat: 34, duration: 1 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        // First load: legacy clip migrates to clip-relative.
        migrateAbsoluteMidiNotes();
        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const firstWrite = mocks.midiStoreSet.mock.calls[0]![0] as {
            notesByClipId: Record<string, Array<{ startBeat: number }>>;
        };
        expect(firstWrite.notesByClipId['clip-1']).toEqual([
            { pitch: 60, startBeat: 28, duration: 1 },
            { pitch: 64, startBeat: 30, duration: 1 },
        ]);

        // Second load (store now holds the migrated state): must NOT shift
        // again — pre-fix the heuristic re-fired (28 >= 4) and corrupted
        // the clip further on every project load.
        mocks.midiStoreValue.value = firstWrite as never;
        migrateAbsoluteMidiNotes();

        const secondWrite = mocks.midiStoreSet.mock.calls[1]?.[0] as
            { notesByClipId: Record<string, Array<{ startBeat: number }>> } | undefined;
        const starts = (secondWrite?.notesByClipId ?? firstWrite.notesByClipId)['clip-1']!.map(
            (note) => note.startBeat
        );
        expect(starts).toEqual([28, 30]);
    });
});
