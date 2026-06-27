import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { executeDsos, resolveDsoNames } from '../compileDso';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as { value: unknown },
    transportStoreValue: { value: null } as { value: unknown },
    midiStoreValue: { value: null } as { value: unknown },
    transportStoreSet: vi.fn(),
    midiStoreSet: vi.fn(),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    addClip: vi.fn(),
    addDevice: vi.fn(),
    setSend: vi.fn(),
    humanizeNotes: vi.fn(),
    executeAppAction: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: mocks.addTrack,
    removeTrack: mocks.removeTrack,
    addClip: mocks.addClip,
    addDevice: mocks.addDevice,
    setSend: mocks.setSend,
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
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    humanizeNotes: mocks.humanizeNotes,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStoreValue.value;
        },
        set: mocks.transportStoreSet,
    },
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
        mocks.transportStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.executeAppAction.mockReset();
        mocks.executeAppAction.mockResolvedValue(undefined);
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

    it('should route compiled DAW mutations through executeAppAction instead of direct writers', async () => {
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    kind: 'midi',
                    clips: [{ id: 'clip-1', name: 'Pattern', type: 'midi', startBeat: 4, endBeat: 8 }],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
        };
        mocks.transportStoreValue.value = {
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };
        mocks.midiStoreValue.value = {
            notesByClipId: { 'clip-1': [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        await executeDsos([
            { op: 'add_track', track_id: 'track-new', name: 'Keys', kind: 'midi' },
            { op: 'remove_track', track_id: 'track-1' },
            { op: 'set_time_signature', numerator: 7, denominator: 8 },
            {
                op: 'add_midi_notes',
                clip_id: 'clip-1',
                notes: [{ pitch: 60, start_beat: 1, duration: 2, velocity: 96 }],
            },
            { op: 'humanize_midi', clip_id: 'clip-1', timing_amount: 0.2, velocity_amount: 0.3 },
            { op: 'create_send', from_track_id: 'track-1', to_track_id: 'bus-1', gain: 0.5 },
            { op: 'set_loop', enabled: false, start_beats: 0, end_beats: 4 },
        ]);

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.removeTrack).not.toHaveBeenCalled();
        expect(mocks.transportStoreSet).not.toHaveBeenCalled();
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
        expect(mocks.humanizeNotes).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'addTrack', payload: { id: 'track-new', name: 'Keys', kind: 'midi' } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'removeTrack', payload: { trackId: 'track-1' } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            {
                type: 'addNotes',
                payload: {
                    clipId: 'clip-1',
                    notes: [{ pitch: 60, startBeat: 5, duration: 2, velocity: 96 }],
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'humanizeNotes', payload: { clipId: 'clip-1', amount: 0.2, velocityAmount: 0.3 } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setSend', payload: { trackId: 'track-1', busId: 'bus-1', level: 0.5 } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'toggleLoop' },
            expect.objectContaining({ source: 'ai', skipUndo: true })
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
