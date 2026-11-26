import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEngineLifecycle, type EngineLifecyclePorts } from '../createEngineLifecycle';

import type { TrackNode } from '../../../engine/TrackNode';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    masters: [] as Array<{ mode: string; wireMeter: ReturnType<typeof vi.fn>; postShutdown: ReturnType<typeof vi.fn> }>,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('../createMasterSection', () => ({
    createMasterSection: ({ mode }: { mode: string }) => {
        const master = { mode, wireMeter: vi.fn(), postShutdown: vi.fn() };
        mocks.masters.push(master);
        return master;
    },
}));

function createContextStub(addModule: () => Promise<void> = () => Promise.resolve()) {
    return {
        state: 'suspended' as AudioContextState,
        audioWorklet: { addModule: vi.fn(addModule) },
        resume: vi.fn(() => Promise.resolve()),
        suspend: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
    };
}

function createLifecycle(
    context: ReturnType<typeof createContextStub> | undefined,
    overrides: Partial<EngineLifecyclePorts> = {}
) {
    return createEngineLifecycle({
        providedContext: context as unknown as AudioContext | undefined,
        openLiveContext: () => createContextStub() as unknown as AudioContext,
        readTrackNodes: () => new Map(),
        readDisposalEffects: () => [],
        ...overrides,
    });
}

afterEach(() => {
    mocks.masters.length = 0;
    mocks.notifyUser.mockClear();
});

describe('createEngineLifecycle', () => {
    it('falls back to the silent graph and tells the user when no AudioContext can be created', async () => {
        const lifecycle = createLifecycle(undefined, {
            openLiveContext: () => {
                throw new Error('no audio device');
            },
        });

        expect(lifecycle.isFallback()).toBe(true);
        expect(mocks.masters.map((master) => master.mode)).toEqual(['fallback']);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Audio engine failed to initialize — audio playback is disabled. Try reloading the page.',
            'error'
        );
        await expect(lifecycle.initialize()).resolves.toBeUndefined();
    });

    it('opens a provided context live, without a stored latency profile', () => {
        const context = createContextStub();

        const lifecycle = createLifecycle(context);

        expect(lifecycle.isFallback()).toBe(false);
        expect(lifecycle.context()).toBe(context);
        expect(lifecycle.latencyProfile).toBeNull();
        expect(lifecycle.latencyHint).toBeNull();
        expect(mocks.masters.map((master) => master.mode)).toEqual(['live']);
    });

    it('does not cache a failed worklet load, so the next initialize retries it', async () => {
        let fail = true;
        const context = createContextStub(() => (fail ? Promise.reject(new Error('404')) : Promise.resolve()));
        const lifecycle = createLifecycle(context);

        await expect(lifecycle.initialize()).rejects.toThrow('404');
        expect(lifecycle.lastInitError()?.message).toBe('404');
        expect(lifecycle.isWorkletReady()).toBe(false);

        fail = false;
        await lifecycle.initialize();

        expect(lifecycle.isWorkletReady()).toBe(true);
        expect(lifecycle.lastInitError()).toBeNull();
        expect(mocks.masters[0]?.wireMeter).toHaveBeenCalledOnce();
    });

    it('rejects an initialization in flight when the engine is disposed, without wiring the meter', async () => {
        const load = Promise.withResolvers<void>();
        const context = createContextStub(() => load.promise);
        const lifecycle = createLifecycle(context);

        const initializing = lifecycle.initialize();
        const disposing = lifecycle.dispose();
        load.resolve();

        await expect(initializing).rejects.toThrow('Audio engine was disposed during initialization.');
        await disposing;
        expect(mocks.masters[0]?.wireMeter).not.toHaveBeenCalled();
        await expect(lifecycle.initialize()).rejects.toThrow('Audio engine has been disposed.');
    });

    it('disposes once: every caller shares one run of the shutdown list and one context closure', async () => {
        const context = createContextStub();
        const effect = vi.fn();
        const lifecycle = createLifecycle(context, { readDisposalEffects: () => [effect] });

        const first = lifecycle.dispose();
        const second = lifecycle.dispose();
        await Promise.all([first, second]);

        expect(second).toBe(first);
        expect(effect).toHaveBeenCalledOnce();
        expect(context.close).toHaveBeenCalledOnce();
        expect(() => lifecycle.assertActive()).toThrow('Audio engine has been disposed.');
    });

    it('runs every shutdown effect in order and closes the context before reporting a fault', async () => {
        const context = createContextStub();
        const order: string[] = [];
        context.close.mockImplementation(() => {
            order.push('close');
            return Promise.resolve();
        });
        const lifecycle = createLifecycle(context, {
            readDisposalEffects: () => [
                () => order.push('shutdown'),
                () => {
                    order.push('reset');
                    throw new Error('reset fault');
                },
                () => order.push('release'),
            ],
        });

        await expect(lifecycle.dispose()).rejects.toThrow('reset fault');

        expect(order).toEqual(['shutdown', 'reset', 'release', 'close']);
    });

    it('records and rethrows a failed resume, and clears it on the next success', async () => {
        const context = createContextStub();
        context.resume.mockRejectedValueOnce(new Error('not allowed'));
        const lifecycle = createLifecycle(context);

        await expect(lifecycle.resume()).rejects.toThrow('not allowed');
        expect(lifecycle.lastResumeError()?.message).toBe('not allowed');

        await lifecycle.resume();
        expect(lifecycle.lastResumeError()).toBeNull();
    });

    it('posts shutdown to the master and to every strip meter and worklet device node', () => {
        const context = createContextStub();
        const meter = { port: { postMessage: vi.fn() } };
        const worklet = Object.assign(Object.create(AudioWorkletNode.prototype) as AudioWorkletNode, {
            port: { postMessage: vi.fn() },
        });
        const plain = { port: { postMessage: vi.fn() } };
        const trackNode = { strip: { meterNode: meter, deviceNodes: [{ nodes: [worklet, plain] }] } };
        const lifecycle = createLifecycle(context, {
            readTrackNodes: () => new Map([['t1', trackNode as unknown as TrackNode]]),
        });

        lifecycle.postShutdownToWorklets();

        expect(mocks.masters[0]?.postShutdown).toHaveBeenCalledExactlyOnceWith({ type: 'shutdown' });
        expect(meter.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'shutdown' });
        expect(worklet.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'shutdown' });
        expect(plain.port.postMessage).not.toHaveBeenCalled();
    });

    it('reads the replaced context on every later call', async () => {
        const context = createContextStub();
        const replacement = createContextStub();
        const lifecycle = createLifecycle(context);

        lifecycle.replaceContext(replacement as unknown as AudioContext);
        await lifecycle.resume();

        expect(lifecycle.context()).toBe(replacement);
        expect(replacement.resume).toHaveBeenCalledOnce();
        expect(context.resume).not.toHaveBeenCalled();
    });
});
