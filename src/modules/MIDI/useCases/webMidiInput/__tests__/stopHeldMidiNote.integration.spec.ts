import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { activeRecordingRef, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    admitRecordingMidiExpression,
    admitRecordingMidiNoteOff,
    admitRecordingMidiNoteOn,
    findOpenRecordingMidiAdmission,
    findOpenRecordingMidiMemberAdmission,
    getRecordingMidiAdmission,
    getArrangementHandlers,
    retireRecordingMidiAdmission,
    startRecording,
    takeOwnsRecordingRoot,
    recordingMidiSourceBeatAt,
    stageRecordingTake,
    selectTake,
    resolveClipsWithComping,
} from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore, selectMidiNotesForRecordingPass } from '#/modules/MIDI/stores';
import { setMidiInputTrack, setRecordingMidiAdmissionPort } from '#/modules/MIDI/useCases';
import {
    playheadPositionRef,
    playheadClockRef,
    tempoMapStore,
    playheadWrapCountRef,
    setGestureClockSource,
    transportStore,
} from '#/modules/Transport/stores';
import { stopPlayback } from '#/modules/Transport/useCases';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { processRealtimeMidiInput } from '../../../repositories/webMidi/processRealtimeMidiInput';
import { setMpeEnabledInternal } from '../../../repositories/webMidi/setMpeEnabledInternal';
import { activeNotes } from '../../../repositories/webMidi/state';
import { handleWebMidiMessage } from '../handleWebMidiMessage';

const TRACK_ID = 'track-recording';
let disposeRecordingAdmission = (): void => {};

type RecordingTerminal = (result: {
    kind: 'completed';
    buffer: { duration: number };
    sampleZeroContextFrame: number;
    sampleRate: number;
}) => void;

const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let capturedAudioTerminal: RecordingTerminal | null = null;
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        cacheAudioBuffer: vi.fn(),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startPlayback: vi.fn<(onRoll?: (contextSeconds: number, beat: number) => void) => Promise<void>>(
            async (onRoll) => {
                onRoll?.(audioClock.currentTime, 4);
            }
        ),
        startAudioRecording: vi.fn<(trackId: string, terminal: RecordingTerminal) => Promise<boolean>>(
            (_trackId, terminal) => {
                capturedAudioTerminal = terminal;
                return Promise.resolve(true);
            }
        ),
        // The real flush settles the capture and invokes its terminal; this mock
        // does the same, so the tracked commit is registered exactly where it is
        // in production.
        stopAudioRecording: vi.fn<() => Promise<void>>(() => {
            const terminal = capturedAudioTerminal;
            capturedAudioTerminal = null;
            terminal?.({ kind: 'completed', buffer: { duration: 2 }, sampleZeroContextFrame: 0, sampleRate: 48000 });
            return Promise.resolve();
        }),
    };
});

// The Arrangement handler graph imports this barrel too, so the real module is
// spread and only the recording collaborators are replaced.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

/**
 * Holds the next `commitRecording` after its transaction has landed, so a test
 * can prove the stop path waits for the promise it owns rather than resolving
 * when an incidental microtask drain happens to have covered the commit. The
 * gate sits on the owning command entry both recording arms dispatch through,
 * so it needs no deep mock of the Arrangement recording module.
 */
const commitGate = vi.hoisted(() => ({
    beforeClipId: null as string | null,
    beforePending: null as Promise<void> | null,
    pending: null as Promise<void> | null,
    release: null as (() => void) | null,
}));

const liveMidiGate = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock('../../../repositories/webMidi/processRealtimeMidiInput', () => ({
    processRealtimeMidiInput: vi.fn(async () => {
        await liveMidiGate.pending;
        return [];
    }),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppAction: async (...args: Parameters<typeof actual.executeAppAction>) => {
            if (args[0].type === 'commitRecording' && args[0].payload.clip.id === commitGate.beforeClipId) {
                await commitGate.beforePending;
            }
            await actual.executeAppAction(...args);
            if (args[0].type === 'commitRecording' && commitGate.pending) {
                await commitGate.pending;
            }
        },
    };
});

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** Field-identical replica of Arrangement's TrackDummy fixture, as other
 *  modules' specs keep their own copy rather than deep-importing a foreign
 *  `__tests__` helper. */
function recordingTrack(kind: 'audio' | 'midi'): Track {
    return {
        id: TRACK_ID,
        name: kind === 'audio' ? 'Audio' : 'MIDI',
        kind,
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function committedEntryCount(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}

describe('stopActiveRecording commit ordering (issue #4439)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('stop active recording commit ordering');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [recordingTrack('midi')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(structuredClone(defaultMidiStoreState));
        disposeRecordingAdmission = setRecordingMidiAdmissionPort({
            admitRecordingMidiNoteOn,
            admitRecordingMidiNoteOff,
            admitRecordingMidiExpression,
            findOpenRecordingMidiAdmission,
            findOpenRecordingMidiMemberAdmission,
            getRecordingMidiAdmission,
            retireRecordingMidiAdmission,
            takeOwnsRecordingRoot,
            recordingMidiSourceBeatAt,
        });
        activeNotes.clear();
        playheadClockRef.pendingLoopSeam = null;
        setMidiInputTrack(TRACK_ID);
        playheadWrapCountRef.current = 0;
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: true, playheadPosition: 8 });
        mocks.startPlayback.mockClear();
        mocks.notifyUser.mockClear();
        mocks.audioClock.currentTime = 0;
        mocks.getCompensationDelay.mockReturnValue(0);
        vi.mocked(processRealtimeMidiInput).mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(audioEngine.context, 'currentTime');
        commitGate.beforeClipId = null;
        commitGate.beforePending = null;
        liveMidiGate.pending = null;
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(structuredClone(defaultMidiStoreState));
        activeNotes.clear();
        setMidiInputTrack(null);
        disposeRecordingAdmission();
        setMpeEnabledInternal(false);
        setGestureClockSource({
            getAudioTimeSeconds: () => mocks.audioClock.currentTime,
            readNativeCursorBeats: () => null,
        });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        { release: 'held', compensation: 0 },
        { release: 'released', compensation: 0 },
        { release: 'held', compensation: 0.005 },
    ])(
        'keeps a first-seam $release note with $compensation compensation in its selected pass through Stop',
        async ({ release, compensation }) => {
            trackStore.set({
                tracks: [
                    {
                        ...recordingTrack('midi'),
                        devices: [
                            { id: 'yeast-1', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} },
                        ],
                    },
                ],
                selectedTrackId: TRACK_ID,
                ghostClips: [],
            });
            tempoMapStore.set({ changes: [] });
            transportStore.set({
                ...transportStore.value!,
                tempo: 120,
                isPlaying: true,
                isRecording: true,
                isLooping: true,
                loopStart: 0,
                loopEnd: 8,
                playheadPosition: 6,
            });
            Object.defineProperty(audioEngine.context, 'currentTime', {
                configurable: true,
                get: () => mocks.audioClock.currentTime,
            });
            mocks.getCompensationDelay.mockReturnValue(compensation);
            mocks.audioClock.currentTime = 0.085;
            const [clip] = startRecording(6);
            if (!clip) {
                throw new Error('Missing recording clip');
            }
            // Same planned first-boundary input emitted by stageLoopWrapTakes:
            // clip starts inside [0,8), so pass0 spans source [0,2) and pass1 opens.
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: 'Take 2',
                startBeat: 0,
                endBeat: 8,
                sourceOffsetBeats: 0,
                recordingPassIndex: 0,
                passEndContextSeconds: 1.085,
                plannedPassEnd: true,
            });
            flushAutomergeStorageWrites();
            const gainNode = {} as GainNode;
            vi.spyOn(audioEngine, 'ensureTrackStrip').mockReturnValue({
                trackId: TRACK_ID,
                gainNode,
                preFaderTap: gainNode,
                faderNode: gainNode,
                postFaderGain: gainNode,
                carrierGate: gainNode,
                preFaderSendGate: gainNode,
                panNode: {} as StereoPannerNode,
                analyserNode: {} as AnalyserNode,
                meterNode: null,
                muted: false,
                nativeCarried: false,
                soloGated: false,
                soloed: false,
                deviceNodes: [],
                midiFxNodes: [],
                meterBuffer: new Float32Array(),
            });
            vi.spyOn(audioEngine, 'getTrackStrip').mockReturnValue(undefined);
            mocks.audioClock.currentTime = 1.1;
            vi.spyOn(performance, 'now').mockReturnValue(1100);
            playheadClockRef.hold = null;
            playheadClockRef.beat = 7.99;
            playheadClockRef.audioTimeSeconds = 1.08;
            playheadPositionRef.current = 7.99;
            playheadWrapCountRef.current = 0;
            playheadClockRef.pendingLoopSeam = {
                generation: playheadClockRef.generation,
                anchorBeat: playheadClockRef.beat,
                anchorAudioTimeSeconds: playheadClockRef.audioTimeSeconds,
                tempo: transportStore.value!.tempo,
                tempoMapChanges: tempoMapStore.value?.changes ?? null,
                audioTimeSeconds: 1.085,
                loopStart: 0,
                loopEnd: 8,
                passIndex: 1,
            };
            setGestureClockSource({
                getAudioTimeSeconds: () => mocks.audioClock.currentTime,
                readNativeCursorBeats: () => null,
            });
            await handleWebMidiMessage({ data: new Uint8Array([0x91, 60, 100]), timeStamp: 1100 });
            expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.recordingPassIndex).toBe(1);
            expect(activeRecordingRef.midiAdmissions[0]?.onsetSourceBeat).toBeCloseTo(2.03 - compensation * 2, 9);
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    ...midiStore.value!.notesByClipId,
                    unrelated: [{ id: 'peer', pitch: 72, startBeat: 0, duration: 1, velocity: 90 }],
                },
            });
            flushAutomergeStorageWrites();
            await handleWebMidiMessage({ data: new Uint8Array([0x91, 62, 100]), timeStamp: 1095 });
            expect(activeNotes.get(createWebMidiNoteKey(1, 62))?.recordingPassIndex).toBe(1);
            if (release === 'released') {
                mocks.audioClock.currentTime = 1.15;
                await handleWebMidiMessage({
                    data: new Uint8Array([0x81, 60, 0]),
                    timeStamp: 1150,
                });
            }
            // Arrival publishes pass1 before Stop, which now seals on that pass.
            mocks.audioClock.currentTime = 1.2;
            playheadClockRef.beat = 0.23;
            playheadClockRef.audioTimeSeconds = 1.2;
            playheadPositionRef.current = 0.23;
            playheadWrapCountRef.current = 1;
            playheadClockRef.pendingLoopSeam = null;
            await stopPlayback();
            flushAutomergeStorageWrites();
            const notes = midiStore.value?.notesByClipId[clip.id] ?? [];
            const raw = getCrdtDoc<{ midi?: typeof midiStore.value }>('root')?.midi?.notesByClipId[clip.id] ?? [];
            const incoming = takeLaneStore.value?.lanes[0]?.takes.find((take) => take.recordingPassIndex === 1);
            if (!incoming) {
                throw new Error('Missing incoming take');
            }
            await selectTake(TRACK_ID, incoming.id);
            await executeUserAppAction({
                type: 'setCompRegion',
                payload: { trackId: TRACK_ID, startBeat: 6, endBeat: 7, takeId: incoming.id },
            });
            const tracks = trackStore.value?.tracks ?? [];
            const resolved = resolveClipsWithComping(TRACK_ID, tracks[0]?.clips ?? []);
            const selected = resolved.find((entry) => entry.midiTakeRecordingPassIndex === 1);
            if (!selected) {
                throw new Error('Missing selected incoming programme');
            }
            const incomingRows = selectMidiNotesForRecordingPass(notes, selected.midiTakeRecordingPassIndex);
            expect(raw).toEqual(notes);
            expect(notes).toHaveLength(2);
            expect(notes.map((note) => note.recordingPassIndex)).toEqual([1, 1]);
            expect(notes[0]?.startBeat).toBeCloseTo(2.03 - compensation * 2, 9);
            expect(committedEntryCount()).toBe(1);
            expect(incomingRows.map((row) => row.pitch)).toEqual([60, 62]);
        }
    );

    it('seals a held MIDI note in the one Stop command before its key-up can arrive', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        flushAutomergeStorageWrites();
        // The live handler registers this note before awaiting Yeast. The
        // worker may still be held when the musician presses Stop.
        activeNotes.set(createWebMidiNoteKey(1, 60), {
            startTime: 0.5,
            startBeat: 5,
            channel: 1,
            note: 60,
            velocity: 100,
            trackId: TRACK_ID,
            recordingClipId: provisional.id,
            instrumentTrackId: TRACK_ID,
        });
        mocks.audioClock.currentTime = 1;

        await stopPlayback();

        const notes = midiStore.value?.notesByClipId[provisional.id] ?? [];
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ pitch: 60, velocity: 100 });
        expect(committedEntryCount()).toBe(1);
        await undo();
        expect(midiStore.value?.notesByClipId[provisional.id] ?? []).toEqual([]);
        await redo();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
    });

    it.each([
        { mode: 'MPE member reuse', mpeEnabled: true, channel: 1, secondPitch: 62, firstDuration: 1 },
        { mode: 'non-MPE same-pitch retrigger', mpeEnabled: false, channel: 1, secondPitch: 60, firstDuration: 1 },
        { mode: 'non-MPE polyphony', mpeEnabled: false, channel: 1, secondPitch: 62, firstDuration: 2 },
        { mode: 'MPE master polyphony', mpeEnabled: true, channel: 0, secondPitch: 62, firstDuration: 2 },
    ])(
        'seals queued $mode at the admitted event before Stop',
        async ({ mpeEnabled, channel, secondPitch, firstDuration }) => {
            trackStore.set({
                tracks: [
                    {
                        ...recordingTrack('midi'),
                        devices: [
                            { id: 'yeast-1', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} },
                        ],
                    },
                ],
                selectedTrackId: TRACK_ID,
                ghostClips: [],
            });
            const gainNode = {} as GainNode;
            vi.spyOn(audioEngine, 'ensureTrackStrip').mockReturnValue({
                trackId: TRACK_ID,
                gainNode,
                preFaderTap: gainNode,
                faderNode: gainNode,
                postFaderGain: gainNode,
                carrierGate: gainNode,
                preFaderSendGate: gainNode,
                panNode: {} as StereoPannerNode,
                analyserNode: {} as AnalyserNode,
                meterNode: null,
                muted: false,
                nativeCarried: false,
                soloGated: false,
                soloed: false,
                deviceNodes: [],
                midiFxNodes: [],
                meterBuffer: new Float32Array(),
            });
            vi.spyOn(audioEngine, 'getTrackStrip').mockReturnValue(undefined);
            const [clip] = startRecording(4);
            if (!clip) {
                throw new Error('Missing recording clip');
            }
            flushAutomergeStorageWrites();
            setMpeEnabledInternal(mpeEnabled);
            let beat = 5;
            Object.defineProperty(audioEngine.context, 'currentTime', {
                configurable: true,
                get: () => mocks.audioClock.currentTime,
            });
            mocks.audioClock.currentTime = 0.5;
            transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: beat });
            playheadPositionRef.current = beat;
            setGestureClockSource({
                getAudioTimeSeconds: () => mocks.audioClock.currentTime,
                readNativeCursorBeats: () => beat,
            });
            let release!: () => void;
            liveMidiGate.pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            const event = (bytes: number[]) => ({ data: new Uint8Array(bytes) }) as MIDIMessageEvent;

            const first = handleWebMidiMessage(event([0x90 | channel, 60, 100]));
            expect(processRealtimeMidiInput).toHaveBeenCalledOnce();
            expect(activeNotes.get(createWebMidiNoteKey(channel, 60))?.recordingAdmissionId).toBe(
                activeRecordingRef.midiAdmissions[0]?.id
            );
            beat = 6;
            playheadPositionRef.current = beat;
            mocks.audioClock.currentTime = 1;
            const second = handleWebMidiMessage(event([0x90 | channel, secondPitch, 100]));
            expect(activeRecordingRef.midiAdmissions.map((item) => item.note)).toEqual([60, secondPitch]);
            expect(activeNotes.get(createWebMidiNoteKey(channel, secondPitch))?.recordingAdmissionId).toBe(
                secondPitch === 60 ? activeRecordingRef.midiAdmissions[0]?.id : undefined
            );
            beat = 7;
            playheadPositionRef.current = beat;
            mocks.audioClock.currentTime = 1.5;

            try {
                await stopPlayback();

                const notes = midiStore.value?.notesByClipId[clip.id] ?? [];
                expect(
                    notes.map((note) => ({ pitch: note.pitch, startBeat: note.startBeat, duration: note.duration }))
                ).toEqual([
                    { pitch: 60, startBeat: 1, duration: firstDuration },
                    { pitch: secondPitch, startBeat: 2, duration: 1 },
                ]);
                expect(committedEntryCount()).toBe(1);
                await undo();
                expect(midiStore.value?.notesByClipId[clip.id] ?? []).toEqual([]);
                await redo();
                expect(midiStore.value?.notesByClipId[clip.id]).toEqual(notes);
            } finally {
                release();
                await first;
                await second;
            }
        }
    );
});
