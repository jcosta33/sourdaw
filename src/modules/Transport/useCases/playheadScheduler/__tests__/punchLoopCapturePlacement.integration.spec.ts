import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { activeRecordingRef, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    resolveClipsWithComping,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { type startAudioRecording } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
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

import { secondsBetweenBeats } from '../../../models/TempoMap';
import { defaultTransportState, tempoMapStore, transportStore } from '../../../stores';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { getTransportHandlers } from '../../getTransportHandlers';
import { recordingLifecycle } from '../../transportControls/recordingLifecycle';
import { stopActiveRecording } from '../../transportControls/stopActiveRecording';
import { stopPlayback } from '../../transportControls/stopPlayback';
import { toggleRecording } from '../../transportControls/toggleRecording';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

type RecordingResult = Parameters<Parameters<typeof startAudioRecording>[1]>[0];

const hardware = vi.hoisted(() => ({
    now: 50,
    sampleRate: 48000,
    latencySeconds: 0.1,
    terminal: null as ((result: RecordingResult) => void) | null,
    zeroFrame: 0,
    starts: 0,
    buffer: null as AudioBuffer | null,
    correlation: null as { beat: number; contextSeconds: number } | null,
    flushGate: null as Promise<void> | null,
    flushes: 0,
    finalizedAtFlush: null as { active: string[]; endBeat: number | undefined } | null,
}));

vi.mock('#/modules/AudioEngine/useCases', async (original) => {
    const real = await original<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...real,
        getAudioContext: () => ({
            sampleRate: hardware.sampleRate,
            baseLatency: hardware.latencySeconds,
            outputLatency: 0,
            get currentTime() {
                return hardware.now;
            },
            createGain: () => ({ connect: () => {}, disconnect: () => {} }),
        }),
        resumeEngine: () => Promise.resolve(),
        getCompensationDelay: () => 0,
        audioEngine: { ...real.audioEngine, setTransportInfo: vi.fn() },
        stopAllScheduled: vi.fn(),
        refreshSidechainAlignment: vi.fn(),
        scheduleAdjustmentLayers: vi.fn(),
        cancelTrackAutomationRamps: vi.fn(),
        stopNativeLiveGraphSession: () => Promise.resolve(),
        startAudioRecording: async (_id: string, terminal: (result: RecordingResult) => void) => {
            hardware.starts++;
            hardware.terminal = terminal;
            // Hardware seam: first nonempty sample is measured here on the capture clock.
            hardware.zeroFrame = Math.round(hardware.now * hardware.sampleRate);
            hardware.correlation = { beat: playheadClockRef.beat, contextSeconds: playheadClockRef.audioTimeSeconds };
            return true;
        },
        stopAudioRecording: () => {
            const terminal = hardware.terminal;
            hardware.terminal = null;
            if (!terminal) {
                return Promise.resolve();
            }
            hardware.flushes++;
            hardware.finalizedAtFlush = {
                active: [...activeRecordingRef.current],
                endBeat: trackStore.value?.tracks[0]?.clips[0]?.endBeat,
            };
            const length = Math.round(hardware.now * hardware.sampleRate) - hardware.zeroFrame;
            return Promise.resolve(hardware.flushGate).then(() => {
                const pcm = Float32Array.from({ length }, (_value, index) => index);
                const buffer: AudioBuffer = {
                    duration: length / hardware.sampleRate,
                    length,
                    sampleRate: hardware.sampleRate,
                    numberOfChannels: 1,
                    getChannelData: () => pcm,
                    copyFromChannel: (target, _channel, offset = 0) =>
                        target.set(pcm.subarray(offset, offset + target.length)),
                    copyToChannel: (source, _channel, offset = 0) => pcm.set(source, offset),
                };
                hardware.buffer = buffer;
                terminal({
                    kind: 'completed',
                    buffer,
                    sampleZeroContextFrame: hardware.zeroFrame,
                    sampleRate: hardware.sampleRate,
                });
            });
        },
        readNativeEnginePlayheadSeconds: () => null,
    };
});
vi.mock('../../scheduling/scheduleMidiNotes', () => ({ scheduleMidiNotes: () => Promise.resolve() }));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('../../scheduling/scheduleMetronome', () => ({ scheduleMetronome: vi.fn() }));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({ applyAutomation: () => new Set() }));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: () => Promise.resolve() }));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: vi.fn() }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Automation/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/Automation/useCases')>()),
    startAutomationRecording: vi.fn(),
    stopAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
}));

const TRACK_ID = 'punch-audio';
const TICK_SECONDS = 0.0625;
let sequence = 0;
type Project = { tracks: NonNullable<typeof trackStore.value>; takeLanes: NonNullable<typeof takeLaneStore.value> };

async function tick(seconds = TICK_SECONDS): Promise<void> {
    hardware.now += seconds;
    const received = performance.timeOrigin + performance.now();
    const worker = schedulerSession.worker;
    if (!worker?.onmessage) {
        throw new Error('Scheduler worker did not open');
    }
    worker.onmessage(
        new MessageEvent('message', {
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: ++sequence,
                scheduledAtMs: received - 2,
                sentAtMs: received - 1,
            },
        })
    );
    await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false), { interval: 1 });
}

async function advanceUntil(predicate: () => boolean): Promise<void> {
    for (let count = 0; count < 128 && !predicate(); count++) {
        await tick();
    }
    expect(predicate()).toBe(true);
}

function lane() {
    const result = takeLaneStore.value?.lanes.find((row) => row.trackId === TRACK_ID);
    if (!result) {
        throw new Error('Real recorder did not stage a take lane');
    }
    return result;
}

function recordedClips() {
    return trackStore.value!.tracks.find((track) => track.id === TRACK_ID)!.clips;
}

function expectProjectProjection(): void {
    flushAutomergeStorageWrites();
    const raw = getCrdtDoc<Project>('root')!;
    expect(raw.tracks.tracks).toEqual(trackStore.value!.tracks);
    expect(raw.takeLanes.lanes).toEqual(takeLaneStore.value!.lanes);
}

describe('punch audio capture loop placement', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('punch audio capture loop placement');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setArrangementEventBus(createEventBus());
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        transportStore.set({
            ...defaultTransportState,
            isPlaying: false,
            tempo: 120,
            playheadPosition: 8,
            isLooping: true,
            loopStart: 8,
            loopEnd: 12,
        });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        await executeAppAction(
            { type: 'addTrack', payload: { id: TRACK_ID, kind: 'audio', name: 'Punch audio' } },
            { skipUndo: true }
        );
        await executeAppAction({ type: 'armTrack', payload: { trackId: TRACK_ID, armed: true } }, { skipUndo: true });
        flushAutomergeStorageWrites();
        hardware.latencySeconds = 0.1;
        hardware.now = 50;
        hardware.terminal = null;
        hardware.buffer = null;
        hardware.starts = 0;
        hardware.correlation = null;
        hardware.flushGate = null;
        hardware.flushes = 0;
        hardware.finalizedAtFlush = null;
        sequence = 0;
        playheadWrapCountRef.current = 0;
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
    });

    afterEach(async () => {
        disposePlayheadScheduler();
        hardware.terminal = null;
        await recordingLifecycle.waitForCommits();
        activeRecordingRef.current = [];
        clearUndoHistory();
        clearHandlerRegistry();
        resetActionReplayAuthority();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it.each([
        { route: 'manual', boundary: 'ordinary' },
        { route: 'punch', boundary: 'ordinary' },
        { route: 'punch', boundary: 'seam' },
        { route: 'punch', boundary: 'late wrap' },
    ] as const)('$route terminal places its second pass after $boundary finalization', async ({ route, boundary }) => {
        if (route === 'punch') {
            await executeAppAction({ type: 'setPunchIn', payload: { beat: 10 } }, { skipUndo: true });
            await executeAppAction({ type: 'setPunchOut', payload: { beat: 14 } }, { skipUndo: true });
            await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
            expect(transportStore.value).toMatchObject({
                punchInEnabled: true,
                punchInBeat: 10,
                punchOutBeat: 14,
                loopStart: 8,
                loopEnd: 12,
            });
            transportStore.set({ ...transportStore.value!, isPlaying: true });
            startPlayheadScheduler();
            await advanceUntil(() => hardware.starts === 1);
        } else {
            hardware.now = 51;
            transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 10 });
            playheadPositionRef.current = 10;
            playheadClockRef.beat = 10;
            playheadClockRef.audioTimeSeconds = 51;
            toggleRecording();
            await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
            startPlayheadScheduler();
        }
        expect(hardware.zeroFrame / hardware.sampleRate).toBe(51);
        expect(hardware.correlation).toEqual({ beat: 10, contextSeconds: 51 });
        // Counter is emitted by the real scheduler; two completed pass takes prove staging routes ran.
        await advanceUntil(
            () =>
                playheadWrapCountRef.current >= 2 &&
                lane().takes.filter((take) => take.sourceOffsetBeats !== undefined).length >= 2
        );
        const second = lane().takes.find((take) => take.sourceOffsetBeats === 2);
        expect(second).toBeDefined();
        expect(
            lane()
                .takes.filter((take) => take.sourceOffsetBeats !== undefined)
                .map((take) => take.sourceOffsetBeats)
        ).toEqual([0, 2]);
        expect(second).not.toHaveProperty('passStartBeats');
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        const punchOut = { ordinary: 11, seam: 11.9, 'late wrap': 11.79 }[boundary];
        await executeAppAction({ type: 'setPunchOut', payload: { beat: punchOut } }, { skipUndo: true });
        expect(transportStore.value?.punchOutBeat).toBe(punchOut);
        if (route === 'punch') {
            if (boundary === 'late wrap') {
                // Move the loop end onto a rolling playhead below the seam
                // band. The next ordinary tick takes the real late-wrap arm.
                await advanceUntil(() => playheadPositionRef.current >= 11.75);
                expect(schedulerSession.pendingSeam).toBeNull();
                await executeAppAction(
                    { type: 'setLoopRegion', payload: { startBeat: 8, endBeat: 11.8 } },
                    { skipUndo: true }
                );
                await tick();
                expect(playheadWrapCountRef.current).toBeGreaterThan(2);
            }
            await advanceUntil(() => hardware.buffer !== null);
            if (boundary === 'seam') {
                expect(schedulerSession.pendingSeam).not.toBeNull();
            }
            await recordingLifecycle.waitForCommits();
        } else {
            await advanceUntil(() => playheadPositionRef.current >= 11);
            await stopActiveRecording();
        }
        flushAutomergeStorageWrites();
        const clips = trackStore.value!.tracks.find((track) => track.id === TRACK_ID)!.clips;
        const raw = getCrdtDoc<Project>('root')!;
        expect(raw.tracks.tracks.find((track) => track.id === TRACK_ID)!.clips).toEqual(clips);
        expect(raw.takeLanes.lanes).toEqual(takeLaneStore.value!.lanes);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]).toMatchObject({ kind: 'action', action: { type: 'commitRecording' } });
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: second!.id, startBeat: 8, endBeat: 12 } },
            { skipUndo: true }
        );
        const resolved = resolveClipsWithComping(TRACK_ID, clips);
        const fragment = resolved.find((clip) => clip.regionEndBeat === 12)!;
        const originSeconds =
            5 +
            (hardware.zeroFrame / hardware.sampleRate - hardware.correlation!.contextSeconds) -
            hardware.latencySeconds;
        const expectedSourceSeconds = 6 - 5 + 5 - originSeconds;
        const actualSourceSeconds = ((fragment.audioOffsetBeats ?? 0) * 60) / 120;
        expect(originSeconds).toBeCloseTo(4.9, 10);
        expect(clips).toHaveLength(1);
        expect(clips[0]?.startBeat).toBe(8);
        expect(clips[0]?.audioOffsetBeats).toBeCloseTo(-1.8, 10);
        if (route === 'punch') {
            // The real finalizer must close the live clip and its active set
            // before the capture flush can invoke the commit terminal.
            expect(hardware.finalizedAtFlush).toEqual({ active: [], endBeat: 12 });
        }
        expect(fragment.regionStartBeat).toBe(8);
        expect(actualSourceSeconds).toBeCloseTo(expectedSourceSeconds, 10);
        const frame = Math.round(actualSourceSeconds * hardware.sampleRate);
        expect(frame).toBe(52800);
        const media = fragment.audioBufferId && audioBufferCache.get(fragment.audioBufferId);
        expect(media).toBe(hardware.buffer);
        if (!media) {
            throw new Error('Resolved pass has no captured media');
        }
        expect(media.getChannelData(0)[frame]).toBe(52800);
        const placedPass = lane().takes.find((take) => take.id === second!.id)!;
        expect(placedPass.passAnchorSeconds).toBeCloseTo(-0.9, 10);
        expect(placedPass.passDepthSeconds).toBeCloseTo(1.1, 10);
        expect(getCrdtDoc<Project>('root')!.takeLanes.lanes).toEqual(takeLaneStore.value!.lanes);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expectProjectProjection();

        // Comp selection is deliberately outside history. One undo still owns
        // the complete recording, and redo retains its clip and pass placement.
        const committedClip = structuredClone(clips[0]);
        const committedTakes = structuredClone(lane().takes);
        await undo();
        flushAutomergeStorageWrites();
        expect(recordedClips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        expectProjectProjection();
        await redo();
        flushAutomergeStorageWrites();
        expect(recordedClips()).toEqual([committedClip]);
        expect(lane().takes).toEqual(committedTakes);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(0);
        expectProjectProjection();
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: second!.id, startBeat: 8, endBeat: 12 } },
            { skipUndo: true }
        );
        const replayed = resolveClipsWithComping(TRACK_ID, recordedClips()).find((clip) => clip.regionEndBeat === 12)!;
        expect(replayed.regionStartBeat).toBe(8);
        expect(replayed.audioOffsetBeats).toBeCloseTo(2.2, 10);
        expect(replayed.audioBufferId).toBe(fragment.audioBufferId);
        expectProjectProjection();
    });

    it('finalizes a MIDI punch without an audio capture and keeps one undoable entry', async () => {
        const midiId = 'punch-midi';
        await executeAppAction({ type: 'armTrack', payload: { trackId: TRACK_ID, armed: false } }, { skipUndo: true });
        await executeAppAction(
            { type: 'addTrack', payload: { id: midiId, kind: 'midi', name: 'Punch MIDI' } },
            { skipUndo: true }
        );
        await executeAppAction({ type: 'armTrack', payload: { trackId: midiId, armed: true } }, { skipUndo: true });
        await executeAppAction({ type: 'setPunchIn', payload: { beat: 10 } }, { skipUndo: true });
        await executeAppAction({ type: 'setPunchOut', payload: { beat: 11 } }, { skipUndo: true });
        await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        startPlayheadScheduler();
        await advanceUntil(() => transportStore.value?.isRecording === true);
        await advanceUntil(() => transportStore.value?.isRecording === false);
        await recordingLifecycle.waitForCommits();
        flushAutomergeStorageWrites();
        const clips = trackStore.value!.tracks.find((track) => track.id === midiId)!.clips;
        expect(clips).toHaveLength(1);
        expect(clips[0]).toMatchObject({ type: 'midi', startBeat: 10, endBeat: 11 });
        expect(clips[0]).not.toHaveProperty('audioBufferId');
        expect(hardware.starts).toBe(0);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]).toMatchObject({ kind: 'action', action: { type: 'commitRecording' } });
        expect(getCrdtDoc<Project>('root')!.tracks.tracks).toEqual(trackStore.value!.tracks);
        expectProjectProjection();
        await undo();
        flushAutomergeStorageWrites();
        expect(trackStore.value!.tracks.find((track) => track.id === midiId)!.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        await redo();
        flushAutomergeStorageWrites();
        expect(trackStore.value!.tracks.find((track) => track.id === midiId)!.clips).toEqual(clips);
        expect(getCrdtDoc<Project>('root')!.tracks.tracks).toEqual(trackStore.value!.tracks);
        expectProjectProjection();
    });

    it('keeps the admission clock and tempo when Stop resets the clock before capture completion', async () => {
        await executeAppAction({ type: 'setPunchIn', payload: { beat: 10 } }, { skipUndo: true });
        await executeAppAction({ type: 'setPunchOut', payload: { beat: 14 } }, { skipUndo: true });
        await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        startPlayheadScheduler();
        await advanceUntil(() => hardware.starts === 1);
        await advanceUntil(() => playheadWrapCountRef.current >= 2);
        await advanceUntil(() => playheadPositionRef.current >= 11);
        expect(hardware.correlation).toEqual({ beat: 10, contextSeconds: 51 });
        let release!: () => void;
        hardware.flushGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let stopSettled = false;
        const stopped = stopPlayback().then(() => {
            stopSettled = true;
        });
        expect(hardware.flushes).toBe(1);
        expect(activeRecordingRef.current).toEqual([]);
        expect(playheadClockRef).toEqual({ beat: 0, audioTimeSeconds: 0 });
        expect(stopSettled).toBe(false);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        // A later map and hardware clock cannot rewrite the already captured
        // correlation. The current map still owns placement of the final clip.
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
        hardware.now = 105;
        hardware.latencySeconds = 0.7;
        release();
        await stopped;
        flushAutomergeStorageWrites();
        expect(stopSettled).toBe(true);
        const [clip] = recordedClips();
        if (!clip) {
            throw new Error('Stop lost the punched capture');
        }
        expect(clip.startBeat).toBe(8);
        const origin =
            secondsBetweenBeats(tempoMapStore.value!.changes, 0, clip.startBeat, 60) -
            ((clip.audioOffsetBeats ?? 0) * 60) / 60;
        expect(origin).toBeCloseTo(4.9, 10);
        expect(audioBufferCache.get(clip.audioBufferId!)).toBe(hardware.buffer);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expectProjectProjection();
    });
});
