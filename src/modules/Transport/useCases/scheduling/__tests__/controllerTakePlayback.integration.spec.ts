import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Web MIDI input the take's live route listens on. Stubbed before the MIDI
 * module loads, because its supported-platform check reads `navigator` once at
 * import.
 */
const liveMidi = vi.hoisted(() => {
    const input = Object.assign(new EventTarget(), { id: 'live-input', name: 'Live input', manufacturer: 'Test' });
    const access = { inputs: new Map([[input.id, input]]), outputs: new Map(), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.resolve(access),
    });
    return { input };
});

/** What the engine double answers with: each track strip's device nodes, and what its Grand Boule received. */
const engineStub = vi.hoisted(() => ({
    nodes: [] as unknown[],
    sustain: [] as string[],
    noteOns: 0,
    /** The per-note expression the scheduler asked the instrument for, as pitch, bend, depth and frame. */
    expressions: [] as {
        note: number;
        pitchBend: number | undefined;
        range: number | undefined;
        frame: number | undefined;
    }[],
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    applyNoteExpression: (input: {
        note: number;
        expression: { pitchBend?: number };
        bendRangeSemitones?: number;
        sampleFrame?: number;
    }) => {
        engineStub.expressions.push({
            note: input.note,
            pitchBend: input.expression.pitchBend,
            range: input.bendRangeSemitones,
            frame: input.sampleFrame,
        });
        return true;
    },
    getAudioContext: () => ({ sampleRate: 48_000, createGain: () => ({ connect: () => undefined }) }),
    getCurrentTime: () => 0,
    getCompensationDelay: () => 0,
    ensureTrackStrip: () => ({
        gainNode: {},
        preFaderTap: { connect: () => undefined },
        deviceNodes: engineStub.nodes,
    }),
    getTrackStrip: () => ({ deviceNodes: engineStub.nodes }),
}));

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    duplicateClip,
    getArrangementHandlers,
    startRecording,
    stopRecording,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { destroyWebMidi, initWebMidi, setMidiInputTrack, setWebMidiRuntimeEventBus } from '#/modules/MIDI/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import {
    forgetStoredControllerEngagements,
    noteStoredControllerPost,
} from '../../../services/storedControllerEngagement';
import { transportStore } from '../../../stores/transportStore';
import { forgetHeldNoteExpression } from '../forgetHeldNoteExpression';
import { scheduleMidiNotes } from '../scheduleMidiNotes';

const TRACK_ID = 'track-midi';
const DEVICE_ID = 'gb-1';
/** At 120 BPM and 48 kHz a beat is 24 000 frames. */
const BEAT_FRAMES = 24_000;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/**
 * A controller-only take, recorded through the Web MIDI input route into the
 * real stores, played by the real window scheduler: its stored pedal reaches the
 * instrument although the take never wrote a note list. The scheduler, the
 * relocation restore and the real projections are production code; only the
 * engine surface (the audio context and the Grand Boule node) is doubled.
 */
describe('a recorded controller-only take, played by the window scheduler', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('controller take playback integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        forgetStoredControllerEngagements();
        forgetHeldNoteExpression();
        engineStub.sustain = [];
        engineStub.noteOns = 0;
        engineStub.expressions = [];
        engineStub.nodes = [
            {
                type: 'grand-boule',
                deviceId: DEVICE_ID,
                grandBouleControls: {
                    noteOn: () => {
                        engineStub.noteOns += 1;
                    },
                    noteOff: () => undefined,
                    noteExpression: () => undefined,
                    setSustain: (position: number, frame?: number) => {
                        engineStub.sustain.push(`sustain ${position} @${frame}`);
                    },
                    setSostenuto: () => undefined,
                    setUnaCorda: () => undefined,
                },
            },
        ];
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: TRACK_ID, name: 'Piano', kind: 'midi', withoutDefaultDevice: true }),
                    armed: true,
                    devices: [
                        {
                            id: DEVICE_ID,
                            name: 'Grand Boule',
                            type: 'grand-boule',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                },
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({
            ...transportStore.value!,
            isRecording: false,
            overdubEnabled: false,
            isLooping: false,
            playheadPosition: 4,
        });
    });

    afterEach(() => {
        transportStore.set({ ...transportStore.value!, isRecording: false, overdubEnabled: false });
        destroyWebMidi();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    /** Record a sustain press at beat 4.5 and release at 5.5 on the live input into a clip spanning beats 4 to 8. */
    async function recordPedalOnlyTake(): Promise<string> {
        setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
        await initWebMidi();
        setMidiInputTrack(TRACK_ID);
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        transportStore.set({ ...transportStore.value!, isRecording: true });
        const send = (beat: number, ...bytes: number[]): void => {
            transportStore.set({ ...transportStore.value!, playheadPosition: beat });
            liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
        };
        send(4.5, 0xb0, 64, 127);
        send(5.5, 0xb0, 64, 0);
        await stopRecording(8);
        transportStore.set({ ...transportStore.value!, isRecording: false });
        flushAutomergeStorageWrites();
        return provisional.id;
    }

    /**
     * Record a pitch-wheel bend out to full at beat 4.5 and back to centre at 5.5 on the live input into a
     * clip spanning beats 4 to 8, then give the clip the held note the performer played over it.
     */
    async function recordBendTake(): Promise<string> {
        setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
        await initWebMidi();
        setMidiInputTrack(TRACK_ID);
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        transportStore.set({ ...transportStore.value!, isRecording: true });
        const send = (beat: number, ...bytes: number[]): void => {
            transportStore.set({ ...transportStore.value!, playheadPosition: beat });
            liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
        };
        // 14-bit 16383 (full bend up) and 8192 (centre), least significant byte first.
        send(4.5, 0xe0, 127, 127);
        send(5.5, 0xe0, 0, 64);
        await stopRecording(8);
        transportStore.set({ ...transportStore.value!, isRecording: false });
        flushAutomergeStorageWrites();
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { [provisional.id]: [{ id: 'held', pitch: 60, startBeat: 0, duration: 3, velocity: 100 }] },
        });
        return provisional.id;
    }

    const playWindow = (fromBeat: number, toBeat: number) =>
        scheduleMidiNotes(fromBeat, toBeat, 0, new Set<string>(), [], defaultTransportState, 120);

    it('plays the stored pedal in the live window without a note list, and undo and redo take it away and give it back', async () => {
        const clipId = await recordPedalOnlyTake();
        expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();

        await playWindow(0, 12);
        expect(engineStub.sustain).toEqual([`sustain 1 @${4.5 * BEAT_FRAMES}`, `sustain 0 @${5.5 * BEAT_FRAMES}`]);
        expect(engineStub.noteOns).toBe(0);

        await undo();
        flushAutomergeStorageWrites();
        engineStub.sustain = [];
        await playWindow(0, 12);
        expect(engineStub.sustain).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        await playWindow(0, 12);
        expect(engineStub.sustain).toEqual([`sustain 1 @${4.5 * BEAT_FRAMES}`, `sustain 0 @${5.5 * BEAT_FRAMES}`]);
        expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
    });

    it('carries the pedal of the take into a relocation that lands inside it', async () => {
        await recordPedalOnlyTake();
        noteStoredControllerPost({ trackId: TRACK_ID, deviceId: DEVICE_ID, deviceType: 'grand-boule', pedal: 64 });

        await scheduleMidiNotes(5, 5.25, 5, new Set<string>(), [], defaultTransportState, 120, undefined, true);

        expect(engineStub.sustain).toEqual(['sustain 1 @0']);
    });

    it('plays the bend recorded from the pitch wheel on the note held over it, out and back', async () => {
        const clipId = await recordBendTake();
        expect(midiStore.value?.pitchBendByClipId[clipId]?.map(({ value, beat }) => [value, beat])).toEqual([
            [8191, 0.5],
            [0, 1.5],
        ]);

        await playWindow(0, 12);

        expect(engineStub.expressions).toEqual([
            // The note-on's own update: no bend is in force when the note is struck.
            { note: 60, pitchBend: undefined, range: undefined, frame: 4 * BEAT_FRAMES },
            { note: 60, pitchBend: 8191, range: 2, frame: 4.5 * BEAT_FRAMES },
            { note: 60, pitchBend: 0, range: 2, frame: 5.5 * BEAT_FRAMES },
        ]);
    });

    it('plays the stored pedal of a duplicate of the take, which copies the rows and no note list', async () => {
        const clipId = await recordPedalOnlyTake();
        expect(duplicateClip(clipId)).toBe(true);
        const copy = trackStore.value!.tracks.flatMap((track) => track.clips).find(({ id }) => id !== clipId)!;
        expect(copy.startBeat).toBe(8);
        expect(midiStore.value?.ccByClipId[copy.id]).toHaveLength(2);
        expect(midiStore.value?.notesByClipId[copy.id]).toBeUndefined();

        await playWindow(8, 12);

        expect(engineStub.sustain).toEqual([`sustain 1 @${8.5 * BEAT_FRAMES}`, `sustain 0 @${9.5 * BEAT_FRAMES}`]);
    });
});
