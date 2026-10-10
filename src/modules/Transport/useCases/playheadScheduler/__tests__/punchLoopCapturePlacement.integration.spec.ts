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
import { executePlayheadSeek } from '../../transportControls/executePlayheadSeek';
import { finalizeAutomaticRecording } from '../../transportControls/finalizeAutomaticRecording';
import { pausePlayback } from '../../transportControls/pausePlayback';
import { recordingLifecycle } from '../../transportControls/recordingLifecycle';
import { startPlayback } from '../../transportControls/startPlayback';
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
    drainSeconds: 0,
    captureEndSeconds: null as number | null,
    terminal: null as ((result: RecordingResult) => void) | null,
    zeroFrame: 0,
    deferFirstFrame: false,
    starts: 0,
    buffer: null as AudioBuffer | null,
    correlation: null as { beat: number; contextSeconds: number } | null,
    flushGate: null as Promise<void> | null,
    flushes: 0,
    admissionGate: null as Promise<void> | null,
    rollGate: null as Promise<void> | null,
    nativeHold: false,
    followJump: null as number | null,
    rollStarts: 0,
    rollContinuationAdvance: 0,
    sourceStarts: [] as { contextSeconds: number; sourceSeconds: number; durationSeconds: number }[],
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
            createGain: () => ({
                connect: () => {},
                disconnect: () => {},
                gain: {
                    cancelScheduledValues: () => {},
                    setValueAtTime: () => {},
                    linearRampToValueAtTime: () => {},
                },
            }),
        }),
        getCurrentTime: () => hardware.now,
        ensureTrackStrip: () => ({ gainNode: {} }),
        createBufferSource: () => ({
            connect: () => {},
            disconnect: () => {},
            playbackRate: { value: 1 },
            start: (contextSeconds: number, sourceSeconds: number, durationSeconds: number) => {
                hardware.sourceStarts.push({ contextSeconds, sourceSeconds, durationSeconds });
            },
        }),
        resumeEngine: () => Promise.resolve(),
        nativeLiveGraphSessionOffered: () => hardware.nativeHold,
        getCompensationDelay: () => 0,
        audioEngine: { ...real.audioEngine, setTransportInfo: vi.fn() },
        stopAllScheduled: vi.fn(),
        refreshSidechainAlignment: vi.fn(),
        scheduleAdjustmentLayers: vi.fn(),
        cancelTrackAutomationRamps: vi.fn(),
        stopNativeLiveGraphSession: () => Promise.resolve(),
        startAudioRecording: async (
            _id: string,
            terminal: (result: RecordingResult) => void,
            _inputId: string | null | undefined,
            onCaptureClock?: Parameters<typeof real.startAudioRecording>[3]
        ) => {
            hardware.starts++;
            hardware.terminal = terminal;
            await hardware.admissionGate;
            // Hardware seam: first nonempty sample is measured here on the capture clock.
            if (!hardware.deferFirstFrame) {
                hardware.zeroFrame = Math.round(hardware.now * hardware.sampleRate);
            }
            onCaptureClock?.(() => {
                if (hardware.zeroFrame === 0) {
                    return { status: 'pending' };
                }
                return {
                    status: 'captured',
                    contextSeconds: hardware.zeroFrame / hardware.sampleRate,
                };
            });
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
            const length =
                Math.round((hardware.captureEndSeconds ?? hardware.now + hardware.drainSeconds) * hardware.sampleRate) -
                hardware.zeroFrame;
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
vi.mock('../../transportControls/startNativeSessionAtBeat', () => ({
    startNativeSessionAtBeat: () => {
        hardware.rollStarts++;
        return hardware.rollGate ?? Promise.resolve();
    },
}));
vi.mock('../../transportControls/startPlayback', async (original) => {
    const real = await original<typeof import('../../transportControls/startPlayback')>();
    return {
        startPlayback: async (...args: Parameters<typeof real.startPlayback>) => {
            await real.startPlayback(...args);
            hardware.now += hardware.rollContinuationAdvance;
        },
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
    evaluateFollowActions: () => ({ jumpToPosition: hardware.followJump, shouldStop: false }),
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

async function expectUncompedSourceEnding(endBeat: number): Promise<void> {
    const { scheduleAudioClips } = await vi.importActual<typeof import('../../scheduling/scheduleAudioClips')>(
        '../../scheduling/scheduleAudioClips'
    );
    const clip = recordedClips()[0]!;
    hardware.sourceStarts = [];
    scheduleAudioClips(clip.startBeat, clip.endBeat, clip.startBeat, new Set(), new Set(), [], {
        ...transportStore.value!,
        isLooping: false,
    });
    expect(hardware.sourceStarts).toHaveLength(1);
    const source = hardware.sourceStarts[0]!;
    expect(source.contextSeconds + source.durationSeconds - hardware.now).toBeCloseTo(
        (endBeat - clip.startBeat) / 2,
        10
    );
    const firstFrame = Math.round(source.sourceSeconds * hardware.sampleRate);
    const lastFrame = Math.round((source.sourceSeconds + source.durationSeconds) * hardware.sampleRate) - 1;
    expect(hardware.buffer!.getChannelData(0)[firstFrame]).toBe(firstFrame);
    expect(hardware.buffer!.getChannelData(0)[lastFrame]).toBe(lastFrame);
    expect(lastFrame).toBeLessThan(hardware.buffer!.length - 1);
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
        hardware.drainSeconds = 0;
        hardware.captureEndSeconds = null;
        hardware.starts = 0;
        hardware.deferFirstFrame = false;
        hardware.zeroFrame = 0;
        hardware.correlation = null;
        hardware.flushGate = null;
        hardware.flushes = 0;
        hardware.finalizedAtFlush = null;
        hardware.sourceStarts = [];
        hardware.admissionGate = null;
        hardware.rollGate = null;
        hardware.nativeHold = false;
        hardware.followJump = null;
        hardware.rollStarts = 0;
        hardware.rollContinuationAdvance = 0;
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

    it('places automatic punch first media on its sounded traversal and retains completed-pass PCM', async () => {
        hardware.deferFirstFrame = true;
        await executeAppAction({ type: 'setPunchIn', payload: { beat: 10 } }, { skipUndo: true });
        await executeAppAction({ type: 'setPunchOut', payload: { beat: 14 } }, { skipUndo: true });
        await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        startPlayheadScheduler();
        await advanceUntil(() => hardware.starts === 1);
        await advanceUntil(() => playheadWrapCountRef.current >= 1);
        const firstFrameBeat = playheadClockRef.beat;
        const firstSeamContextSeconds = schedulerSession.lastLoopSeamAudioTime!;
        const firstWrapTakeIds = new Set(lane().takes.map((take) => take.id));
        hardware.zeroFrame = Math.round(hardware.now * hardware.sampleRate);
        await advanceUntil(() => playheadWrapCountRef.current >= 2);
        const secondSeamContextSeconds = schedulerSession.lastLoopSeamAudioTime!;
        hardware.now = secondSeamContextSeconds + 0.25;
        await stopPlayback();
        const clip = recordedClips()[0];
        expect(clip).toBeDefined();
        const capturedPass = lane().takes.find(
            (take) =>
                !firstWrapTakeIds.has(take.id) &&
                take.startBeat === 8 &&
                take.endBeat === 12 &&
                take.passDepthSeconds !== undefined
        );
        expect(capturedPass).toBeDefined();
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: TRACK_ID, takeId: capturedPass!.id, startBeat: 8, endBeat: 12 },
            },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find((take) => take.regionStartBeat === 8);
        expect(selected).toBeDefined();
        const sourceSeconds = ((selected!.audioOffsetBeats ?? 0) * 60) / 120;
        // Wrap staging names the dying pass, from the first sounded seam
        // to the second. The incoming partial lap is not a staged take.
        const expectedSourceSeconds = firstSeamContextSeconds - hardware.zeroFrame / hardware.sampleRate + 0.1;
        expect(firstFrameBeat).toBeCloseTo(8, 6);
        expect(secondSeamContextSeconds - firstSeamContextSeconds).toBeCloseTo(2, 10);
        expect(clip!.startBeat - (clip!.audioOffsetBeats ?? 0)).toBeCloseTo(firstFrameBeat - 0.2, 6);
        expect(capturedPass!.sourceOffsetBeats).toBe(2);
        expect(capturedPass!.passDepthSeconds).toBeCloseTo(expectedSourceSeconds, 6);
        expect(sourceSeconds).toBeCloseTo(expectedSourceSeconds, 6);
        const frame = Math.round(sourceSeconds * hardware.sampleRate);
        expect(hardware.buffer!.getChannelData(0)[frame]).toBe(Math.round(expectedSourceSeconds * hardware.sampleRate));
        expectProjectProjection();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        const committedClips = structuredClone(recordedClips());
        const committedTakes = structuredClone(lane().takes);
        await undo();
        expect(recordedClips()).toEqual([]);
        expectProjectProjection();
        await redo();
        expect(recordedClips()).toEqual(committedClips);
        expect(lane().takes).toEqual(committedTakes);
        expectProjectProjection();
    });

    it.each([1, 3])('places manual PCM whose first frame arrives after %s rolling loop wraps', async (wraps) => {
        hardware.now = 51;
        hardware.deferFirstFrame = true;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 11.8 });
        playheadPositionRef.current = 11.8;
        playheadClockRef.beat = 11.8;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await advanceUntil(() => playheadWrapCountRef.current >= wraps);
        const firstFrameBeat = playheadClockRef.beat;
        hardware.zeroFrame = Math.round(hardware.now * hardware.sampleRate);
        await advanceUntil(() => playheadWrapCountRef.current >= wraps + 1);
        await stopPlayback();
        const [clip] = recordedClips();
        expect(clip).toBeDefined();
        // At 120 BPM, 100 ms of latency puts the first recorded sample
        // 0.2 beat before the physical position after the wrap.
        const firstMediaBeat = clip!.startBeat - (clip!.audioOffsetBeats ?? 0);
        expect(firstMediaBeat).toBeCloseTo(firstFrameBeat - 0.2, 6);
        expectProjectProjection();
        expect(lane().takes.every((take) => take.passDepthSeconds === undefined || take.passDepthSeconds >= 0)).toBe(
            true
        );
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        const committedClips = structuredClone(recordedClips());
        const committedTakes = structuredClone(lane().takes);
        await undo();
        expect(recordedClips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expectProjectProjection();
        await redo();
        expect(recordedClips()).toEqual(committedClips);
        expect(lane().takes).toEqual(committedTakes);
        expectProjectProjection();
        const capturedPass = lane().takes.find((take) => take.startBeat === 8)!;
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: TRACK_ID, takeId: capturedPass.id, startBeat: 8, endBeat: 12 },
            },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find((take) => take.regionStartBeat === 8)!;
        const sourceSeconds = (selected.audioOffsetBeats ?? 0) / 2;
        expect(sourceSeconds).toBeCloseTo(0.075, 10);
        expect(hardware.buffer!.getChannelData(0)[Math.round(sourceSeconds * hardware.sampleRate)]).toBe(3600);
    });

    it.each(['manual', 'punch'] as const)(
        '%s places pre-PCM tempo edits on the effective sounded traversal',
        async (route) => {
            hardware.now = 51;
            hardware.deferFirstFrame = true;
            transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 11.8 });
            playheadPositionRef.current = 11.8;
            playheadClockRef.beat = 11.8;
            playheadClockRef.audioTimeSeconds = 51;
            if (route === 'punch') {
                transportStore.set({ ...transportStore.value!, isPlaying: false });
                await executeAppAction({ type: 'setPunchIn', payload: { beat: 11.8 } }, { skipUndo: true });
                await executeAppAction({ type: 'setPunchOut', payload: { beat: 14 } }, { skipUndo: true });
                await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
                transportStore.set({ ...transportStore.value!, isPlaying: true });
                startPlayheadScheduler();
                await tick(0.01);
            } else {
                toggleRecording();
            }
            await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
            await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
            if (route === 'manual') {
                startPlayheadScheduler();
            }
            await advanceUntil(() => playheadWrapCountRef.current >= 1);
            const seam = schedulerSession.lastLoopSeamAudioTime!;
            hardware.zeroFrame = Math.round((seam + 0.05) * hardware.sampleRate);
            await tick(0.05);
            hardware.latencySeconds = 0.7;
            await advanceUntil(() => playheadWrapCountRef.current >= 2);
            hardware.now = schedulerSession.lastLoopSeamAudioTime! + 0.25;
            await stopPlayback();
            const clip = recordedClips()[0]!;
            const mediaOrigin =
                secondsBetweenBeats(tempoMapStore.value!.changes, 0, clip.startBeat, 60) - (clip.audioOffsetBeats ?? 0);
            expect(mediaOrigin).toBeCloseTo(7.95, 10);
            const fullPass = lane().takes.find((take) => take.startBeat === 8 && take.endBeat === 12)!;
            expect(fullPass).toBeDefined();
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: {
                        trackId: TRACK_ID,
                        takeId: fullPass.id,
                        startBeat: 8,
                        endBeat: 12,
                    },
                },
                { skipUndo: true }
            );
            const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (entry) => entry.regionStartBeat === 8
            )!;
            expect(selected.audioOffsetBeats).toBeCloseTo(0.05, 10);
            expect(
                hardware.buffer!.getChannelData(0)[Math.round(selected.audioOffsetBeats! * hardware.sampleRate)]
            ).toBe(2400);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expectProjectProjection();
            const takes = structuredClone(lane().takes);
            const clips = structuredClone(recordedClips());
            await undo();
            expect(recordedClips()).toEqual([]);
            expectProjectProjection();
            await redo();
            expect(lane().takes).toEqual(takes);
            expect(recordedClips()).toEqual(clips);
            expectProjectProjection();
        }
    );

    it('places first PCM after a rolling tempo edit before any loop seam', async () => {
        hardware.now = 51;
        hardware.deferFirstFrame = true;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 10 });
        playheadPositionRef.current = 10;
        playheadClockRef.beat = 10;
        playheadClockRef.audioTimeSeconds = 51;
        startPlayheadScheduler();
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
        await tick();
        hardware.zeroFrame = Math.round(51.1 * hardware.sampleRate);
        await tick();
        hardware.now = 51.3;
        await stopPlayback();
        const clip = recordedClips()[0]!;
        expect(clip.startBeat - (clip.audioOffsetBeats ?? 0)).toBeCloseTo(10, 10);
        expect(hardware.buffer!.getChannelData(0)[0]).toBe(0);
        expect(hardware.buffer!.length).toBe(9600);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expectProjectProjection();
    });

    it('keeps a first PCM frame that precedes the first observed tempo edit in its sounded epoch', async () => {
        hardware.now = 51;
        hardware.deferFirstFrame = true;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 10 });
        playheadPositionRef.current = 10;
        playheadClockRef.beat = 10;
        playheadClockRef.audioTimeSeconds = 51;
        startPlayheadScheduler();
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        hardware.zeroFrame = Math.round(51.05 * hardware.sampleRate);
        hardware.now = 51.06;
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
        await tick(0.0025);
        hardware.now = 51.3;
        await stopPlayback();
        const clip = recordedClips()[0]!;
        expect(clip.startBeat - (clip.audioOffsetBeats ?? 0)).toBeCloseTo(4.95, 10);
        expect(hardware.buffer!.getChannelData(0)[0]).toBe(0);
        expect(hardware.buffer!.length).toBe(12000);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expectProjectProjection();
    });

    it('replans an unsounded seam for a genuine base tempo edit with a value-equal map', async () => {
        hardware.now = 51;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 11.8 });
        startPlayheadScheduler();
        await tick(0.01);
        expect(schedulerSession.pendingSeam?.seamAudioTime).toBeCloseTo(51.1, 10);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
        tempoMapStore.set({ changes: [] });
        await tick(0.05);
        expect(schedulerSession.pendingSeam).toBeNull();
        expect(playheadWrapCountRef.current).toBe(0);
        await tick(0.04);
        expect(schedulerSession.pendingSeam?.seamAudioTime).toBeGreaterThan(51.13);
        expect(playheadWrapCountRef.current).toBe(0);
    });

    it('bounds a completed pass by its PCM when the incoming lap contains no captured frames', async () => {
        hardware.now = 51;
        hardware.deferFirstFrame = true;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 10 });
        playheadPositionRef.current = 10;
        playheadClockRef.beat = 10;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await advanceUntil(() => hardware.now >= 51.5625);
        hardware.zeroFrame = Math.round(51.6 * hardware.sampleRate);
        await advanceUntil(() => playheadWrapCountRef.current >= 1);
        hardware.captureEndSeconds = 52;
        hardware.now = 52.2;
        await stopPlayback();
        expect(hardware.buffer!.duration).toBeCloseTo(0.4, 10);
        const pass = lane().takes.find((take) => take.sourceOffsetBeats === 0)!;
        expect(pass.startBeat).toBeCloseTo(11, 10);
        expect(pass.endBeat).toBeCloseTo(11.8, 10);
        expect(pass.passSourceEndSeconds).toBeCloseTo(0.4, 10);
        expect(lane().takes.filter((take) => take.passDepthSeconds !== undefined)).toHaveLength(1);
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: {
                    trackId: TRACK_ID,
                    takeId: pass.id,
                    startBeat: 11,
                    endBeat: 12,
                },
            },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (entry) => entry.regionStartBeat === 11
        )!;
        expect(selected.regionEndBeat).toBeCloseTo(11.8, 10);
        const { scheduleAudioClips } = await vi.importActual<typeof import('../../scheduling/scheduleAudioClips')>(
            '../../scheduling/scheduleAudioClips'
        );
        hardware.sourceStarts = [];
        scheduleAudioClips(11, 11.8, 11, new Set(), new Set(), [], { ...transportStore.value!, isLooping: false });
        expect(hardware.sourceStarts[0]?.sourceSeconds).toBe(0);
        expect(hardware.sourceStarts[0]?.durationSeconds).toBeCloseTo(0.4, 10);
        const lastFrame =
            Math.round(((selected.audioOffsetBeats ?? 0) / 2 + (11.8 - 11) / 2) * hardware.sampleRate) - 1;
        expect(lastFrame).toBe(hardware.buffer!.length - 1);
        expect(hardware.buffer!.getChannelData(0)[lastFrame]).toBe(lastFrame);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expectProjectProjection();
        const takes = structuredClone(lane().takes);
        await undo();
        expect(recordedClips()).toEqual([]);
        expectProjectProjection();
        await redo();
        expect(lane().takes).toEqual(takes);
        expectProjectProjection();
    });

    it.each([60, 240])(
        'retains the source ending and intended carrier after a real %s BPM edit before Stop',
        async (tempo) => {
            hardware.now = 51;
            transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 10 });
            playheadPositionRef.current = 10;
            playheadClockRef.beat = 10;
            playheadClockRef.audioTimeSeconds = 51;
            toggleRecording();
            await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
            startPlayheadScheduler();
            await advanceUntil(() => schedulerSession.pendingSeam !== null);
            const soundedBoundary = schedulerSession.pendingSeam!.seamAudioTime;
            await advanceUntil(() => hardware.now >= soundedBoundary);
            const completedId = lane().takes.find((take) => take.sourceOffsetBeats === 0)!.id;
            await executeAppAction({ type: 'setTempo', payload: { bpm: tempo } }, { skipUndo: true });
            await tick(0.0625);
            await advanceUntil(
                () => playheadPositionRef.current >= 8.2 && hardware.now > soundedBoundary + hardware.latencySeconds
            );
            await stopPlayback();
            const completed = lane().takes.find((take) => take.id === completedId)!;
            expect(completed.passDepthSeconds).toBeCloseTo(0.1, 10);
            expect(completed.passSourceEndSeconds).toBeCloseTo(1.1, 10);
            const incoming = lane().takes.find(
                (take) => take.id !== completedId && take.passDepthSeconds !== undefined
            )!;
            expect(incoming.passDepthSeconds).toBeCloseTo(1.1, 10);
            expect(incoming.passSourceEndSeconds!).toBeGreaterThan(incoming.passDepthSeconds!);
            expect(completed.endBeat).toBeLessThanOrEqual(12);
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: completed.id, startBeat: 10, endBeat: 16 },
                },
                { skipUndo: true }
            );
            const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (entry) => entry.regionStartBeat === 10
            )!;
            expect(selected.regionEndBeat).toBeCloseTo(Math.min(12, 10 + tempo / 60), 10);
            const sourceEnd =
                ((selected.audioOffsetBeats ?? 0) * 60) / tempo +
                ((selected.regionEndBeat - selected.regionStartBeat) * 60) / tempo;
            expect(sourceEnd).toBeLessThanOrEqual(completed.passSourceEndSeconds! + 1e-10);
            expect(hardware.buffer!.getChannelData(0)[52799]).toBe(52799);
            expect(recordedClips()[0]!.endBeat).toBeLessThanOrEqual(12);
            const takes = structuredClone(lane().takes);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            await undo();
            await redo();
            expect(lane().takes).toEqual(takes);
            expectProjectProjection();
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: completed.id, startBeat: 10, endBeat: 16 },
                },
                { skipUndo: true }
            );
            await executeAppAction(
                { type: 'trimClipEnd', payload: { clipId: recordedClips()[0]!.id, newEndBeat: 16 } },
                { skipUndo: true }
            );
            const revealed = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (entry) => entry.regionStartBeat === 10
            )!;
            const revealedEnd =
                ((revealed.audioOffsetBeats ?? 0) * 60) / tempo +
                ((revealed.regionEndBeat - revealed.regionStartBeat) * 60) / tempo;
            expect(revealedEnd).toBeCloseTo(1.1, 10);
            expect(lane().takes.find((take) => take.id === completedId)?.passSourceEndSeconds).toBeCloseTo(1.1, 10);
        }
    );

    it('places manual PCM whose first frame arrives after a sounded seam between the last tick and Stop', async () => {
        hardware.now = 51;
        hardware.deferFirstFrame = true;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 11.8 });
        playheadPositionRef.current = 11.8;
        playheadClockRef.beat = 11.8;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await tick();
        expect(schedulerSession.pendingSeam?.seamAudioTime).toBeCloseTo(51.1, 10);
        expect(playheadWrapCountRef.current).toBe(0);
        hardware.now = 51.125;
        hardware.zeroFrame = Math.round(hardware.now * hardware.sampleRate);
        hardware.now = 51.375;
        await stopPlayback();
        const clip = recordedClips()[0]!;
        expect(clip.startBeat - (clip.audioOffsetBeats ?? 0)).toBeCloseTo(7.85, 10);
        expectProjectProjection();
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

    it.each([8, 10])(
        'keeps the rolling run-up on its physical clock through tempo and loop-entry %s edits',
        async (entryBeat) => {
            hardware.now = 51;
            transportStore.set({
                ...transportStore.value!,
                isPlaying: true,
                tempo: 120,
                playheadPosition: 6,
            });
            playheadPositionRef.current = 6;
            playheadClockRef.beat = 6;
            playheadClockRef.audioTimeSeconds = 51;
            toggleRecording();
            await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
            expect(hardware.zeroFrame / hardware.sampleRate).toBe(51);

            await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
            expect(transportStore.value?.tempo).toBe(60);
            if (entryBeat === 10) {
                await executeAppAction(
                    { type: 'setLoopRegion', payload: { startBeat: 10, endBeat: 12 } },
                    { skipUndo: true }
                );
            }
            const depth = entryBeat - 6 + 0.1;
            startPlayheadScheduler();
            await advanceUntil(
                () =>
                    playheadWrapCountRef.current >= 1 &&
                    lane().takes.some((take) => take.sourceOffsetBeats === entryBeat - 6)
            );
            const first = lane().takes.find((take) => take.sourceOffsetBeats === entryBeat - 6);
            expect(first).toBeDefined();
            await stopActiveRecording();
            flushAutomergeStorageWrites();

            const placed = lane().takes.find((take) => take.id === first!.id);
            expect(placed!.passDepthSeconds).toBeCloseTo(depth, 10);
            const rawTake = getCrdtDoc<Project>('root')!.takeLanes.lanes[0]?.takes.find(
                (take) => take.id === first!.id
            );
            expect(rawTake!.passDepthSeconds).toBeCloseTo(depth, 10);
            expectProjectProjection();
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: first!.id, startBeat: entryBeat, endBeat: 12 },
                },
                { skipUndo: true }
            );
            const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (fragment) => Math.abs(fragment.regionStartBeat - entryBeat) < 1e-9
            );
            expect(selected).toBeDefined();
            const sourceSeconds = ((selected!.audioOffsetBeats ?? 0) * 60) / 60;
            const expectedFrame = Math.round(depth * hardware.sampleRate);
            expect(expectedFrame).toBe(Math.round(depth * hardware.sampleRate));
            expect(hardware.buffer!.getChannelData(0)[expectedFrame]).toBe(Math.round(depth * hardware.sampleRate));
            expect(sourceSeconds).toBeCloseTo(depth, 10);
            const media = selected!.audioBufferId && audioBufferCache.get(selected!.audioBufferId);
            expect(media).toBe(hardware.buffer);
            expect(media && media.getChannelData(0)[Math.round(sourceSeconds * hardware.sampleRate)]).toBe(
                Math.round(depth * hardware.sampleRate)
            );
            const committedClip = structuredClone(recordedClips()[0]);
            const committedTakes = structuredClone(lane().takes);
            await undo();
            flushAutomergeStorageWrites();
            expect(recordedClips()).toEqual([]);
            expect(takeLaneStore.value?.lanes).toEqual([]);
            expectProjectProjection();
            await redo();
            flushAutomergeStorageWrites();
            expect(recordedClips()).toEqual([committedClip]);
            expect(lane().takes).toEqual(committedTakes);
            expectProjectProjection();
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: first!.id, startBeat: entryBeat, endBeat: 12 },
                },
                { skipUndo: true }
            );
            const replayed = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (fragment) => Math.abs(fragment.regionStartBeat - entryBeat) < 1e-9
            )!;
            expect(((replayed.audioOffsetBeats ?? 0) * 60) / 60).toBeCloseTo(depth, 10);
            expect(replayed.audioBufferId).toBe(selected!.audioBufferId);
        }
    );

    it.each([10, 7])('moves the first pass clock with loop entry %s after the old entry sounded', async (entryBeat) => {
        hardware.now = 51;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 6 });
        playheadPositionRef.current = 6;
        playheadClockRef.beat = 6;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await advanceUntil(() => playheadPositionRef.current >= 8.2);
        expect(playheadPositionRef.current).toBeLessThan(10);
        await executeAppAction(
            { type: 'setLoopRegion', payload: { startBeat: entryBeat, endBeat: 12 } },
            { skipUndo: true }
        );
        await tick();
        const editClock = hardware.now;
        await advanceUntil(() => lane().takes.some((take) => take.sourceOffsetBeats === entryBeat - 6));
        const first = lane().takes.find((take) => take.sourceOffsetBeats === entryBeat - 6)!;
        await stopActiveRecording();
        const depth = entryBeat === 10 ? 2.1 : editClock - 51 + 0.1;
        const placed = lane().takes.find((take) => take.id === first.id)!;
        expect(placed.startBeat).toBe(entryBeat);
        expect(placed.passDepthSeconds).toBeCloseTo(depth, 10);
        expectProjectProjection();
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: TRACK_ID, takeId: first.id, startBeat: entryBeat, endBeat: 12 },
            },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => clip.regionStartBeat === entryBeat
        )!;
        const sourceSeconds = (selected.audioOffsetBeats ?? 0) / 2;
        expect(sourceSeconds).toBeCloseTo(depth, 10);
        const media = selected.audioBufferId && audioBufferCache.get(selected.audioBufferId);
        expect(media).toBe(hardware.buffer);
        expect(media && media.getChannelData(0)[Math.round(sourceSeconds * hardware.sampleRate)]).toBe(
            Math.round(depth * hardware.sampleRate)
        );
        const takes = structuredClone(lane().takes);
        const clips = structuredClone(recordedClips());
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        expect(recordedClips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expectProjectProjection();
        await redo();
        expect(recordedClips()).toEqual(clips);
        expect(lane().takes).toEqual(takes);
        expectProjectProjection();
    });

    it('preserves the completed first pass clock when a later loop entry moves', async () => {
        hardware.now = 51;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 6 });
        playheadPositionRef.current = 6;
        playheadClockRef.beat = 6;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await advanceUntil(() => playheadWrapCountRef.current >= 1 && playheadPositionRef.current >= 8.2);
        const first = lane().takes.find((take) => take.sourceOffsetBeats === 2)!;
        expect(first).toBeDefined();
        await executeAppAction({ type: 'setLoopRegion', payload: { startBeat: 10, endBeat: 12 } }, { skipUndo: true });
        await advanceUntil(() => playheadWrapCountRef.current >= 2);
        await stopActiveRecording();
        const placed = lane().takes.find((take) => take.id === first.id)!;
        expect(placed.startBeat).toBe(8);
        expect(placed.passDepthSeconds).toBeCloseTo(1.1, 10);
        const editedPass = lane().takes.find((take) => take.startBeat === 10 && take.id !== first.id)!;
        expect(editedPass.passDepthSeconds).toBeCloseTo(4.1, 10);
        expectProjectProjection();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        const committedClips = structuredClone(recordedClips());
        const committedTakes = structuredClone(lane().takes);
        await undo();
        expect(recordedClips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expectProjectProjection();
        await redo();
        expect(recordedClips()).toEqual(committedClips);
        expect(lane().takes).toEqual(committedTakes);
        expectProjectProjection();
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: first.id, startBeat: 8, endBeat: 12 } },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find((clip) => clip.regionStartBeat === 8)!;
        expect((selected.audioOffsetBeats ?? 0) / 2).toBeCloseTo(1.1, 10);
        expect(hardware.buffer!.getChannelData(0)[52800]).toBe(52800);
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: TRACK_ID, takeId: editedPass.id, startBeat: 10, endBeat: 12 },
            },
            { skipUndo: true }
        );
        const selectedEdited = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => clip.regionStartBeat === 10
        )!;
        const sourceSeconds = (selectedEdited.audioOffsetBeats ?? 0) / 2;
        expect(sourceSeconds).toBeCloseTo(4.1, 10);
        expect(hardware.buffer!.getChannelData(0)[Math.round(sourceSeconds * hardware.sampleRate)]).toBe(196800);
    });

    it('keeps the first short-loop pass on its physical run-up entry and late wrap', async () => {
        hardware.now = 51;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 7.9, loopEnd: 8.1 });
        playheadPositionRef.current = 7.9;
        playheadClockRef.beat = 7.9;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await tick(0.01);
        expect(hardware.now).toBeLessThan(51.05);
        expect(schedulerSession.pendingSeam).toBeNull();
        await advanceUntil(() => playheadWrapCountRef.current >= 2);
        const first = lane().takes.find((take) => take.sourceOffsetBeats !== undefined);
        expect(first).toBeDefined();
        await stopActiveRecording();
        const committed = lane().takes.find((take) => take.id === first!.id)!;
        expect(committed.passDepthSeconds).toBeCloseTo(0.15, 10);
        expectProjectProjection();
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: committed.id, startBeat: 8, endBeat: 8.1 } },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => Math.abs(clip.regionStartBeat - 8) < 1e-9
        )!;
        const sourceSeconds = (selected.audioOffsetBeats ?? 0) / 2;
        expect(sourceSeconds).toBeCloseTo(0.15, 10);
        expect(hardware.buffer!.getChannelData(0)[Math.round(sourceSeconds * hardware.sampleRate)]).toBe(7200);
    });

    it('dates the first physical entry when a loop edit moves its start behind the run-up', async () => {
        hardware.now = 51;
        transportStore.set({ ...transportStore.value!, isPlaying: true, playheadPosition: 6 });
        playheadPositionRef.current = 6;
        playheadClockRef.beat = 6;
        playheadClockRef.audioTimeSeconds = 51;
        toggleRecording();
        await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1));
        startPlayheadScheduler();
        await tick(0.1);
        await executeAppAction({ type: 'setLoopRegion', payload: { startBeat: 5, endBeat: 12 } }, { skipUndo: true });
        await tick(0.01);
        const entryClock = hardware.now;
        await advanceUntil(() => lane().takes.some((take) => take.sourceOffsetBeats === 0));
        const first = lane().takes.find((take) => take.sourceOffsetBeats === 0)!;
        await stopActiveRecording();
        expect(lane().takes.find((take) => take.id === first.id)!.passDepthSeconds).toBeCloseTo(
            entryClock - 51 + hardware.latencySeconds,
            10
        );
        expectProjectProjection();
    });

    it('replaces a cancelled planned seam with the edit clock and keeps the next pass PCM in order', async () => {
        transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
        toggleRecording();
        await vi.waitFor(() => expect(schedulerSession.worker?.onmessage).toBeTruthy(), { interval: 1 });
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        const plannedSeam = schedulerSession.pendingSeam!.seamAudioTime;
        const first = lane().takes.find((take) => take.sourceOffsetBeats === 0)!;
        for (let index = 0; index < 4; index++) {
            await tick(0.01);
        }
        expect(hardware.now).toBeLessThan(plannedSeam);
        const oldPair = structuredClone(playheadClockRef);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 210 } }, { skipUndo: true });
        await executeAppAction(
            { type: 'setLoopRegion', payload: { startBeat: 11.9, endBeat: 12 } },
            { skipUndo: true }
        );
        await tick(0.01);
        const editClock = hardware.now;
        const incomingBeat = playheadClockRef.beat;
        const dyingEndBeat = oldPair.beat + (editClock - oldPair.audioTimeSeconds) * 2;
        await advanceUntil(() => lane().takes.filter((take) => take.sourceOffsetBeats !== undefined).length >= 3);
        const second = lane().takes.filter((take) => take.sourceOffsetBeats !== undefined)[1]!;
        const third = lane().takes.filter((take) => take.sourceOffsetBeats !== undefined)[2]!;
        await stopActiveRecording();
        flushAutomergeStorageWrites();
        expect(lane().takes.find((take) => take.id === first.id)?.endBeat).toBeCloseTo(dyingEndBeat, 10);
        expect(lane().takes.find((take) => take.id === first.id)?.passDepthSeconds).toBeCloseTo(0.1, 10);
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: TRACK_ID, takeId: first.id, startBeat: 10, endBeat: dyingEndBeat },
            },
            { skipUndo: true }
        );
        const selectedFirst = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => clip.regionStartBeat === 10
        )!;
        const firstSourceSeconds = ((selectedFirst.audioOffsetBeats ?? 0) * 60) / 210;
        expect(firstSourceSeconds).toBeCloseTo(0.1, 10);
        const firstMedia = selectedFirst.audioBufferId && audioBufferCache.get(selectedFirst.audioBufferId);
        expect(firstMedia && firstMedia.getChannelData(0)[Math.round(firstSourceSeconds * hardware.sampleRate)]).toBe(
            4800
        );
        const placedSecond = lane().takes.find((take) => take.id === second.id)!;
        const expectedDepth = editClock - hardware.zeroFrame / hardware.sampleRate + hardware.latencySeconds;
        expect(placedSecond.passDepthSeconds).toBeCloseTo(expectedDepth, 10);
        expect(
            getCrdtDoc<Project>('root')!.takeLanes.lanes[0]!.takes.find((take) => take.id === second.id)
                ?.passDepthSeconds
        ).toBeCloseTo(expectedDepth, 10);
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: second.id, startBeat: 11.9, endBeat: 12 } },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => clip.regionStartBeat === placedSecond.startBeat
        )!;
        const sourceSeconds = ((selected.audioOffsetBeats ?? 0) * 60) / 210;
        expect(sourceSeconds).toBeCloseTo(expectedDepth, 10);
        const media = selected.audioBufferId && audioBufferCache.get(selected.audioBufferId);
        expect(media && media.getChannelData(0)[Math.round(sourceSeconds * hardware.sampleRate)]).toBe(
            Math.round(expectedDepth * hardware.sampleRate)
        );
        const thirdDepth = expectedDepth + ((12 - incomingBeat) * 60) / 210;
        expect(lane().takes.find((take) => take.id === third.id)?.passDepthSeconds).toBeCloseTo(thirdDepth, 10);
        expect(thirdDepth).toBeGreaterThan(expectedDepth);
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: third.id, startBeat: 11.9, endBeat: 12 } },
            { skipUndo: true }
        );
        const selectedThird = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => clip.regionStartBeat === 11.9
        )!;
        const thirdSource = ((selectedThird.audioOffsetBeats ?? 0) * 60) / 210;
        expect(thirdSource).toBeCloseTo(thirdDepth, 10);
        expect(media && media.getChannelData(0)[Math.round(thirdSource * hardware.sampleRate)]).toBe(
            Math.round(thirdDepth * hardware.sampleRate)
        );
        const committedTakes = structuredClone(lane().takes);
        const committedClip = structuredClone(recordedClips()[0]);
        await undo();
        flushAutomergeStorageWrites();
        expect(recordedClips()).toEqual([]);
        expectProjectProjection();
        await redo();
        flushAutomergeStorageWrites();
        expect(recordedClips()).toEqual([committedClip]);
        expect(lane().takes).toEqual(committedTakes);
        expectProjectProjection();
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: third.id, startBeat: 11.9, endBeat: 12 } },
            { skipUndo: true }
        );
        const replayed = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
            (clip) => clip.regionStartBeat === 11.9
        )!;
        expect(((replayed.audioOffsetBeats ?? 0) * 60) / 210).toBeCloseTo(thirdDepth, 10);
        expect(replayed.audioBufferId).toBe(selectedThird.audioBufferId);
    });

    it('retires a planned boundary when a follow action relocates its recording before the seam sounds', async () => {
        transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
        toggleRecording();
        await vi.waitFor(() => expect(schedulerSession.worker?.onmessage).toBeTruthy(), { interval: 1 });
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        const first = lane().takes.find((take) => take.sourceOffsetBeats === 0)!;
        const previousPair = structuredClone(playheadClockRef);
        hardware.followJump = 10;
        await tick(0.01);
        const jumpClock = hardware.now;
        hardware.followJump = null;
        const dyingBeat = previousPair.beat + (jumpClock - previousPair.audioTimeSeconds) * 2;
        expect(schedulerSession.pendingSeam).toBeNull();
        await advanceUntil(() => lane().takes.filter((take) => take.sourceOffsetBeats !== undefined).length >= 2);
        const second = lane().takes.filter((take) => take.sourceOffsetBeats !== undefined)[1]!;
        await stopActiveRecording();
        expect(lane().takes.find((take) => take.id === first.id)?.endBeat).toBeCloseTo(dyingBeat, 10);
        expect(lane().takes.find((take) => take.id === second.id)?.startBeat).toBe(10);
        expect(lane().takes.find((take) => take.id === second.id)?.passDepthSeconds).toBeCloseTo(
            jumpClock - hardware.zeroFrame / hardware.sampleRate + hardware.latencySeconds,
            10
        );
        expectProjectProjection();
    });

    it.each(['stop', 'pause', 'seek', 'record', 'automatic'] as const)(
        '%s retires the unsounded planned tail at its physical capture end',
        async (ending) => {
            transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
            toggleRecording();
            await vi.waitFor(() => expect(schedulerSession.worker?.onmessage).toBeTruthy(), { interval: 1 });
            await advanceUntil(() => schedulerSession.pendingSeam !== null);
            const planned = lane().takes.find((take) => take.sourceOffsetBeats === 0)!;
            const endingBeat = playheadClockRef.beat;
            expect(hardware.now).toBeLessThan(schedulerSession.pendingSeam!.seamAudioTime);
            if (ending === 'stop') {
                await stopPlayback();
            } else if (ending === 'pause') {
                pausePlayback();
            } else if (ending === 'seek') {
                await executePlayheadSeek(16);
            } else if (ending === 'automatic') {
                finalizeAutomaticRecording(12);
                await stopActiveRecording();
            } else {
                toggleRecording();
            }
            await vi.waitFor(() => expect(recordedClips()[0]?.audioBufferId).toBeTruthy(), { interval: 1 });
            await recordingLifecycle.waitForCommits();
            const committed = lane().takes.find((take) => take.id === planned.id)!;
            expect(committed.endBeat).toBeCloseTo(endingBeat - hardware.latencySeconds * 2, 10);
            expect(committed.passDepthSeconds).toBeCloseTo(0.1, 10);
            expect((committed.endBeat - committed.startBeat) / 2 + committed.passDepthSeconds!).toBeCloseTo(
                hardware.buffer!.duration,
                10
            );
            expectProjectProjection();
            const raw = getCrdtDoc<Project>('root')!.takeLanes.lanes[0]!.takes.find((take) => take.id === planned.id)!;
            expect(raw).toEqual(committed);
        }
    );

    it('bounds uncomped ordinary Stop playback before any planned seam despite excess drain', async () => {
        toggleRecording();
        await vi.waitFor(() => expect(schedulerSession.worker?.onmessage).toBeTruthy(), { interval: 1 });
        await advanceUntil(() => playheadClockRef.beat >= 9.5);
        expect(schedulerSession.pendingSeam).toBeNull();
        const intendedEnd = playheadClockRef.beat;
        hardware.drainSeconds = 1;
        await stopActiveRecording();
        const clip = recordedClips()[0]!;
        expect(clip.endBeat).toBeCloseTo(intendedEnd, 10);
        expect(resolveClipsWithComping(TRACK_ID, recordedClips())[0]?.endBeat).toBeCloseTo(intendedEnd, 10);
        expect(hardware.buffer!.duration).toBeCloseTo((intendedEnd - 8) / 2 + 1, 10);
        expect(hardware.buffer!.getChannelData(0).at(-1)).toBe(hardware.buffer!.length - 1);
        await expectUncompedSourceEnding(intendedEnd);
        expectProjectProjection();
    });

    it.each([
        { route: 'manual', completionTempo: 60 },
        { route: 'automatic', completionTempo: 60 },
        { route: 'manual', completionTempo: 120 },
        { route: 'automatic', completionTempo: 120 },
    ] as const)(
        '$route keeps the intended pending-tail end through a delayed excess drain at $completionTempo BPM',
        async ({ route, completionTempo }) => {
            transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
            toggleRecording();
            await vi.waitFor(() => expect(schedulerSession.worker?.onmessage).toBeTruthy(), { interval: 1 });
            await advanceUntil(() => schedulerSession.pendingSeam !== null);
            const planned = lane().takes.find((take) => take.sourceOffsetBeats === 0)!;
            const intendedEnd = route === 'automatic' ? 11.8 : playheadClockRef.beat;
            let release!: () => void;
            hardware.flushGate = new Promise<void>((resolve) => {
                release = resolve;
            });
            hardware.drainSeconds = 1;
            if (route === 'automatic') {
                finalizeAutomaticRecording(intendedEnd);
            }
            const stopping = stopActiveRecording();
            expect(activeRecordingRef.current).toEqual([]);
            await executeAppAction({ type: 'setTempo', payload: { bpm: completionTempo } }, { skipUndo: true });
            hardware.now += 1;
            release();
            await stopping;
            const committed = lane().takes.find((take) => take.id === planned.id)!;
            const intendedSourceEnd = 0.1 + (intendedEnd - 10) / 2;
            const expectedEnd = Math.min(intendedEnd, 10 + ((intendedSourceEnd - 0.1) * completionTempo) / 60);
            expect(committed.endBeat).toBeCloseTo(expectedEnd, 10);
            expect(committed.passSourceEndSeconds).toBeCloseTo(intendedSourceEnd, 10);
            expect(committed.passSourceEndSeconds!).toBeLessThan(hardware.buffer!.duration);
            if (completionTempo === 120) {
                expect(resolveClipsWithComping(TRACK_ID, recordedClips())[0]?.endBeat).toBeCloseTo(intendedEnd, 10);
                await expectUncompedSourceEnding(intendedEnd);
            }
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: committed.id, startBeat: 10, endBeat: 12 },
                },
                { skipUndo: true }
            );
            const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (entry) => entry.regionStartBeat === 10
            )!;
            const terminalFileSeconds =
                ((selected.audioOffsetBeats ?? 0) * 60) / completionTempo +
                ((selected.regionEndBeat - selected.regionStartBeat) * 60) / completionTempo;
            expect(terminalFileSeconds).toBeCloseTo(intendedSourceEnd, 10);
            expect(Math.round(terminalFileSeconds * hardware.sampleRate) - 1).toBeLessThan(hardware.buffer!.length);
            expect(selected.regionEndBeat).toBeCloseTo(expectedEnd, 10);
            expect(committed.passDepthSeconds).toBeCloseTo(0.1, 10);
            expectProjectProjection();
            const committedClip = structuredClone(recordedClips()[0]);
            const committedTakes = structuredClone(lane().takes);
            await undo();
            flushAutomergeStorageWrites();
            expect(recordedClips()).toEqual([]);
            await redo();
            flushAutomergeStorageWrites();
            expect(recordedClips()).toEqual([committedClip]);
            expect(lane().takes).toEqual(committedTakes);
            expectProjectProjection();
        }
    );

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

    it('keeps the actual first pass clock across permission and native roll tempo edits', async () => {
        transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
        hardware.nativeHold = true;
        hardware.rollContinuationAdvance = 0.025;
        let admit!: () => void;
        let roll!: () => void;
        hardware.admissionGate = new Promise<void>((resolve) => {
            admit = resolve;
        });
        hardware.rollGate = new Promise<void>((resolve) => {
            roll = resolve;
        });
        toggleRecording();
        await vi.waitFor(() => expect(hardware.starts).toBe(1));
        expect(activeRecordingRef.current).toEqual([]);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 90 } }, { skipUndo: true });
        hardware.now = 50.25;
        admit();
        await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
        expect(activeRecordingRef.current).toHaveLength(1);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
        hardware.now = 50.5;
        roll();
        await vi.waitFor(() => expect(schedulerSession.worker).not.toBeNull(), { interval: 1 });
        expect(playheadClockRef).toEqual({ beat: 10, audioTimeSeconds: 50.5 });
        await vi.waitFor(() => expect(hardware.now).toBe(50.525), { interval: 1 });
        await advanceUntil(
            () => playheadWrapCountRef.current >= 2 && lane().takes.some((take) => take.sourceOffsetBeats === 2)
        );
        await stopPlayback();
        const second = lane().takes.find((take) => take.sourceOffsetBeats === 2)!;
        expect(second.passDepthSeconds).toBeCloseTo(2.35, 10);
        const [capturedClip] = recordedClips();
        const mediaOrigin = capturedClip!.startBeat - (capturedClip!.audioOffsetBeats ?? 0);
        expect(mediaOrigin).toBeCloseTo(9.65, 10);
        expect(lane().takes.find((take) => take.sourceOffsetBeats === 0)!.passDepthSeconds).toBeCloseTo(0.35, 10);
        await executeAppAction(
            { type: 'setCompRegion', payload: { trackId: TRACK_ID, takeId: second.id, startBeat: 8, endBeat: 12 } },
            { skipUndo: true }
        );
        const selected = resolveClipsWithComping(TRACK_ID, recordedClips()).find((clip) => clip.regionStartBeat === 8)!;
        expect(selected.audioOffsetBeats).toBeCloseTo(2.35, 10);
        const frame = Math.round(selected.audioOffsetBeats! * hardware.sampleRate);
        expect(frame).toBe(112800);
        expect(hardware.buffer!.getChannelData(0)[frame]).toBe(112800);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expectProjectProjection();
        const takes = structuredClone(lane().takes);
        await undo();
        expect(recordedClips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expectProjectProjection();
        await redo();
        expect(lane().takes).toEqual(takes);
        expectProjectProjection();
    });

    it('places first PCM after native roll at its actual sample-zero time', async () => {
        transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
        hardware.nativeHold = true;
        let releaseRoll!: () => void;
        hardware.rollGate = new Promise<void>((resolve) => {
            releaseRoll = resolve;
        });
        toggleRecording();
        await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
        hardware.now = 50.2;
        releaseRoll();
        await vi.waitFor(() => expect(schedulerSession.worker).not.toBeNull(), { interval: 1 });
        expect(playheadClockRef).toEqual({ beat: 10, audioTimeSeconds: 50.2 });

        // startAudioRecording can resolve before worker readiness. Model the
        // worklet's first nonempty block 200 ms after the transport rolls.
        hardware.zeroFrame = Math.round(50.4 * hardware.sampleRate);
        hardware.now = 50.6;
        await stopPlayback();
        const [clip] = recordedClips();
        expect(hardware.buffer?.duration).toBeCloseTo(0.2, 10);
        expect(clip?.startBeat).toBeCloseTo(10.2, 10);
        // #4994 retains a one-beat carrier; its PCM still ends at beat 10.6.
        expect(clip?.endBeat).toBeCloseTo(11.2, 10);
        expect(clip!.startBeat + hardware.buffer!.duration * 2).toBeCloseTo(10.6, 10);
        expect(hardware.buffer!.length).toBe(9600);
        expect(hardware.buffer!.getChannelData(0)[9599]).toBe(9599);
        expect(hardware.buffer!.getChannelData(0)[9600]).toBeUndefined();
        expectProjectProjection();
    });

    it('keeps a sub-cap stopped capture on its physical stop clock while a successor roll stays live', async () => {
        transportStore.set({ ...transportStore.value!, playheadPosition: 8 });
        hardware.nativeHold = true;
        hardware.rollContinuationAdvance = 0.001;
        let releaseOldRoll!: () => void;
        let releaseFlush!: () => void;
        hardware.rollGate = new Promise<void>((resolve) => {
            releaseOldRoll = resolve;
        });
        hardware.flushGate = new Promise<void>((resolve) => {
            releaseFlush = resolve;
        });

        toggleRecording();
        await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
        const oldHoldGeneration = schedulerSession.generation;

        hardware.now = 50.2;
        const stopped = stopPlayback();
        const stoppedGeneration = schedulerSession.generation;
        expect(stoppedGeneration).toBeGreaterThan(oldHoldGeneration);
        expect(hardware.flushes).toBe(1);

        hardware.rollGate = null;
        hardware.now = 50.22;
        await startPlayback();
        const successorGeneration = schedulerSession.generation;
        const successorWorker = schedulerSession.worker;
        expect(successorGeneration).toBeGreaterThan(stoppedGeneration);
        expect(successorWorker).not.toBeNull();
        expect(playheadClockRef).toEqual({ beat: 8, audioTimeSeconds: 50.22 });

        releaseOldRoll();
        await vi.waitFor(() => expect(hardware.now).toBeCloseTo(50.222, 10), { interval: 1 });
        expect(schedulerSession.generation).toBe(successorGeneration);
        expect(schedulerSession.worker).toBe(successorWorker);
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(playheadClockRef).toEqual({ beat: 8, audioTimeSeconds: 50.22 });

        releaseFlush();
        await stopped;

        const [capturedClip] = recordedClips();
        expect(capturedClip?.startBeat).toBeCloseTo(7.4, 10);
        expect(capturedClip?.endBeat).toBeCloseTo(8.4, 10);
        expect({
            terminalBufferDuration: hardware.buffer?.duration,
            historyActions: undoHistoryStore.value?.past.map((entry) =>
                entry.kind === 'action' ? entry.action.type : entry.kind
            ),
            successorStillPlaying: transportStore.value?.isPlaying,
            successorWorkerStillOwned: schedulerSession.worker === successorWorker,
        }).toEqual({
            terminalBufferDuration: 0.2,
            historyActions: ['commitRecording'],
            successorStillPlaying: true,
            successorWorkerStillOwned: true,
        });
    });

    it.each(['stop', 'pause', 'seek', 'record'] as const)(
        '%s freezes its physical ending while both the old roll and terminal remain held',
        async (ending) => {
            hardware.nativeHold = true;
            hardware.rollContinuationAdvance = 0.001;
            let releaseRoll!: () => void;
            let releaseFlush!: () => void;
            hardware.rollGate = new Promise<void>((resolve) => {
                releaseRoll = resolve;
            });
            hardware.flushGate = new Promise<void>((resolve) => {
                releaseFlush = resolve;
            });
            toggleRecording();
            await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
            hardware.now = 50.2;
            let endingPromise: Promise<void> = Promise.resolve();
            if (ending === 'stop') {
                endingPromise = stopPlayback();
            } else if (ending === 'pause') {
                pausePlayback();
            } else if (ending === 'seek') {
                endingPromise = executePlayheadSeek(16);
            } else {
                toggleRecording();
            }
            expect(hardware.flushes).toBe(1);
            hardware.now = 50.23;
            releaseRoll();
            await vi.waitFor(() => expect(hardware.now).toBeGreaterThan(50.23), { interval: 1 });
            hardware.now = 51;
            releaseFlush();
            await endingPromise;
            await vi.waitFor(() => expect(recordedClips()[0]?.audioBufferId).toBeTruthy(), { interval: 1 });
            await recordingLifecycle.waitForCommits();
            const committed = recordedClips()[0]!;
            expect(hardware.buffer?.duration).toBe(0.2);
            expect(committed.startBeat).toBeCloseTo(7.4, 10);
            expect(committed.endBeat).toBeCloseTo(8.4, 10);
            expectProjectProjection();
        }
    );

    it('retains a two-second stopped capture when hold-cap processing is stalled until a successor rolls', async () => {
        const realSetTimeout = globalThis.setTimeout;
        let releaseCap: (() => void) | undefined;
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => {
            if (delay === 250 && typeof handler === 'function') {
                releaseCap = () => handler(...args);
                return realSetTimeout(() => {}, 30000);
            }
            return realSetTimeout(handler, delay, ...args);
        });
        try {
            transportStore.set({ ...transportStore.value!, playheadPosition: 10 });
            hardware.nativeHold = true;
            hardware.rollGate = new Promise<void>(() => {});
            let releaseFlush!: () => void;
            hardware.flushGate = new Promise<void>((resolve) => {
                releaseFlush = resolve;
            });
            toggleRecording();
            await vi.waitFor(() => expect(releaseCap).toBeTypeOf('function'), { interval: 1 });
            hardware.now = 52;
            const stopped = stopPlayback();
            hardware.nativeHold = false;
            hardware.now = 70;
            await startPlayback();
            const successorWorker = schedulerSession.worker;
            const successorGeneration = schedulerSession.generation;
            hardware.rollContinuationAdvance = 0.001;
            releaseCap!();
            await vi.waitFor(() => expect(hardware.now).toBeCloseTo(70.001, 10), { interval: 1 });
            releaseFlush();
            await stopped;
            expect(hardware.buffer?.duration).toBe(2);
            expect(recordedClips()[0]?.startBeat).toBeCloseTo(5.8, 10);
            expect(recordedClips()[0]?.endBeat).toBeCloseTo(9.8, 10);
            expect(transportStore.value?.isPlaying).toBe(true);
            expect(schedulerSession.worker).toBe(successorWorker);
            expect(schedulerSession.generation).toBe(successorGeneration);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expectProjectProjection();
        } finally {
            timeoutSpy.mockRestore();
        }
    });

    it('commits the sub-cap stopped capture at its stop clock when its terminal lands first', async () => {
        transportStore.set({ ...transportStore.value!, playheadPosition: 8 });
        hardware.nativeHold = true;
        hardware.rollContinuationAdvance = 0.001;
        let releaseOldRoll!: () => void;
        let releaseFlush!: () => void;
        hardware.rollGate = new Promise<void>((resolve) => {
            releaseOldRoll = resolve;
        });
        hardware.flushGate = new Promise<void>((resolve) => {
            releaseFlush = resolve;
        });

        toggleRecording();
        await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
        hardware.now = 50.2;
        const stopped = stopPlayback();
        releaseFlush();
        await stopped;

        const [capturedClip] = recordedClips();
        expect(hardware.buffer?.duration).toBe(0.2);
        expect(capturedClip?.startBeat).toBeCloseTo(7.4, 10);
        expect(capturedClip?.endBeat).toBeCloseTo(8.4, 10);
        expect(
            undoHistoryStore.value?.past.map((entry) => (entry.kind === 'action' ? entry.action.type : entry.kind))
        ).toEqual(['commitRecording']);

        releaseOldRoll();
        await vi.waitFor(() => expect(hardware.now).toBeCloseTo(50.201, 10), { interval: 1 });
    });

    it.each(['punch', 'manual'] as const)(
        '%s keeps captured pass time when tempo changes during the Stop flush',
        async (route) => {
            if (route === 'punch') {
                await executeAppAction({ type: 'setPunchIn', payload: { beat: 10 } }, { skipUndo: true });
                await executeAppAction({ type: 'setPunchOut', payload: { beat: 14 } }, { skipUndo: true });
                await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
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
            await advanceUntil(
                () => playheadWrapCountRef.current >= 2 && lane().takes.some((take) => take.sourceOffsetBeats === 2)
            );
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
            expect(clip.startBeat).toBe(route === 'punch' ? 8 : 4.9);
            const origin =
                secondsBetweenBeats(tempoMapStore.value!.changes, 0, clip.startBeat, 60) -
                ((clip.audioOffsetBeats ?? 0) * 60) / 60;
            expect(origin).toBeCloseTo(4.9, 10);
            expect(audioBufferCache.get(clip.audioBufferId!)).toBe(hardware.buffer);
            const second = lane().takes.find((take) => take.sourceOffsetBeats === 2);
            expect(second).toBeDefined();
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: second!.id, startBeat: 8, endBeat: 12 },
                },
                { skipUndo: true }
            );
            const selectedPass = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (fragment) => fragment.regionStartBeat === 8
            );
            expect(selectedPass).toBeDefined();
            const selectedSourceSeconds = ((selectedPass!.audioOffsetBeats ?? 0) * 60) / 60;
            expect(second!.passDepthSeconds).toBeCloseTo(1.1, 10);
            expect(second!.passAnchorSeconds).toBeCloseTo(3.1, 10);
            expect(selectedSourceSeconds).toBeCloseTo(1.1, 10);
            const frame = Math.round(selectedSourceSeconds * hardware.sampleRate);
            expect(frame).toBe(52800);
            expect(hardware.buffer!.getChannelData(0)[frame]).toBe(52800);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expectProjectProjection();
            const committedClip = structuredClone(clip);
            const committedTakes = structuredClone(lane().takes);
            await undo();
            flushAutomergeStorageWrites();
            expect(recordedClips()).toEqual([]);
            expect(takeLaneStore.value?.lanes).toEqual([]);
            expectProjectProjection();
            await redo();
            flushAutomergeStorageWrites();
            expect(recordedClips()).toEqual([committedClip]);
            expect(lane().takes).toEqual(committedTakes);
            await executeAppAction(
                {
                    type: 'setCompRegion',
                    payload: { trackId: TRACK_ID, takeId: second!.id, startBeat: 8, endBeat: 12 },
                },
                { skipUndo: true }
            );
            const replayed = resolveClipsWithComping(TRACK_ID, recordedClips()).find(
                (fragment) => fragment.regionStartBeat === 8
            );
            expect(replayed!.audioOffsetBeats).toBeCloseTo(1.1, 10);
            expect(replayed!.audioBufferId).toBe(selectedPass!.audioBufferId);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expectProjectProjection();
        }
    );
});
