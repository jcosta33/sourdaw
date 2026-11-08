import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, createMockAudioNode, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import type { Clip } from '#/modules/Arrangement/stores';

import { defaultTransportState } from '../../../models/TransportState';

async function importRuntime() {
    // Construct the real singleton only after its external AudioContext exists.
    // Enter one graph before its barrels, as the Scoring composition test does.
    await import('#/app/registerProjectLifecycle');
    const devices = await import('#/app/registerDeviceEnginePorts');
    const arrangement = await import('#/modules/Arrangement/useCases');
    const arrangementStores = await import('#/modules/Arrangement/stores');
    const audio = await import('#/modules/AudioEngine/useCases');
    const crdt = await import('#/modules/CrdtDocument/useCases');
    const clock = await import('../../../stores/playheadClockRef');
    const tempo = await import('../../../stores/tempoMapStore');
    const transport = await import('../../../stores/transportStore');
    const start = await import('../../transportControls/startPlayback');
    const stop = await import('../../transportControls/stopPlayback');
    const disposal = await import('../disposePlayheadScheduler');
    const session = await import('../schedulerSession');
    return {
        devices,
        arrangement,
        arrangementStores,
        audio,
        crdt,
        clock,
        tempo,
        transport,
        start,
        stop,
        disposal,
        session,
    };
}

let runtime: Awaited<ReturnType<typeof importRuntime>>;
let setupComplete = false;

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
    const context = createMockAudioContext();
    const sources: ReturnType<typeof context.createBufferSource>[] = [];
    const workers: SchedulerWorker[] = [];

    beforeAll(async () => {
        context.currentTime = 8;
        context.createBufferSource.mockImplementation(() => {
            const source = createMockAudioNode('buffer-source');
            sources.push(source);
            return source;
        });
        vi.stubGlobal('AudioContext', function ConstructionContext() {
            return context;
        });
        vi.stubGlobal(
            'AudioWorkletNode',
            class {
                constructor() {
                    return createMockAudioNode('audio-worklet');
                }
            }
        );
        runtime = await importRuntime();
        runtime.devices.registerDeviceEnginePorts();
        setupComplete = true;
    }, 30_000);

    beforeEach(() => {
        sources.length = 0;
        workers.length = 0;
        context.currentTime = 8;
        configureAutomergeStoragePort(null);
        runtime.crdt.resetCrdtProjectAuthority('audio loop-end admission');
        runtime.crdt.removeCrdtDoc('root');
        runtime.crdt.createCrdtDoc('root');
        runtime.crdt.registerCrdtStorageRuntime();
        expect(runtime.audio.audioEngine.context).toBe(context);
        vi.stubGlobal(
            'Worker',
            class extends SchedulerWorker {
                constructor() {
                    super();
                    workers.push(this);
                }
            }
        );
        runtime.audio.configureRuntimeGraphProjectRevisionValidator(
            (revision) => runtime.crdt.captureProjectRevision() === revision
        );
        runtime.audio.configureRuntimeGraphTopologyValidator(
            runtime.arrangement.runtimeGraphTopology.matchesCurrentProject
        );
        runtime.audio.initEngineDeviceCollaborators();
        runtime.arrangementStores.takeLaneStore.set({ lanes: [] });
        runtime.tempo.tempoMapStore.set({ changes: [] });
    });

    afterEach(async () => {
        if (!setupComplete) {
            return;
        }
        await runtime.stop.stopPlayback();
        runtime.disposal.disposePlayheadScheduler();
        runtime.audio.removeTrackStrip('seam-audio');
        runtime.audio.audioEngine.setUseCaseDeviceCollaborators(null);
        runtime.audio.configureRuntimeGraphProjectRevisionValidator(null);
        runtime.audio.configureRuntimeGraphTopologyValidator(null);
        runtime.arrangementStores.trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        runtime.transport.transportStore.set(defaultTransportState);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        runtime.crdt.removeCrdtDoc('root');
    });

    afterAll(async () => {
        try {
            if (setupComplete) {
                await runtime.audio.audioEngine.dispose();
            }
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('excludes the loopEnd clip from the dying pass and starts loopStart once in the incoming pass', async () => {
        const dying = MockAudioBuffer.create(1, 48_000, 48_000);
        const incoming = MockAudioBuffer.create(1, 24_000, 48_000);
        const excluded = MockAudioBuffer.create(1, 12_000, 48_000);
        runtime.audio.cacheAudioBuffer({ bufferId: 'dying', buffer: dying });
        runtime.audio.cacheAudioBuffer({ bufferId: 'incoming', buffer: incoming });
        runtime.audio.cacheAudioBuffer({ bufferId: 'excluded', buffer: excluded });
        const track = runtime.arrangement.createTrack({
            id: 'seam-audio',
            name: 'Seam audio',
            kind: 'audio',
            withoutDefaultDevice: true,
        });
        runtime.arrangementStores.trackStore.set({
            tracks: [
                {
                    ...track,
                    clips: [clip('excluded', 1.675, 1.8), clip('dying', 1.525, 1.575), clip('incoming', 0.125, 0.25)],
                },
            ],
            selectedTrackId: track.id,
            ghostClips: [],
        });
        runtime.transport.transportStore.set({
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

        await runtime.start.startPlayback(onRoll);

        expect(runtime.transport.transportStore.value?.isPlaying).toBe(true);
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
        expect(runtime.clock.playheadClockRef.pendingLoopSeam).toMatchObject({
            loopStart: 0.125,
            loopEnd: 1.675,
            passIndex: 1,
        });
        expect(workers).toHaveLength(1);

        context.currentTime = 8.175;
        workers[0]!.deliver();
        expect(runtime.session.schedulerSession.tickInFlight).toBe(true);
        await vi.waitFor(() => expect(runtime.session.schedulerSession.tickInFlight).toBe(false));

        expect(runtime.clock.playheadClockRef.pendingLoopSeam).toBeNull();
        expect(runtime.clock.playheadClockRef.beat).toBeCloseTo(0.125, 12);
        expect(sources).toHaveLength(2);
        expect(sources.map((source) => source.start.mock.calls.length)).toEqual([1, 1]);
        expect(sources.map((source) => source.buffer)).not.toContain(excluded);
    });
});
