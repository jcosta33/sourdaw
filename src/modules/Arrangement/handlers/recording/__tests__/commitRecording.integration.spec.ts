import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    readBeatAtSamples,
    readSecondsAtBeat,
    playheadWrapCountRef,
    setGestureClockSource,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { commitRecording } from '../../../useCases/recording/commitRecording';
import { recordingPassTiming } from '../../../useCases/recording/recordingPassTiming';
import { stageRecordingTake } from '../../../useCases/recording/stageRecordingTake';
import { startRecording } from '../../../useCases/recording/startRecording';
import { stopRecording } from '../../../useCases/recording/stopRecording';
import { updateTrack } from '../../../useCases/updateTrack';

import { handleWebMidiMessage } from '#/modules/MIDI/useCases/webMidiInput/handleWebMidiMessage';
import { startPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler';
import { schedulerSession } from '#/modules/Transport/useCases/playheadScheduler/schedulerSession';
import { disposePlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler/disposePlayheadScheduler';
import { stopActiveRecording } from '#/modules/Transport/useCases/transportControls/stopActiveRecording';
import { selectMidiRecordingPassNotes } from '#/modules/MIDI/useCases/midiClipData/selectMidiRecordingPassNotes';
import { audioEngine as ownedAudioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { realtimeMidiProcessorState } from '#/modules/MIDI/repositories/webMidi/realtimeMidiProcessorState';
import { advanceMidiRecordingPass } from '#/modules/MIDI/useCases/midiRecordingSession';
import { webMidiRuntime } from '#/modules/MIDI/repositories/webMidi/state';
import { activeNotes } from '#/modules/MIDI/repositories/webMidi/state';
import { setTargetTrackId } from '#/modules/MIDI/repositories/webMidi/setTargetTrackId';
import { createWebMidiNoteKey } from '#/modules/MIDI/models/WebMidiTypes';
import { projectMidiClipWindow } from '#/modules/MIDI/useCases/midiClipData/projectMidiClipWindow';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';

const lapProbeClock = vi.hoisted(() => ({ currentTime: 1, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    audioEngine: {
        context: lapProbeClock,
        setTransportInfo: vi.fn(),
        getTrackStrip: () => undefined,
        ensureTrackStrip: () => ({ gainNode: {}, deviceNodes: [] }),
    },
    getCompensationDelay: () => 0,
    getAudioContext: () => lapProbeClock,
    stopAudioRecording: () => Promise.resolve(),
    readNativeEnginePlayheadSeconds: () => null,
    refreshSidechainAlignment: vi.fn(),
    applyNoteExpression: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/Synth/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    scheduleNote: () => null,
}));

const workerGate = vi.hoisted(() => ({ pending: null as Promise<void> | null, entered: false }));
vi.mock('#/modules/MIDI/repositories/webMidi/processRealtimeMidiInput', () => ({
    processRealtimeMidiInput: async (input: { isNoteOn: boolean }) => {
        if (!input.isNoteOn && workerGate.pending) {
            workerGate.entered = true;
            await workerGate.pending;
        }
        return [];
    },
}));
vi.mock('#/modules/Transport/useCases/scheduling/scheduleMidiNotes', () => ({
    scheduleMidiNotes: () => Promise.resolve(),
}));
vi.mock('#/modules/Transport/useCases/scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('#/modules/Transport/useCases/scheduling/scheduleMetronome', () => ({ scheduleMetronome: vi.fn() }));
vi.mock('#/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: () => new Set(),
}));
vi.mock('#/modules/Transport/useCases/scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('#/modules/Transport/useCases/transportControls/panicYeastRuntime', () => ({
    panicYeastRuntime: () => Promise.resolve(),
}));
vi.mock('#/modules/Transport/useCases/evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));

async function advanceSchedulerTo(target: number): Promise<void> {
    while (lapProbeClock.currentTime < target - 1e-9) {
        lapProbeClock.currentTime = Math.min(target, lapProbeClock.currentTime + 0.05);
        const received = performance.timeOrigin + performance.now();
        const worker = schedulerSession.worker;
        if (!worker?.onmessage) throw new Error('Expected the real scheduler worker');
        worker.onmessage(
            new MessageEvent('message', {
                data: {
                    type: 'tick',
                    generation: schedulerSession.generation,
                    sequence: Math.round(lapProbeClock.currentTime * 1000),
                    scheduledAtMs: received - 2,
                    sentAtMs: received - 1,
                },
            })
        );
        await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false), { interval: 1 });
    }
}

const TRACK_ID = 'track-audio';

function prepareAutomaticMidiPunch({ punchOut = 3, tempoMap = false, latency = 0, yeast = false } = {}): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: TRACK_ID,
                kind: 'midi',
                armed: true,
                clips: [],
                devices: yeast
                    ? [{ id: 'yeast', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }]
                    : [],
            }),
        ],
        selectedTrackId: TRACK_ID,
    });
    transportStore.set({
        ...transportStore.value!,
        tempo: 120,
        isPlaying: true,
        isRecording: false,
        isLooping: true,
        loopStart: 0,
        loopEnd: 4,
        overdubEnabled: false,
        punchInEnabled: true,
        punchInBeat: 1,
        punchOutBeat: punchOut,
        playheadPosition: 0,
    });
    tempoMapStore.set({
        changes: tempoMap
            ? [
                  { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                  { id: 'tempo-2', beat: 2, tempo: 60, curve: 'instant' },
              ]
            : [],
    });
    midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    lapProbeClock.currentTime = 0;
    lapProbeClock.baseLatency = latency;
    vi.stubGlobal(
        'Worker',
        class {
            onmessage: ((event: MessageEvent) => void) | null = null;
            postMessage = vi.fn();
            terminate = vi.fn();
            addEventListener = vi.fn();
            removeEventListener = vi.fn();
        }
    );
    setTargetTrackId(TRACK_ID);
    setGestureClockSource({ getAudioTimeSeconds: () => lapProbeClock.currentTime, readNativeCursorBeats: () => null });
    startPlayheadScheduler();
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipIds(trackId = TRACK_ID): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === trackId)?.clips ?? []).map((clip) => clip.id);
}

function takeRefs(): { id: string; clipId: string }[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) =>
        lane.takes.map((take) => ({ id: take.id, clipId: take.clipId }))
    );
}

function takeEndsFor(clipId: string): number[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) =>
        lane.takes.filter((take) => take.clipId === clipId).map((take) => take.endBeat)
    );
}

function laneIds(): string[] {
    return (takeLaneStore.value?.lanes ?? []).map((lane) => lane.id);
}

function findClip(clipId: string): Clip | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

/**
 * Issue #4439 slice 1 end to end: one recording gesture commits the recorded
 * clip, its placement, and its take-lane membership as ONE entry through the
 * owning command path. The real handlers and undo machinery run — the recorder,
 * the commit action, and the replay are all production code, so a history
 * assertion on store state alone would not prove the split is closed.
 */
describe('recording gesture commit (issue #4439)', () => {
    beforeEach(() => {
        // The recording barrel has a cyclic importer: bind the singleton as well
        // as the public adapter so both paths observe this controlled clock.
        Object.assign(ownedAudioEngine, {
            context: lapProbeClock,
            getTrackStrip: () => undefined,
            ensureTrackStrip: () => ({ gainNode: {}, deviceNodes: [] }),
            setTransportInfo: vi.fn(),
        });
        realtimeMidiProcessorState.processor = async (input) => {
            if (!input.isNoteOn && workerGate.pending) {
                workerGate.entered = true;
                await workerGate.pending;
            }
            return [];
        };
        lapProbeClock.baseLatency = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording gesture commit integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
    });

    afterEach(() => {
        disposePlayheadScheduler();
        activeNotes.clear();
        webMidiRuntime.mpeEnabled = false;
        vi.unstubAllGlobals();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('records three dispatcher attacks through actual scheduler passes and guarded selection with one exact Undo/Redo', async () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, devices: [], clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        transportStore.set({
            ...transportStore.value!,
            tempo: 120,
            isPlaying: true,
            isRecording: true,
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
            overdubEnabled: false,
            punchInEnabled: false,
            playheadPosition: 0,
        });
        tempoMapStore.set({ changes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        lapProbeClock.currentTime = 0;
        disposePlayheadScheduler();
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: MessageEvent) => void) | null = null;
                postMessage = vi.fn();
                terminate = vi.fn();
                addEventListener = vi.fn();
                removeEventListener = vi.fn();
            }
        );
        const [carrier] = startRecording(0);
        if (!carrier) throw new Error('expected real recording carrier');
        setTargetTrackId(TRACK_ID);
        setGestureClockSource({
            getAudioTimeSeconds: () => lapProbeClock.currentTime,
            readNativeCursorBeats: () => null,
        });
        startPlayheadScheduler();
        const performanceNow = vi.spyOn(performance, 'now');
        try {
            for (const [pitch, startTime] of [
                [60, 0.5],
                [72, 2.5],
                [84, 4.5],
            ]) {
                await advanceSchedulerTo(startTime + 0.05);
                performanceNow.mockReturnValue(lapProbeClock.currentTime * 1000);
                const pending = handleWebMidiMessage({
                    data: new Uint8Array([0x90, pitch, 100]),
                    timeStamp: startTime * 1000,
                });
                const admitted = activeNotes.get(createWebMidiNoteKey(0, pitch));
                expect(admitted?.startBeat).toBeCloseTo(1, 10);
                expect(admitted?.recordingWitness?.sourceBeat).toBeCloseTo(startTime * 2, 10);
                await pending;
                await advanceSchedulerTo(startTime + 0.3);
                performanceNow.mockReturnValue(lapProbeClock.currentTime * 1000);
                await handleWebMidiMessage({
                    data: new Uint8Array([0x80, pitch, 0]),
                    timeStamp: (startTime + 0.25) * 1000,
                });
            }
            expect(playheadWrapCountRef.current).toBe(2);
            await stopActiveRecording();
        } finally {
            performanceNow.mockRestore();
            setGestureClockSource({
                getAudioTimeSeconds: () => lapProbeClock.currentTime,
                readNativeCursorBeats: () => null,
            });
        }
        flushAutomergeStorageWrites();
        const stored = structuredClone(midiStore.value?.notesByClipId[carrier.id] ?? []);
        expect(stored.map((note) => note.pitch)).toEqual([60, 72, 84]);
        [1, 5, 9].forEach((beat, index) => expect(stored[index]?.startBeat).toBeCloseTo(beat, 10));
        expect(new Set(stored.map((note) => note.recordingPassId)).size).toBe(3);
        const lane = takeLaneStore.value!.lanes.find((row) => row.trackId === TRACK_ID)!;
        expect(lane.takes).toHaveLength(3);
        const committed = structuredClone({ clips: findClip(carrier.id), takes: lane.takes, notes: stored });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        for (const [index, take] of lane.takes.entries()) {
            const currentLane = takeLaneStore.value!.lanes.find((row) => row.id === lane.id)!;
            await executeAppAction(
                {
                    type: 'selectTake',
                    payload: {
                        trackId: TRACK_ID,
                        takeId: take.id,
                        expectedLaneId: lane.id,
                        expectedSelectedTakeId: currentLane.takes.find((row) => row.selected)?.id ?? null,
                    },
                },
                { skipUndo: true }
            );
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: take.id, startBeat: take.startBeat, endBeat: take.endBeat },
                },
                { skipUndo: true }
            );
            const fragment = resolveClipsWithComping(TRACK_ID, trackStore.value!.tracks[0]!.clips).find(
                (row) => row.recordingPassId === take.recordingPassId
            )!;
            const start = fragment.midiOffsetBeats ?? 0;
            const selected = selectMidiRecordingPassNotes(stored, {
                recordingPassId: fragment.recordingPassId,
                sourceStartBeat: start,
                sourceEndBeat: start + fragment.endBeat - fragment.startBeat,
            });
            expect(selected.map((note) => note.pitch)).toEqual([60, 72, 84].slice(index, index + 1));
        }
        await undo();
        expect(findClip(carrier.id)).toBeUndefined();
        expect(midiStore.value?.notesByClipId[carrier.id]).toBeUndefined();
        await redo();
        expect(findClip(carrier.id)).toEqual(committed.clips);
        expect(midiStore.value?.notesByClipId[carrier.id]).toEqual(committed.notes);
        expect(takeLaneStore.value!.lanes.find((row) => row.trackId === TRACK_ID)?.takes).toEqual(committed.takes);
    });

    it.each([3, 4])(
        'automatic punch uses real scheduler detection and clips held MIDI at exclusive punch-out $0',
        async (punchOut) => {
            prepareAutomaticMidiPunch({ punchOut });
            await advanceSchedulerTo(0.4);
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 48, 100]), timeStamp: undefined });
            await handleWebMidiMessage({ data: new Uint8Array([0x80, 48, 0]), timeStamp: undefined });
            await advanceSchedulerTo(0.75);
            expect(transportStore.value?.isRecording).toBe(true);
            const [carrier] = trackStore.value!.tracks[0]!.clips;
            expect(carrier).toBeDefined();
            // A browser-delayed pre-in message is still outside the recording,
            // even though its callback arrives after the scheduler opened it.
            const inputClock = vi.spyOn(performance, 'now').mockReturnValue(lapProbeClock.currentTime * 1000);
            try {
                await handleWebMidiMessage({ data: new Uint8Array([0x90, 36, 100]), timeStamp: 400 });
                expect(activeNotes.get(createWebMidiNoteKey(0, 36))?.recordingWitness).toBeUndefined();
                await handleWebMidiMessage({ data: new Uint8Array([0x80, 36, 0]), timeStamp: 450 });
            } finally {
                inputClock.mockRestore();
            }
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 60, 100]), timeStamp: undefined });
            const onset = activeNotes.get(createWebMidiNoteKey(0, 60))?.recordingWitness;
            expect(onset?.clipId).toBe(carrier!.id);
            expect(onset?.sourceBeat).toBeCloseTo(0.5, 10);
            const boundaryTime = punchOut / 2;
            await advanceSchedulerTo(boundaryTime - 0.05);
            expect(transportStore.value?.isRecording).toBe(true);
            lapProbeClock.currentTime = boundaryTime - 0.01;
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 72, 100]), timeStamp: undefined });
            // The exact exclusive boundary and the later callback both precede
            // the scheduler's observation, so neither may enter the journal.
            lapProbeClock.currentTime = boundaryTime;
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 80, 100]), timeStamp: undefined });
            expect(activeNotes.get(createWebMidiNoteKey(0, 80))?.recordingWitness).toBeUndefined();
            lapProbeClock.currentTime = boundaryTime + 0.04;
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 84, 100]), timeStamp: undefined });
            await advanceSchedulerTo(boundaryTime + 0.05);
            await stopActiveRecording();
            const notes = structuredClone(midiStore.value?.notesByClipId[carrier!.id] ?? []);
            expect(notes.map((note) => note.pitch)).toEqual([60, 72]);
            expect(notes[1]?.startBeat).toBeCloseTo(punchOut - 1.02, 10);
            expect(notes[1]?.duration).toBeCloseTo(0.02, 10);
            expect(notes[0]?.startBeat).toBeCloseTo(0.5, 10);
            expect(notes[0]?.duration).toBeCloseTo(punchOut - 1.5, 10);
            expect(findClip(carrier!.id)).toMatchObject({ startBeat: 1, endBeat: punchOut });
            const takes = structuredClone(takeLaneStore.value!.lanes[0]!.takes);
            expect(takes).toHaveLength(1);
            expect(takes[0]).toMatchObject({
                startBeat: 1,
                endBeat: punchOut,
                recordingPassId: notes[0]!.recordingPassId,
            });
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            await undo();
            expect(findClip(carrier!.id)).toBeUndefined();
            await handleWebMidiMessage({ data: new Uint8Array([0x80, 60, 0]), timeStamp: undefined });
            await handleWebMidiMessage({ data: new Uint8Array([0x80, 84, 0]), timeStamp: undefined });
            await handleWebMidiMessage({ data: new Uint8Array([0x80, 80, 0]), timeStamp: undefined });
            await handleWebMidiMessage({ data: new Uint8Array([0x80, 72, 0]), timeStamp: undefined });
            expect(midiStore.value?.notesByClipId[carrier!.id]).toBeUndefined();
            await redo();
            expect(midiStore.value?.notesByClipId[carrier!.id]).toEqual(notes);
            expect(takeLaneStore.value!.lanes[0]!.takes).toEqual(takes);
        }
    );

    it('automatic punch retains last-lookahead input and the initialized latency lead-in through a tempo change', async () => {
        prepareAutomaticMidiPunch({ tempoMap: true, latency: 0.1 });
        await advanceSchedulerTo(0.75);
        const [carrier] = trackStore.value!.tracks[0]!.clips;
        expect(carrier?.midiOffsetBeats).toBeCloseTo(0.2, 10);
        await handleWebMidiMessage({ data: new Uint8Array([0x90, 60, 100]), timeStamp: undefined });
        // Beat3 is at2s in this tempo map, not1.5s from a flat120bpm conversion.
        await advanceSchedulerTo(1.95);
        expect(transportStore.value?.isRecording).toBe(true);
        await handleWebMidiMessage({ data: new Uint8Array([0xb0, 64, 127]), timeStamp: undefined });
        await handleWebMidiMessage({ data: new Uint8Array([0xb0, 64, 0]), timeStamp: undefined });
        await handleWebMidiMessage({ data: new Uint8Array([0x90, 72, 100]), timeStamp: undefined });
        await advanceSchedulerTo(2.05);
        expect(transportStore.value?.isRecording).toBe(false);
        await stopActiveRecording();
        const notes = structuredClone(midiStore.value!.notesByClipId[carrier!.id]!);
        expect(notes.map((note) => note.pitch)).toEqual([60, 72]);
        expect(notes[0]?.startBeat).toBeCloseTo(0.5, 10);
        expect(notes[0]?.duration).toBeCloseTo(1.7, 10);
        expect(notes[1]?.startBeat).toBeCloseTo(2.05, 10);
        expect(notes[1]?.duration).toBeCloseTo(0.15, 10);
        const cc = structuredClone(midiStore.value!.ccByClipId[carrier!.id]);
        expect(cc?.map((row) => row.value)).toEqual([127, 0]);
        expect(findClip(carrier!.id)).toMatchObject({ startBeat: 1, endBeat: 3, midiOffsetBeats: 0.2 });
        expect(takeLaneStore.value!.lanes[0]!.takes[0]).toMatchObject({
            startBeat: 1,
            endBeat: 3,
            recordingPassId: notes[0]!.recordingPassId,
        });
        expect(notes[1]?.recordingPassId).toBe(notes[0]?.recordingPassId);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        await redo();
        expect(midiStore.value!.notesByClipId[carrier!.id]).toEqual(notes);
        expect(midiStore.value!.ccByClipId[carrier!.id]).toEqual(cc);
    });

    it.each([1.1, 1.95])(
        'automatic punch allows partial Stop at $0 and Undo before held worker release without a later terminal',
        async (stopTime) => {
            const punchOut = stopTime < 1.5 ? 3 : 4;
            prepareAutomaticMidiPunch({ yeast: true, punchOut });
            await advanceSchedulerTo(0.75);
            const [carrier] = trackStore.value!.tracks[0]!.clips;
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 60, 100]), timeStamp: undefined });
            await advanceSchedulerTo(stopTime);
            let release!: () => void;
            workerGate.entered = false;
            workerGate.pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            const pending = handleWebMidiMessage({ data: new Uint8Array([0x80, 60, 0]), timeStamp: undefined });
            await vi.waitFor(() => expect(workerGate.entered).toBe(true));
            try {
                await stopActiveRecording();
                const clip = structuredClone(findClip(carrier!.id));
                const notes = structuredClone(midiStore.value!.notesByClipId[carrier!.id]!);
                const takes = structuredClone(takeLaneStore.value!.lanes[0]!.takes);
                expect(clip?.endBeat).toBeCloseTo(stopTime * 2, 10);
                expect(takes[0]?.endBeat).toBeCloseTo(stopTime * 2, 10);
                expect(takes[0]?.recordingPassId).toBe(notes[0]?.recordingPassId);
                expect(notes[0]?.duration).toBeCloseTo(stopTime * 2 - 1.5, 10);
                expect(undoHistoryStore.value?.past).toHaveLength(1);
                await undo();
                // Continue through the former punch-out while the worker stays held.
                await advanceSchedulerTo(punchOut / 2 + 0.1);
                expect(findClip(carrier!.id)).toBeUndefined();
                expect(undoHistoryStore.value?.past).toHaveLength(0);
                release();
                await pending;
                expect(midiStore.value?.notesByClipId[carrier!.id]).toBeUndefined();
                await redo();
                expect(findClip(carrier!.id)).toEqual(clip);
                expect(midiStore.value!.notesByClipId[carrier!.id]).toEqual(notes);
                expect(takeLaneStore.value!.lanes[0]!.takes).toEqual(takes);
            } finally {
                release();
                workerGate.pending = null;
                await pending;
            }
        }
    );

    it('automatic punch stays open across actual scheduler wraps when its out point is outside the loop and Stop seals three passes', async () => {
        prepareAutomaticMidiPunch({ punchOut: 6 });
        for (const [index, time] of [0.75, 2.75, 4.75].entries()) {
            await advanceSchedulerTo(time);
            await handleWebMidiMessage({ data: new Uint8Array([0x90, 60 + index * 12, 100]), timeStamp: undefined });
            await advanceSchedulerTo(time + 0.1);
            await handleWebMidiMessage({ data: new Uint8Array([0x80, 60 + index * 12, 0]), timeStamp: undefined });
        }
        expect(playheadWrapCountRef.current).toBe(2);
        expect(transportStore.value?.isRecording).toBe(true);
        const [carrier] = trackStore.value!.tracks[0]!.clips;
        await stopActiveRecording();
        const notes = structuredClone(midiStore.value!.notesByClipId[carrier!.id]!);
        expect(notes.map((note) => note.pitch)).toEqual([60, 72, 84]);
        [0.5, 4.5, 8.5].forEach((beat, index) => expect(notes[index]?.startBeat).toBeCloseTo(beat, 10));
        const takes = structuredClone(takeLaneStore.value!.lanes[0]!.takes);
        expect(takes.map((take) => take.recordingPassId)).toEqual(notes.map((note) => note.recordingPassId));
        expect(takes).toHaveLength(3);
        const lane = takeLaneStore.value!.lanes[0]!;
        for (const [index, take] of takes.entries()) {
            await executeAppAction(
                {
                    type: 'selectTake',
                    payload: {
                        trackId: TRACK_ID,
                        takeId: take.id,
                        expectedLaneId: lane.id,
                        expectedSelectedTakeId:
                            takeLaneStore.value!.lanes[0]!.takes.find((row) => row.selected)?.id ?? null,
                    },
                },
                { skipUndo: true }
            );
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: {
                        trackId: TRACK_ID,
                        takeId: take.id,
                        startBeat: take.startBeat,
                        endBeat: take.endBeat,
                    },
                },
                { skipUndo: true }
            );
            const fragment = resolveClipsWithComping(TRACK_ID, trackStore.value!.tracks[0]!.clips).find(
                (row) => row.recordingPassId === take.recordingPassId
            )!;
            const offset = fragment.midiOffsetBeats ?? 0;
            expect(
                selectMidiRecordingPassNotes(notes, {
                    recordingPassId: fragment.recordingPassId,
                    sourceStartBeat: offset,
                    sourceEndBeat: offset + fragment.endBeat - fragment.startBeat,
                }).map((note) => note.pitch)
            ).toEqual([60 + index * 12]);
        }
        expect(takes[2]?.endBeat).toBeCloseTo(1.7, 10);
        expect(findClip(carrier!.id)?.endBeat).toBe(4);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        await redo();
        expect(midiStore.value!.notesByClipId[carrier!.id]).toEqual(notes);
        expect(takeLaneStore.value!.lanes[0]!.takes).toEqual(takes);
    });

    it('seals a held-worker release so Stop and Undo settle before worker completion and late release writes nothing', async () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: TRACK_ID,
                    kind: 'midi',
                    armed: true,
                    devices: [{ id: 'yeast', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }],
                    clips: [],
                }),
            ],
            selectedTrackId: TRACK_ID,
        });
        transportStore.set({
            ...transportStore.value!,
            tempo: 120,
            isPlaying: true,
            isRecording: true,
            isLooping: false,
            overdubEnabled: false,
            playheadPosition: 0,
        });
        tempoMapStore.set({ changes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        lapProbeClock.currentTime = 0;
        const [carrier] = startRecording(0);
        if (!carrier) throw new Error('expected recording carrier');
        setTargetTrackId(TRACK_ID);
        setGestureClockSource({
            getAudioTimeSeconds: () => lapProbeClock.currentTime,
            readNativeCursorBeats: () => lapProbeClock.currentTime * 2,
        });
        lapProbeClock.currentTime = 0.5;
        await handleWebMidiMessage({ data: new Uint8Array([0x90, 60, 100]), timeStamp: undefined });
        let release!: () => void;
        workerGate.entered = false;
        workerGate.pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        lapProbeClock.currentTime = 1;
        const pendingRelease = handleWebMidiMessage({ data: new Uint8Array([0x80, 60, 0]), timeStamp: undefined });
        await vi.waitFor(() => expect(workerGate.entered).toBe(true));
        try {
            await stopActiveRecording();
            const recorded = structuredClone(midiStore.value?.notesByClipId[carrier.id]);
            expect(recorded).toHaveLength(1);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            await undo();
            expect(findClip(carrier.id)).toBeUndefined();
            release();
            await pendingRelease;
            expect(midiStore.value?.notesByClipId[carrier.id]).toBeUndefined();
            expect(findClip(carrier.id)).toBeUndefined();
            await redo();
            expect(midiStore.value?.notesByClipId[carrier.id]).toEqual(recorded);
        } finally {
            release();
            workerGate.pending = null;
            await pendingRelease;
        }
    });

    it('keeps a held seam tail and expression on the onset pass and redoes same-beat controller order', async () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, devices: [], clips: [] })],
            selectedTrackId: TRACK_ID,
        });
        transportStore.set({
            ...transportStore.value!,
            tempo: 120,
            isPlaying: true,
            isRecording: true,
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
            overdubEnabled: false,
            playheadPosition: 0,
        });
        tempoMapStore.set({ changes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        lapProbeClock.currentTime = 0;
        playheadWrapCountRef.current = 0;
        setGestureClockSource({
            getAudioTimeSeconds: () => lapProbeClock.currentTime,
            readNativeCursorBeats: () => (lapProbeClock.currentTime % 2) * 2,
        });
        const [carrier] = startRecording(0);
        if (!carrier) throw new Error('expected carrier');
        setTargetTrackId(TRACK_ID);
        webMidiRuntime.mpeEnabled = true;
        lapProbeClock.currentTime = 0.5;
        await handleWebMidiMessage({ data: new Uint8Array([0x91, 60, 100]), timeStamp: undefined });
        lapProbeClock.currentTime = 0.75;
        await handleWebMidiMessage({ data: new Uint8Array([0xd1, 30]), timeStamp: undefined });
        lapProbeClock.currentTime = 0.9;
        await handleWebMidiMessage({ data: new Uint8Array([0xb0, 64, 127]), timeStamp: undefined });
        await handleWebMidiMessage({ data: new Uint8Array([0xb0, 64, 0]), timeStamp: undefined });
        setTargetTrackId('different-track');
        updateTrack(TRACK_ID, (track) => ({ ...track, armed: false }));
        advanceMidiRecordingPass({ audioTime: 2, fromBeat: 4, toBeat: 0 });
        playheadWrapCountRef.current = 1;
        lapProbeClock.currentTime = 2.25;
        await handleWebMidiMessage({ data: new Uint8Array([0xd1, 70]), timeStamp: undefined });
        lapProbeClock.currentTime = 2.3;
        await handleWebMidiMessage({ data: new Uint8Array([0xb1, 74, 75]), timeStamp: undefined });
        lapProbeClock.currentTime = 2.35;
        await handleWebMidiMessage({ data: new Uint8Array([0xe1, 0, 96]), timeStamp: undefined });
        setTargetTrackId(TRACK_ID);
        updateTrack(TRACK_ID, (track) => ({ ...track, armed: true }));
        lapProbeClock.currentTime = 2.5;
        await handleWebMidiMessage({ data: new Uint8Array([0x91, 72, 100]), timeStamp: undefined });
        lapProbeClock.currentTime = 2.75;
        await handleWebMidiMessage({ data: new Uint8Array([0x81, 72, 0]), timeStamp: undefined });
        await stopActiveRecording();
        const notes = structuredClone(midiStore.value!.notesByClipId[carrier.id]!);
        expect(notes.map((note) => note.pitch)).toEqual([60, 72]);
        expect(notes[0]?.recordingPassId).not.toBe(notes[1]?.recordingPassId);
        expect(notes[0]?.expression?.pressure?.at(-1)?.value).toBe(70);
        expect(notes[0]?.expression?.slide?.at(-1)?.value).toBe(75);
        expect(notes[0]?.expression?.pitchBend?.at(-1)?.value).toBe(4096);
        const first = selectMidiRecordingPassNotes(notes, {
            recordingPassId: notes[0]!.recordingPassId,
            sourceStartBeat: 0,
            sourceEndBeat: 4,
        });
        expect(first.map((note) => note.pitch)).toEqual([60]);
        expect(first[0]?.duration).toBeCloseTo(3, 10);
        expect(first[0]?.expression?.pressure).toEqual([{ offsetBeats: 0.5, value: 30 }]);
        expect(
            selectMidiRecordingPassNotes(notes, {
                recordingPassId: notes[1]!.recordingPassId,
                sourceStartBeat: 4,
                sourceEndBeat: 5.5,
            }).map((note) => note.pitch)
        ).toEqual([72]);
        const cc = structuredClone(midiStore.value!.ccByClipId[carrier.id]);
        expect(cc?.map((row) => row.value)).toEqual([127, 0]);
        await undo();
        await redo();
        expect(midiStore.value!.notesByClipId[carrier.id]).toEqual(notes);
        expect(midiStore.value!.ccByClipId[carrier.id]).toEqual(cc);
    });

    it.each([
        { start: 2, loopStart: 4, loopEnd: 8, seam: 3, tempoMap: false, expected: [1, 7] },
        { start: 2, loopStart: 0, loopEnd: 4, seam: 2, tempoMap: true, expected: [0.5, 3] },
    ])(
        'recording source geometry keeps run-up or mid-loop timing with latency and tempo map ($start/$tempoMap)',
        async ({ start, loopStart, loopEnd, seam, tempoMap, expected }) => {
            trackStore.set({
                tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, devices: [], clips: [] })],
                selectedTrackId: TRACK_ID,
            });
            transportStore.set({
                ...transportStore.value!,
                tempo: 120,
                isPlaying: true,
                isRecording: true,
                isLooping: true,
                loopStart,
                loopEnd,
                overdubEnabled: false,
                playheadPosition: start,
            });
            tempoMapStore.set({
                changes: tempoMap
                    ? [
                          { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                          { id: 'tempo-2', beat: 2, tempo: 60, curve: 'instant' },
                      ]
                    : [],
            });
            midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
            lapProbeClock.currentTime = 0;
            lapProbeClock.baseLatency = 0.1;
            playheadWrapCountRef.current = 0;
            const origin = readSecondsAtBeat({ beat: start });
            setGestureClockSource({
                getAudioTimeSeconds: () => lapProbeClock.currentTime,
                readNativeCursorBeats: () =>
                    readBeatAtSamples({
                        samples:
                            lapProbeClock.currentTime < seam
                                ? origin + lapProbeClock.currentTime
                                : readSecondsAtBeat({ beat: loopStart }) + lapProbeClock.currentTime - seam,
                        sampleRate: 1,
                    }),
            });
            const [carrier] = startRecording(start);
            if (!carrier) throw new Error('expected geometry carrier');
            setTargetTrackId(TRACK_ID);
            for (const [index, onset] of [0.6, seam + 0.6].entries()) {
                if (index === 1) {
                    advanceMidiRecordingPass({ audioTime: seam, fromBeat: loopEnd, toBeat: loopStart });
                    playheadWrapCountRef.current = 1;
                }
                lapProbeClock.currentTime = onset;
                await handleWebMidiMessage({
                    data: new Uint8Array([0x90, index === 0 ? 60 : 72, 100]),
                    timeStamp: undefined,
                });
                lapProbeClock.currentTime = onset + 0.2;
                await handleWebMidiMessage({
                    data: new Uint8Array([0x80, index === 0 ? 60 : 72, 0]),
                    timeStamp: undefined,
                });
            }
            lapProbeClock.currentTime = seam + 0.9;
            await stopActiveRecording();
            const notes = midiStore.value!.notesByClipId[carrier.id]!;
            expected.forEach((beat, index) => expect(notes[index]?.startBeat).toBeCloseTo(beat, 10));
            expect(notes[0]?.recordingPassId).not.toBe(notes[1]?.recordingPassId);
            const takes = takeLaneStore.value!.lanes.find((lane) => lane.trackId === TRACK_ID)!.takes;
            expect(takes.map((take) => take.recordingPassId)).toEqual(notes.map((note) => note.recordingPassId));
            expect(takes[0]?.startBeat).toBe(start);
            expect(takes[1]?.startBeat).toBe(loopStart);
            expect(takes[1]?.endBeat).toBeCloseTo(loopStart + 1.8, 10);
        }
    );

    it('commits a successful capture as exactly one action entry', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();

        const past = undoHistoryStore.value?.past ?? [];
        expect(past).toHaveLength(1);
        const entry = past[0];
        if (entry?.kind !== 'action') {
            throw new Error('expected exactly one action history entry');
        }
        expect(entry.action.type).toBe('commitRecording');
        expect(entry.inverseAction?.type).toBe('discardRecording');
        expect(entry.redoAction?.type).toBe('restoreRecording');
    });

    it('removes the clip, its placement, and its take membership on one undo, and restores the same identities on redo', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs()[0]?.id;
        expect(recordedTakeId).toBeTruthy();

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisional.id]);
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(findClip(provisional.id)).toMatchObject({
            id: provisional.id,
            startBeat: 4,
            endBeat: 6,
            audioBufferId: 'rec-buffer-1',
        });
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);
    });

    // The ordinary audio terminal commits buffer truth: a 0.125 s capture is
    // 0.25 beats at the default 120 BPM, inside the one-beat minimum the live
    // stop gives the clip and its take. Letting that short end overwrite the
    // floored live state would leave the take outlasting its own clip (#4994),
    // so the durable write and the entry's redo must both carry the floored end.
    it('commits a short capture at the one-beat minimum its take took, and restores that end on redo', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs()[0]?.id;
        expect(recordedTakeId).toBeTruthy();

        // The user-facing stop closes the gesture — the live clip and its take
        // take start + 1 — and the capture terminal then commits the buffer's
        // own 0.25-beat end over that state.
        await stopRecording(4.25);
        flushAutomergeStorageWrites();
        expect(findClip(provisional.id)).toMatchObject({ startBeat: 4, endBeat: 5 });
        expect(takeEndsFor(provisional.id)).toEqual([5]);

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 4.25 });
        flushAutomergeStorageWrites();
        expect(findClip(provisional.id)).toMatchObject({ startBeat: 4, endBeat: 5 });
        expect(takeEndsFor(provisional.id)).toEqual([5]);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(findClip(provisional.id)).toMatchObject({ id: provisional.id, startBeat: 4, endBeat: 5 });
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);
        expect(takeEndsFor(provisional.id)).toEqual([5]);
    });

    it('keeps a pre-existing take lane and its unrelated take through undo and redo', async () => {
        const unrelatedClip: Clip = {
            id: 'clip-other',
            trackId: TRACK_ID,
            name: 'Other',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', armed: true, clips: [unrelatedClip] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        const unrelatedTake = createTake('clip-other', 'Take 1', 0, 4);
        takeLaneStore.set({ lanes: [{ ...createTakeLane(TRACK_ID), takes: [unrelatedTake] }] });
        flushAutomergeStorageWrites();

        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs().find((take) => take.clipId === provisional.id)?.id;
        expect(recordedTakeId).toBeTruthy();

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(takeRefs()).toEqual([
            { id: unrelatedTake.id, clipId: 'clip-other' },
            { id: recordedTakeId, clipId: provisional.id },
        ]);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual(['clip-other']);
        expect(takeRefs()).toEqual([{ id: unrelatedTake.id, clipId: 'clip-other' }]);
        expect(laneIds()).toHaveLength(1);

        await redo();
        flushAutomergeStorageWrites();
        expect(takeRefs()).toEqual([
            { id: unrelatedTake.id, clipId: 'clip-other' },
            { id: recordedTakeId, clipId: provisional.id },
        ]);
    });

    it('commits nothing for a capture that never completes', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();

        expect(undoHistoryStore.value).not.toBeNull();
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);

        // Undo has no entry to replay, so the provisional clip stands exactly as
        // the recorder left it — an incomplete capture never becomes a replayable
        // entry, and the failure path retires it through `removeClip` instead.
        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisional.id]);
    });

    it('removes and restores every take the one gesture captured', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        // A loop wrap stages another take for the same clip inside the same
        // gesture; the one commit owns both.
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Take 2',
            startBeat: 0,
            endBeat: 4,
            sourceOffsetBeats: 0,
        });
        flushAutomergeStorageWrites();
        const recordedTakeIds = takeRefs().map((take) => take.id);
        expect(recordedTakeIds).toHaveLength(2);

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

        await undo();
        flushAutomergeStorageWrites();
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(takeRefs().map((take) => take.id)).toEqual(recordedTakeIds);
    });

    it('commits an armed MIDI take as exactly one action entry when the recording stops', async () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });

        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        // A loop wrap stages another take for the same clip inside the same
        // gesture; the one commit must own both.
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Take 2',
            startBeat: 0,
            endBeat: 4,
            sourceOffsetBeats: 0,
        });
        flushAutomergeStorageWrites();
        const recordedTakeIds = takeRefs().map((take) => take.id);
        expect(recordedTakeIds).toHaveLength(2);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);

        // The takes and the clip commit here. The recorded NOTES stay the MIDI
        // module's own actions, which this slice leaves alone.
        await stopRecording(8);
        flushAutomergeStorageWrites();
        // A MIDI clip stays on its record point, whatever span its passes name.
        const committedMidiClip = { id: provisional.id, startBeat: 4, endBeat: 8, type: 'midi' };

        const past = undoHistoryStore.value?.past ?? [];
        expect(past).toHaveLength(1);
        const entry = past[0];
        if (entry?.kind !== 'action') {
            throw new Error('expected exactly one action history entry');
        }
        expect(entry.action.type).toBe('commitRecording');
        expect(findClip(provisional.id)).toMatchObject(committedMidiClip);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(findClip(provisional.id)).toMatchObject(committedMidiClip);
        expect(takeRefs().map((take) => take.id)).toEqual(recordedTakeIds);
    });

    it('commits one entry per armed track result when an audio and a MIDI track are armed together', async () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: TRACK_ID, kind: 'audio', armed: true, clips: [] }),
                TrackDummy.create({ id: 'track-midi', kind: 'midi', armed: true, clips: [] }),
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });

        const clips = startRecording(4);
        expect(clips).toHaveLength(2);
        flushAutomergeStorageWrites();
        // Neither arm's take callback writes history: one clip each, no entries yet.
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);

        // The MIDI result commits at stop, the audio result at its capture terminal.
        await stopRecording(8);
        flushAutomergeStorageWrites();
        expect(
            (undoHistoryStore.value?.past ?? []).map((entry) =>
                entry.kind === 'action' ? entry.action.type : entry.kind
            )
        ).toEqual(['commitRecording']);

        const audioClip = clips.find((clip) => clip.type === 'audio');
        if (!audioClip) {
            throw new Error('expected an audio recording clip');
        }
        await commitRecording({ ...audioClip, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(
            (undoHistoryStore.value?.past ?? []).map((entry) =>
                entry.kind === 'action' ? entry.action.type : entry.kind
            )
        ).toEqual(['commitRecording', 'commitRecording']);

        await undo();
        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds(TRACK_ID)).toEqual([]);
        expect(clipIds('track-midi')).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);
    });

    it('keeps an unrelated clip added after the undo when the recording is redone', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();

        await undo();
        flushAutomergeStorageWrites();
        const unrelated: Clip = {
            id: 'clip-later',
            trackId: TRACK_ID,
            name: 'Later',
            startBeat: 8,
            endBeat: 12,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        updateTrack(TRACK_ID, (track) => ({ ...track, clips: [...track.clips, unrelated] }));
        flushAutomergeStorageWrites();

        await redo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toContain('clip-later');
        expect(clipIds()).toContain(provisional.id);
    });

    it('restores a recorded MIDI take with its notes, controller, and pitch-bend state after undo and redo', async () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        const notes = [{ id: 'note-1', pitch: 60, startBeat: 4, duration: 1, velocity: 100 }];
        const cc = [{ id: 'cc-1', controller: 1, value: 64, beat: 4, channel: 1 }];
        const pitchBend = [{ id: 'pb-1', value: 2048, beat: 4, channel: 1 }];
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { [provisional.id]: notes },
            ccByClipId: { [provisional.id]: cc },
            pitchBendByClipId: { [provisional.id]: pitchBend },
        });
        flushAutomergeStorageWrites();

        await stopRecording(8);
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);

        // The removal inverse deletes the clip's MIDI data with the clip, so the
        // entry's redo has to carry it; a redo that restored clip and takes alone
        // handed back an empty MIDI take.
        await undo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[provisional.id]).toBeUndefined();

        await redo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
        expect(midiStore.value?.ccByClipId[provisional.id]).toEqual(cc);
        expect(midiStore.value?.pitchBendByClipId[provisional.id]).toEqual(pitchBend);
    });

    it('restores a recorded MIDI note with its expression curves after undo and redo', async () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        const notes = [
            {
                id: 'note-1',
                pitch: 60,
                startBeat: 4,
                duration: 2,
                velocity: 100,
                pressure: 10,
                pitchBendRangeSemitones: 48,
                expression: {
                    pressure: [
                        { offsetBeats: 1, value: 90 },
                        { offsetBeats: 1.8, value: 20 },
                    ],
                    slide: [{ offsetBeats: 1, value: 64 }],
                    pitchBend: [
                        { offsetBeats: 0.5, value: 4096 },
                        { offsetBeats: 1.5, value: 0 },
                    ],
                },
            },
        ];
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { [provisional.id]: notes },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();

        await stopRecording(8);
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);

        await undo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[provisional.id]).toBeUndefined();

        await redo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
    });

    it('restores the recorded clip once when the redo target is already present', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();

        await undo();
        flushAutomergeStorageWrites();
        // A projection re-adds the clip under the same id before the redo.
        const reappeared = { ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 } as Clip;
        updateTrack(TRACK_ID, (track) => ({ ...track, clips: [...track.clips, reappeared] }));
        flushAutomergeStorageWrites();

        await redo();
        flushAutomergeStorageWrites();
        expect(clipIds().filter((id) => id === provisional.id)).toHaveLength(1);
    });

    it('commits the placed passes in the one entry and replays them on redo', async () => {
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Take 2',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
        });
        flushAutomergeStorageWrites();
        const recordedPlacements = (): (number | undefined)[][] =>
            (takeLaneStore.value?.lanes ?? []).flatMap((lane) =>
                lane.takes.map((take) => [take.passAnchorSeconds, take.passDepthSeconds])
            );

        // The capture began a quarter second (half a beat at 120 BPM) before the
        // record point, and the clip opens on that origin. The take opened with
        // the recording plays the clip's own media and is not placed; the pass
        // starts a quarter second into the clip's media and into the recording.
        await commitRecording(
            { ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 3.5, endBeat: 6 },
            { provisionalStartBeat: 4, mediaOriginSeconds: 1.75, sourceContextOriginSeconds: 1.75 }
        );
        flushAutomergeStorageWrites();
        const placed = [
            [undefined, undefined],
            [0.25, 0.25],
        ];

        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);
        expect(recordedPlacements()).toEqual(placed);

        await undo();
        flushAutomergeStorageWrites();
        expect(recordedPlacements()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(recordedPlacements()).toEqual(placed);
    });

    it('retires a staged audio pass witness after a capture-free Command commit', async () => {
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional audio clip');
        }
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Pass 2',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
        });
        const staged = takeLaneStore.value?.lanes.flatMap((lane) => lane.takes).find((take) => take.name === 'Pass 2');
        if (!staged) {
            throw new Error('expected a staged audio pass');
        }
        expect(recordingPassTiming.depthSeconds(staged, 0, 0)).toBeCloseTo(2, 10);

        flushAutomergeStorageWrites();
        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', endBeat: 8 });
        flushAutomergeStorageWrites();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(
            getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root')?.tracks.tracks[0]?.clips
        ).toMatchObject([{ id: provisional.id, audioBufferId: 'rec-buffer-1' }]);

        expect(() => recordingPassTiming.depthSeconds(staged, 0, 0)).toThrow(
            'Recording pass has no captured source timing'
        );
    });

    it('retires only the committed capture and preserves a concurrent recording witness', async () => {
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        const [provisional] = startRecording(4);
        expect(provisional).toBeDefined();
        const concurrentId = 'concurrent-audio-capture';
        recordingPassTiming.begin(concurrentId, 6);
        const concurrent = createTake(concurrentId, 'Concurrent pass', 6, 10, 0);
        recordingPassTiming.stage(concurrent);
        const before = recordingPassTiming.depthSeconds(concurrent, 0, 0);
        flushAutomergeStorageWrites();
        await commitRecording({ ...provisional!, audioBufferId: 'rec-buffer-1', endBeat: 8 });
        expect(recordingPassTiming.depthSeconds(concurrent, 0, 0)).toBe(before);
        recordingPassTiming.retire(concurrentId);
    });

    it('retires a staged audio pass witness after a capture-supplied Command commit', async () => {
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional audio clip');
        }
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Pass 2',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
        });
        const staged = takeLaneStore.value?.lanes.flatMap((lane) => lane.takes).find((take) => take.name === 'Pass 2');
        if (!staged) {
            throw new Error('expected a staged audio pass');
        }
        expect(recordingPassTiming.depthSeconds(staged, 50, 2)).toBeCloseTo(0, 10);

        flushAutomergeStorageWrites();
        await commitRecording(
            { ...provisional, audioBufferId: 'rec-buffer-2', endBeat: 8 },
            { provisionalStartBeat: 4, mediaOriginSeconds: 2, sourceContextOriginSeconds: 50 }
        );
        flushAutomergeStorageWrites();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(() => recordingPassTiming.depthSeconds(staged, 50, 2)).toThrow(
            'Recording pass has no captured source timing'
        );
    });

    it('keeps capture-free MIDI Command commits witness-free', async () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'MIDI pass 2',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
        });
        const staged = takeLaneStore.value?.lanes
            .flatMap((lane) => lane.takes)
            .find((take) => take.name === 'MIDI pass 2');
        if (!staged) {
            throw new Error('expected a staged MIDI pass');
        }
        expect(() => recordingPassTiming.depthSeconds(staged, 0, 0)).toThrow(
            'Recording pass has no captured source timing'
        );

        flushAutomergeStorageWrites();
        await commitRecording({ ...provisional, endBeat: 8 });
        flushAutomergeStorageWrites();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(() => recordingPassTiming.depthSeconds(staged, 0, 0)).toThrow(
            'Recording pass has no captured source timing'
        );
    });
});
