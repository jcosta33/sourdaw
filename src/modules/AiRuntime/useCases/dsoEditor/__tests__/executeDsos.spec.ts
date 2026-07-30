import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { executeDsos } from '../executeDsos';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: unknown } = { value: null };
    const transportStoreValue: { value: unknown } = { value: null };
    const midiStoreValue: { value: unknown } = { value: null };
    return {
        trackStoreValue,
        transportStoreValue,
        midiStoreValue,
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
    };
});

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

    it('compiles an enabled loop into separate bounds and enabled-state writes', async () => {
        mocks.trackStoreValue.value = trackState([]);
        mocks.executeAppAction.mockResolvedValue(undefined);

        await executeDsos([{ op: 'set_loop', enabled: true, start_beats: 8, end_beats: 16 }]);

        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            1,
            { type: 'setLoopRegion', payload: { startBeat: 8, endBeat: 16 } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            2,
            { type: 'setLoopEnabled', payload: { enabled: true } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
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
            { type: 'setLoopEnabled', payload: { enabled: false } },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
    });

    it('should preserve generation style alias payload mappings', async () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Generator' }]);

        await executeDsos([
            {
                op: 'generate_melody',
                track_id: 'track-1',
                start_beat: 8,
                style: 'AMBIENT',
                key: 'C',
                scale: 'WHOLE-TONE',
                octave: 4,
                bars: 2,
                density: 0.75,
            },
            {
                op: 'generate_chords',
                track_id: 'track-1',
                start_beat: 4,
                key: 'D',
                progression: 'ii-V-I',
                bars: 4,
                voicing: 'drop2',
            },
            {
                op: 'generate_chords',
                track_id: 'track-1',
                key: 'E',
                progression: 'I-IV-V-I',
                bars: 8,
                voicing: 'basic',
            },
            { op: 'generate_drums', track_id: 'track-1', start_beat: 12, style: 'hiphop', bars: 1, density: 0.5 },
            { op: 'generate_drums', track_id: 'track-1', style: 'funk', bars: 1, density: 0.5 },
        ]);

        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            1,
            {
                type: 'generateMelody',
                payload: {
                    trackId: 'track-1',
                    style: 'ambient',
                    key: 60,
                    scale: 'whole-tone',
                    octave: 4,
                    bars: 2,
                    density: 0.75,
                    startBeat: 8,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            2,
            {
                type: 'generateChordProgression',
                payload: {
                    trackId: 'track-1',
                    style: 'jazz',
                    key: 62,
                    scale: 'major',
                    bars: 4,
                    voicing: 'open',
                    startBeat: 4,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            3,
            {
                type: 'generateChordProgression',
                payload: {
                    trackId: 'track-1',
                    style: 'blues',
                    key: 64,
                    scale: 'major',
                    bars: 8,
                    voicing: 'close',
                    startBeat: 0,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            4,
            {
                type: 'generateDrumPattern',
                payload: {
                    trackId: 'track-1',
                    style: 'trap',
                    bars: 1,
                    density: 0.5,
                    startBeat: 12,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            5,
            {
                type: 'generateDrumPattern',
                payload: {
                    trackId: 'track-1',
                    style: 'breakbeat',
                    bars: 1,
                    density: 0.5,
                    startBeat: 0,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
    });

    it('should default unknown generation style values before dispatch', async () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Generator' }]);

        await executeDsos([
            {
                op: 'generate_melody',
                track_id: 'track-1',
                style: 'sparkle',
                key: 'C',
                scale: 'cosmic',
                octave: 4,
                bars: 2,
                density: 0.75,
            },
            {
                op: 'generate_chords',
                track_id: 'track-1',
                key: 'C',
                progression: 'space-jam',
                bars: 4,
                voicing: 'galaxy',
            },
            { op: 'generate_drums', track_id: 'track-1', style: 'marching', bars: 1, density: 0.5 },
        ]);

        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            1,
            {
                type: 'generateMelody',
                payload: {
                    trackId: 'track-1',
                    style: 'simple',
                    key: 60,
                    scale: 'major',
                    octave: 4,
                    bars: 2,
                    density: 0.75,
                    startBeat: 0,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            2,
            {
                type: 'generateChordProgression',
                payload: {
                    trackId: 'track-1',
                    style: 'pop',
                    key: 60,
                    scale: 'major',
                    bars: 4,
                    voicing: 'close',
                    startBeat: 0,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            3,
            {
                type: 'generateDrumPattern',
                payload: {
                    trackId: 'track-1',
                    style: 'rock',
                    bars: 1,
                    density: 0.5,
                    startBeat: 0,
                },
            },
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.warn).toHaveBeenNthCalledWith(1, 'DSO: unknown melody style "sparkle", defaulting to "simple".');
        expect(mocks.warn).toHaveBeenNthCalledWith(2, 'DSO: unknown scale type "cosmic", defaulting to "major".');
        expect(mocks.warn).toHaveBeenNthCalledWith(
            3,
            'DSO: unknown chord progression style "space-jam", defaulting to "pop".'
        );
        expect(mocks.warn).toHaveBeenNthCalledWith(4, 'DSO: unknown chord voicing "galaxy", defaulting to "close".');
        expect(mocks.warn).toHaveBeenNthCalledWith(5, 'DSO: unknown drum style "marching", defaulting to "rock".');
    });

    it('should surface invalid time signature execution instead of summarizing it as applied', async () => {
        mocks.trackStoreValue.value = trackState([]);

        const result = await executeDsos([{ op: 'set_time_signature', numerator: 7, denominator: 3 }]);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(result.summaries).toEqual([]);
        expect(result.failures).toEqual([
            { op: 'set_time_signature', reason: 'Time signature denominator 3 must be one of 2, 4, 8, or 16' },
        ]);
    });
});
