import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommand } from '../../../models/AudioGraphBackend';
import { audioBufferCache } from '../../../stores/audioBufferCache';
import { createNativeOfflineGraphBackend } from '../createNativeOfflineGraphBackend';
import { type NativeGraphTransport } from '../nativeGraphTransport';
import { nativeTimelineMaterialLeases } from '../nativeTimelineMaterialLeases';

import { withNativeTimelineMaterialTransport } from './withNativeTimelineMaterialTransport';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((_resolve) => {
        resolve = _resolve;
    });
    return { promise, resolve };
}

function clip(value: number): AudioGraphCommand {
    const pcm = new Float32Array([value, value]);
    const buffer: AudioBuffer = {
        length: 2,
        sampleRate: 48_000,
        numberOfChannels: 1,
        duration: 2 / 48_000,
        getChannelData: () => pcm,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    };
    nativeTimelineMaterialLeases.ownSnapshot('take', buffer);
    return {
        kind: 'schedule-clip',
        playback: {
            trackId: 'track',
            source: { sourceId: 'take', buffer },
            startTime: 0,
            sourceOffsetSeconds: 0,
            durationSeconds: 2 / 48_000,
            playbackRate: 1,
            gain: 1,
            fade: { microFadeSeconds: 0 },
        },
    };
}

function transport(options: { render?: NativeGraphTransport['renderGraphOffline'] } = {}): NativeGraphTransport {
    const base = withNativeTimelineMaterialTransport({
        registerTimelineSample: vi.fn(async () => ({})),
        beginLevainBank: vi.fn(),
        registerLevainSample: vi.fn(),
        commitLevainBank: vi.fn(),
        releaseLevainBank: vi.fn(),
        applyGraphCommands: vi.fn(async () => ({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [],
        })),
        mapGraphBatch: vi.fn(async () => ({ acceptance: 'accepted', application: 'applied', reports: [] })),
        renderGraphOffline: vi.fn(options.render ?? (async ({ frames }) => new Uint8Array(frames * 8))),
    });
    return {
        ...base,
        timelineSampleLifecycle: vi.fn(base.timelineSampleLifecycle),
        registerTimelineMaterial: vi.fn(base.registerTimelineMaterial),
        mapGraphBatch: vi.fn(base.mapGraphBatch),
        renderGraphOffline: vi.fn(base.renderGraphOffline),
    };
}

beforeEach(async () => {
    await nativeTimelineMaterialLeases.retire();
});
afterEach(async () => {
    await nativeTimelineMaterialLeases.retire();
});

describe('native timeline consumer leases', () => {
    it('prepares native authority again on a later apply and carries exact history versions to render', async () => {
        vi.resetModules();
        const wire = transport();
        const backend = createNativeOfflineGraphBackend({ transport: wire, sampleRate: 48_000 });
        const first = clip(0.25);
        await backend.apply({ schemaVersion: 1, commands: [first] });
        await backend.apply({ schemaVersion: 1, commands: [clip(0.75)] });
        await backend.render(2);
        expect(wire.timelineSampleLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'prepare',
                materials: expect.arrayContaining([expect.objectContaining({ sourceId: 'take' })]),
            })
        );
        expect(wire.registerTimelineMaterial).toHaveBeenCalledTimes(2);
        const render = vi.mocked(wire.renderGraphOffline).mock.calls[0]?.[0];
        expect(render?.batch).toHaveProperty('timelineLease');
        const sources = render?.batch.commands
            .filter((command) => command.kind === 'schedule-clip')
            .map((command) => command.playback.source);
        expect(sources?.[0]).toHaveProperty('materialVersion');
        expect(sources?.[0]).not.toEqual(sources?.[1]);
        backend.dispose();
    });

    it('preserves the registration refusal cause and releases its pending claim', async () => {
        const failure = new Error('native upload refused');
        const wire = transport();
        const consumer = nativeTimelineMaterialLeases.createConsumer({
            ...wire,
            registerTimelineMaterial: vi.fn(async () => {
                throw failure;
            }),
        });
        const prepared = consumer.run(async () => consumer.prepare([clip(0.25)]));

        await expect(prepared).rejects.toMatchObject({
            message: 'register_timeline_material "take": native upload refused',
            cause: failure,
        });
        expect(wire.timelineSampleLifecycle).toHaveBeenCalledWith(expect.objectContaining({ action: 'release' }));
        expect(wire.mapGraphBatch).not.toHaveBeenCalled();
        consumer.dispose();
    });

    it('disposal during upload prevents map and releases only that captured receipt', async () => {
        const wire = transport();
        const entered = deferred<void>();
        const upload = deferred<unknown>();
        const stalled: NativeGraphTransport = {
            ...wire,
            registerTimelineMaterial: vi.fn(async () => {
                entered.resolve();
                return upload.promise;
            }),
        };
        const backend = createNativeOfflineGraphBackend({ transport: stalled, sampleRate: 48_000 });
        const pending = backend.apply({ schemaVersion: 1, commands: [clip(0.25)] });
        await entered.promise;
        backend.dispose();
        upload.resolve({});
        expect(await pending).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(stalled.mapGraphBatch).not.toHaveBeenCalled();
        expect(stalled.timelineSampleLifecycle).toHaveBeenCalledWith(expect.objectContaining({ action: 'release' }));
    });

    it('closes the captured project before a late owner-open continuation can register', async () => {
        const wire = transport();
        const entered = deferred<void>();
        const opened = deferred<void>();
        const lifecycle = wire.timelineSampleLifecycle;
        const stalled: NativeGraphTransport = {
            ...wire,
            timelineSampleLifecycle: vi.fn(async (request) => {
                if (!lifecycle) {
                    throw new Error('missing lifecycle');
                }
                const receipt = await lifecycle(request);
                if (request.action === 'open') {
                    entered.resolve();
                    await opened.promise;
                }
                return receipt;
            }),
        };
        const owner = nativeTimelineMaterialLeases.captureOwner();
        const consumer = nativeTimelineMaterialLeases.createConsumer(stalled, owner);
        const pending = consumer.run(async () => consumer.prepare([clip(0.25)]));
        await entered.promise;
        const retired = nativeTimelineMaterialLeases.retire(owner);
        opened.resolve();
        await expect(pending).rejects.toThrow('closed');
        await retired;
        expect(stalled.registerTimelineMaterial).not.toHaveBeenCalled();
        expect(stalled.timelineSampleLifecycle).toHaveBeenCalledWith({ action: 'retire', owner: expect.any(String) });
    });

    it('refuses a same-object republication while native preparation is pending without uploading stale bytes', async () => {
        const wire = transport();
        const command = clip(0.25);
        if (command.kind !== 'schedule-clip' || !command.playback.source.buffer) {
            throw new Error('expected fixture source');
        }
        const buffer = command.playback.source.buffer;
        audioBufferCache.set('take', buffer);
        const entered = deferred<void>();
        const resume = deferred<void>();
        const lifecycle = wire.timelineSampleLifecycle;
        const stalled: NativeGraphTransport = {
            ...wire,
            timelineSampleLifecycle: vi.fn(async (request) => {
                if (!lifecycle) {
                    throw new Error('missing lifecycle');
                }
                const receipt = await lifecycle(request);
                if (request.action === 'prepare') {
                    entered.resolve();
                    await resume.promise;
                }
                return receipt;
            }),
        };
        const consumer = nativeTimelineMaterialLeases.createConsumer(stalled);
        const publications = consumer.capture([command]);
        const pending = consumer.run(() => consumer.prepare([command], false, publications));
        await entered.promise;
        buffer.getChannelData(0).fill(0.75);
        audioBufferCache.set('take', buffer);
        resume.resolve();
        await expect(pending).rejects.toThrow('publication changed before upload');
        expect(wire.registerTimelineMaterial).not.toHaveBeenCalled();
        consumer.dispose();
    });

    it('refuses a mapping completion after dispose and never publishes it as accepted history', async () => {
        const wire = transport();
        const entered = deferred<void>();
        const resume = deferred<void>();
        const map = wire.mapGraphBatch;
        const stalled: NativeGraphTransport = {
            ...wire,
            mapGraphBatch: async (input) => {
                entered.resolve();
                await resume.promise;
                return map(input);
            },
        };
        const backend = createNativeOfflineGraphBackend({ transport: stalled, sampleRate: 48_000 });
        const applying = backend.apply({ schemaVersion: 1, commands: [clip(0.25)] });
        await entered.promise;
        backend.dispose();
        resume.resolve();
        await expect(applying).resolves.toMatchObject({ application: 'not-applied' });
        await expect(backend.render(2)).rejects.toThrow('disposed');
    });

    it('keeps an independent offline reader alive when a sibling backend releases its lease', async () => {
        const entered = deferred<void>();
        const resume = deferred<void>();
        const wire = transport({
            render: async ({ frames }) => {
                entered.resolve();
                await resume.promise;
                return new Uint8Array(frames * 8);
            },
        });
        const first = createNativeOfflineGraphBackend({ transport: wire, sampleRate: 48_000 });
        const second = createNativeOfflineGraphBackend({ transport: wire, sampleRate: 48_000 });
        const command = clip(0.25);
        await first.apply({ schemaVersion: 1, commands: [command] });
        await second.apply({ schemaVersion: 1, commands: [command] });
        const rendering = second.render(2);
        await entered.promise;
        first.dispose();
        resume.resolve();
        await expect(rendering).resolves.toMatchObject({ left: new Float32Array(2), right: new Float32Array(2) });
        expect(wire.registerTimelineMaterial).toHaveBeenCalledOnce();
        second.dispose();
    });

    it('waits for an admitted offline reader before project retirement can complete', async () => {
        const entered = deferred<void>();
        const resume = deferred<void>();
        const nativeRetirement = deferred<void>();
        let retirementObserved = false;
        const wire = transport({
            render: async ({ frames }) => {
                entered.resolve();
                await resume.promise;
                return new Uint8Array(frames * 8);
            },
        });
        const lifecycle = wire.timelineSampleLifecycle;
        const observed: NativeGraphTransport = {
            ...wire,
            timelineSampleLifecycle: async (request) => {
                if (!lifecycle) {
                    throw new Error('missing lifecycle');
                }
                const receipt = await lifecycle(request);
                if (request.action === 'retire' && !retirementObserved) {
                    expect(receipt).toMatchObject({ complete: false, remainingReaders: 1 });
                    retirementObserved = true;
                    nativeRetirement.resolve();
                }
                return receipt;
            },
        };
        const backend = createNativeOfflineGraphBackend({ transport: observed, sampleRate: 48_000 });
        await backend.apply({ schemaVersion: 1, commands: [clip(0.25)] });
        const rendering = backend.render(2);
        const cancelled = expect(rendering).rejects.toThrow('closed');
        await entered.promise;
        const retired = nativeTimelineMaterialLeases.retire();
        await nativeRetirement.promise;
        resume.resolve();
        await cancelled;
        await retired;
    });

    it('replaces accepted offline history and its material claim only after the replacing map succeeds', async () => {
        const wire = transport();
        const backend = createNativeOfflineGraphBackend({ transport: wire, sampleRate: 48_000 });
        await backend.apply({ schemaVersion: 1, commands: [clip(0.25)] });
        await backend.apply({ schemaVersion: 1, replaceTopology: true, commands: [clip(0.75)] });
        await backend.render(2);
        const mapped = vi.mocked(wire.mapGraphBatch).mock.calls;
        expect(mapped[1]?.[0].session?.sessionId).not.toBe(mapped[0]?.[0].session?.sessionId);
        expect(mapped[1]?.[0].session?.revision).toBe(0);
        expect(vi.mocked(wire.renderGraphOffline).mock.calls[0]?.[0].batch.commands).toHaveLength(1);
        backend.dispose();
    });
});
