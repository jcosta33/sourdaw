import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createMockAudioContext, createMockAudioNode, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Clip } from '#/modules/Arrangement/stores';
import { createTrack, runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    cacheAudioBuffer,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
    initEngineDeviceCollaborators,
    removeTrackStrip,
} from '#/modules/AudioEngine/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { transportStore } from '../../../stores/transportStore';
import { startPlayback } from '../../transportControls/startPlayback';
import { stopPlayback } from '../../transportControls/stopPlayback';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';

registerDeviceEnginePorts();

class SchedulerWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    generation = 0;
    sequence = 0;

    postMessage(message: { type: string; generation?: number }): void {
        if (message.type === 'start') {
            this.generation = message.generation ?? 0;
        }
    }

    deliver(): void {
        const received = performance.timeOrigin + performance.now();
        this.onmessage?.(
            new MessageEvent('message', {
                data: {
                    type: 'tick',
                    generation: this.generation,
                    sequence: ++this.sequence,
                    scheduledAtMs: received - 2,
                    sentAtMs: received - 1,
                },
            })
        );
    }

    terminate(): void {}
}

function clip(id: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId: 'seam-audio',
        name: id,
        type: 'audio',
        audioBufferId: id,
        startBeat,
        endBeat,
        audioOffsetSeconds: 0,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: false,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#334455',
        locked: false,
        muted: false,
    };
}

describe('audio admission at an off-grid transport loop end', () => {
    const originalContext = audioEngine.context;
    const context = createMockAudioContext();
    const sources: ReturnType<typeof context.createBufferSource>[] = [];
    const workers: SchedulerWorker[] = [];
    let currentTime = 8;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('audio loop-end admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        Object.defineProperty(context, 'currentTime', { configurable: true, get: () => currentTime });
        context.createBufferSource.mockImplementation(() => {
            const source = createMockAudioNode('buffer-source');
            sources.push(source);
            return source;
        });
        // The external Web Audio boundary is controlled; engine accessors,
        // strip creation, playback admission and both schedulers stay real.
        audioEngine.context = context as unknown as AudioContext;
        vi.stubGlobal(
            'AudioWorkletNode',
            class {
                constructor() {
                    return createMockAudioNode('audio-worklet');
                }
            }
        );
        vi.stubGlobal(
            'Worker',
            class extends SchedulerWorker {
                constructor() {
                    super();
                    workers.push(this);
                }
            }
        );
        configureRuntimeGraphProjectRevisionValidator((revision) => captureProjectRevision() === revision);
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        initEngineDeviceCollaborators();
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    afterEach(async () => {
        await stopPlayback();
        disposePlayheadScheduler();
        removeTrackStrip('seam-audio');
        audioEngine.setUseCaseDeviceCollaborators(null);
        configureRuntimeGraphProjectRevisionValidator(null);
        configureRuntimeGraphTopologyValidator(null);
        audioEngine.context = originalContext;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set({ ...defaultTransportState });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('excludes the loopEnd clip from the dying pass and starts loopStart once in the incoming pass', async () => {
        const dying = MockAudioBuffer.create(1, 48_000, 48_000);
        const incoming = MockAudioBuffer.create(1, 24_000, 48_000);
        const excluded = MockAudioBuffer.create(1, 12_000, 48_000);
        cacheAudioBuffer({ bufferId: 'dying', buffer: dying });
        cacheAudioBuffer({ bufferId: 'incoming', buffer: incoming });
        cacheAudioBuffer({ bufferId: 'excluded', buffer: excluded });
        const track = createTrack({ id: 'seam-audio', name: 'Seam audio', kind: 'audio', withoutDefaultDevice: true });
        trackStore.set({
            tracks: [
                {
                    ...track,
                    clips: [clip('excluded', 1.675, 1.8), clip('dying', 1.525, 1.575), clip('incoming', 0.125, 0.25)],
                },
            ],
            selectedTrackId: track.id,
            ghostClips: [],
        });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            playheadPosition: 1.525,
            isLooping: true,
            loopStart: 0.125,
            loopEnd: 1.675,
            preRollEnabled: false,
        });
        flushAutomergeStorageWrites();
        const onRoll = vi.fn<(seconds: number, beat: number) => void>();

        await startPlayback(onRoll);

        expect(transportStore.value?.isPlaying).toBe(true);
        expect(onRoll).toHaveBeenCalledExactlyOnceWith(8.1, 1.525);
        expect(sources).toHaveLength(2);
        expect(sources[0]?.buffer).toBe(dying);
        expect(sources[1]?.buffer).toBe(incoming);
        expect(sources.map((source) => source.buffer)).not.toContain(excluded);
        expect(sources.map((source) => source.start.mock.calls.length)).toEqual([1, 1]);
        // 8.1 s is frame388800; the remaining0.15beat is3600frames.
        // These are literal clock expectations, not the scheduler's seam projection.
        expect(sources.map((source) => Math.round(Number(source.start.mock.calls[0]?.[0]) * 48_000))).toEqual([
            388_800, 392_400,
        ]);
        expect(playheadClockRef.pendingLoopSeam).toMatchObject({ loopStart: 0.125, loopEnd: 1.675, passIndex: 1 });
        expect(workers).toHaveLength(1);

        currentTime = 8.175;
        workers[0]!.deliver();
        expect(schedulerSession.tickInFlight).toBe(true);
        await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false));

        expect(playheadClockRef.pendingLoopSeam).toBeNull();
        expect(playheadClockRef.beat).toBeCloseTo(0.125, 12);
        expect(sources).toHaveLength(2);
        expect(sources.map((source) => source.start.mock.calls.length)).toEqual([1, 1]);
        expect(sources.map((source) => source.buffer)).not.toContain(excluded);
    });
});
