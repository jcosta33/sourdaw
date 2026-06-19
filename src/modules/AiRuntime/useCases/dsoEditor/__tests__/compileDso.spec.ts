import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { executeDsos, resolveDsoNames } from '../compileDso';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as { value: unknown },
    executeAppAction: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    addClip: vi.fn(),
    addDevice: vi.fn(),
    setSend: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    applyChordProgressionToTrack: vi.fn(),
    applyDrumPatternToTrack: vi.fn(),
    applyMelodyToTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    humanizeNotes: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: null },
}));

vi.mock('#/modules/Transport/useCases', () => ({
    disableLooping: vi.fn(),
    setLoopRegion: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: mocks.warn,
        error: vi.fn(),
    },
}));

function trackState(tracks: Array<{ id: string; name: string }>, selectedTrackId: string | null = null) {
    return {
        tracks: tracks.map((t) => ({
            id: t.id,
            name: t.name,
            kind: 'audio',
            clips: [],
            devices: [],
        })),
        selectedTrackId,
    };
}

describe('executeDsos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
        mocks.executeAppAction.mockReset();
    });

    it('runs with an empty DSO list (smoke)', async () => {
        const result = await executeDsos([]);
        expect(result.summaries).toEqual([]);
        expect(result.failures).toEqual([]);
    });

    // Fix 3: a DSO that throws during execution must be surfaced as a failure,
    // not silently dropped while reporting unconditional success.
    it('collects per-DSO failures instead of dropping them', async () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);
        mocks.executeAppAction.mockImplementation(({ type }: { type: string }) => {
            if (type === 'renameTrack') {
                return Promise.reject(new Error('rename exploded'));
            }
            return Promise.resolve();
        });

        const dsos: Dso[] = [
            { op: 'mute_track', track_id: 'track-1', muted: true },
            { op: 'rename_track', track_id: 'track-1', name: 'Beats' },
        ];

        const result = await executeDsos(dsos);

        // The successful op is summarized; the throwing op is recorded as a failure.
        expect(result.summaries).toEqual(['Muted track']);
        expect(result.failures).toEqual([{ op: 'rename_track', reason: 'rename exploded' }]);
    });

    // Fix 6: validateDsos already rejects out-of-range bpm, so set_tempo must
    // forward dso.bpm unchanged (no redundant clamp).
    it('forwards set_tempo bpm unchanged (no clamp)', async () => {
        mocks.trackStoreValue.value = trackState([]);
        mocks.executeAppAction.mockResolvedValue(undefined);

        await executeDsos([{ op: 'set_tempo', bpm: 140 }]);

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setTempo', payload: { bpm: 140 } },
            expect.anything()
        );
    });
});

describe('resolveDsoNames', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
    });

    // Fix 4: a remove_track referencing a nonexistent track must NOT silently
    // create that track — it returns a resolution error and adds no add_track.
    it('returns a resolution error for a remove_track miss without auto-creating', () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);

        const dsos: Dso[] = [{ op: 'remove_track', track_id: 'Ghost Track' }];
        const errors = resolveDsoNames(dsos);

        expect(errors).toHaveLength(1);
        expect(errors[0]!.reason).toMatch(/Could not find track "Ghost Track"/);
        // No add_track was prepended.
        expect(dsos.map((d) => d.op)).toEqual(['remove_track']);
    });

    it('still auto-creates a track for an additive op (add_clip) miss', () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);

        const dsos: Dso[] = [
            { op: 'add_clip', track_id: 'New Bass', name: 'Bass', type: 'audio', start_beats: 0, end_beats: 4 },
        ];
        const errors = resolveDsoNames(dsos);

        expect(errors).toEqual([]);
        // An add_track DSO was prepended for the additive op's missing target.
        expect(dsos.map((d) => d.op)).toEqual(['add_track', 'add_clip']);
    });

    it('does not auto-create for mute_track / solo_track / color_track misses', () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);

        const dsos: Dso[] = [
            { op: 'mute_track', track_id: 'Nope', muted: true },
            { op: 'solo_track', track_id: 'Nope', soloed: true },
            { op: 'color_track', track_id: 'Nope', color: '#fff' },
        ];
        const errors = resolveDsoNames(dsos);

        expect(errors).toHaveLength(3);
        expect(dsos.every((d) => d.op !== 'add_track')).toBe(true);
    });
});
