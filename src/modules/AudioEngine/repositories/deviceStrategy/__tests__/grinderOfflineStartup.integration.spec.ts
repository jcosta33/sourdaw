import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGrinderNode } from '../../../engine/GrinderNode';
import {
    loadGrinderProcessorConstructor,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
    type GrinderProcessorLike,
} from '../../../services/__tests__/grinderProcessorTestHarness';
import { createNativeDspStrategy } from '../NativeDspDeviceStrategy';

vi.mock('#/infra/audioWorklet/workletInitShared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/audioWorklet/workletInitShared')>()),
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
}));

vi.mock('../../../engine/telemetryAllocator', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/telemetryAllocator')>()),
    telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() },
}));

class OfflineContext {
    currentTime = 0;
    sampleRate = 48_000;
}

const target = {
    trackId: 'offline-grinder-track',
    deviceId: 'grinder-1',
    deviceType: 'grinder',
    parameterIds: ['neuralCustomOutputTrim'],
};

describe('offline Grinder startup consumption', () => {
    let queued: unknown[];
    let processor: GrinderProcessorLike;
    let worklets: Array<{
        port: { onmessage: ((event: MessageEvent<unknown>) => void) | null; close: ReturnType<typeof vi.fn> };
        disconnect: ReturnType<typeof vi.fn>;
        onprocessorerror: (() => void) | null;
    }>;

    beforeEach(async () => {
        resetGrinderProcessorCalls();
        vi.stubGlobal('sampleRate', 48_000);
        vi.stubGlobal('currentFrame', 0);
        vi.stubGlobal('AudioContext', class {});
        vi.stubGlobal('OfflineAudioContext', OfflineContext);
        queued = [];
        worklets = [];
        const Processor = await loadGrinderProcessorConstructor();
        class WorkletNode {
            parameters = new Map<string, AudioParam>();
            disconnect = vi.fn();
            onprocessorerror: (() => void) | null = null;
            port = {
                onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
                close: vi.fn(),
                postMessage: (data: unknown) => {
                    if (
                        typeof data === 'object' &&
                        data !== null &&
                        'command' in data &&
                        data.command !== 'initialize-fallback-control'
                    ) {
                        queued.push(data);
                        return;
                    }
                    processor.port.onmessage?.({ data });
                },
            };
            constructor(_context: BaseAudioContext, _name: string, options: unknown) {
                worklets.push(this);
                processor = new Processor(options);
                processor.port.postMessage = vi.fn((data: unknown) => {
                    this.port.onmessage?.(new MessageEvent('message', { data }));
                });
            }
        }
        vi.stubGlobal('AudioWorkletNode', WorkletNode);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function consumeNext(): void {
        const data = queued.shift();
        expect(data).toBeDefined();
        processor.port.onmessage?.({ data });
    }

    function buildStrategy(parameterValues: Record<string, number> = { neuralCustomOutputTrim: 0.2 }) {
        return createNativeDspStrategy(new OfflineContext() as unknown as BaseAudioContext, {
            id: 'grinder-1',
            name: 'Grinder',
            type: 'grinder',
            bypassed: false,
            parameterValues,
        });
    }

    it('keeps construction and render admission pending until the real receiver consumes setup', async () => {
        let renderStarted = false;
        const building = buildStrategy().then((strategy) => {
            renderStarted = true;
            return strategy;
        });
        await vi.waitFor(() => expect(queued.length).toBeGreaterThan(0));

        expect(grinderSetParamCalls).toEqual([]);
        expect(renderStarted).toBe(false);

        consumeNext();
        expect(grinderSetParamCalls).toEqual([{ name: 'neuralCustomOutputTrim', value: 0.2 }]);
        expect(renderStarted).toBe(false);
        consumeNext();
        const strategy = await building;
        expect(renderStarted).toBe(true);
        strategy.destroy();
    });

    function record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Expected a control record');
        }
        return value as Record<string, unknown>;
    }

    it('completes an empty captured setup without consuming a control sequence', async () => {
        const building = buildStrategy({});
        await vi.waitFor(() => expect(queued).toHaveLength(1));
        consumeNext();
        const strategy = await building;
        expect(grinderSetParamCalls).toEqual([]);
        strategy.destroy();
    });

    it.each(['generation', 'target', 'sequence', 'render-started'] as const)(
        'refuses a setup completion with invalid %s and releases the unusable node',
        async (invalid) => {
            const building = buildStrategy();
            const rejected = expect(building).rejects.toMatchObject({
                failureKind: 'offline-grinder-setup',
                cause: expect.objectContaining({ message: expect.stringContaining('not completely consumed') }),
            });
            await vi.waitFor(() => expect(queued).toHaveLength(2));
            consumeNext();
            const completion = record(queued.shift());
            if (invalid === 'target') {
                completion.target = { ...record(completion.target), deviceId: 'other-device' };
            } else if (invalid === 'render-started') {
                vi.stubGlobal('currentFrame', 128);
            } else {
                const correlation = record(completion.correlation);
                if (invalid === 'generation') {
                    correlation.workletGeneration = -1;
                } else {
                    correlation.controlSequence = 2;
                }
            }
            processor.port.onmessage?.({ data: completion });
            await rejected;
            expect(worklets[0]!.port.close).toHaveBeenCalledOnce();
            expect(worklets[0]!.disconnect).toHaveBeenCalledOnce();
            expect(processor.port.postMessage).not.toHaveBeenCalledWith(
                expect.objectContaining({ phase: 'offline-grinder-setup' })
            );
        }
    );

    it('refuses a skipped invalid setter even when a later valid setter reaches the final sequence', async () => {
        const building = buildStrategy({ neuralMix: 1, neuralCustomOutputTrim: 0.2 });
        const rejected = expect(building).rejects.toMatchObject({
            failureKind: 'offline-grinder-setup',
            cause: expect.objectContaining({ message: expect.stringContaining('not completely consumed') }),
        });
        await vi.waitFor(() => expect(queued).toHaveLength(3));
        const original = record(queued.shift());
        const invalid = { ...original, target: { ...record(original.target), deviceId: 'other-device' } };
        processor.port.onmessage?.({ data: invalid });
        consumeNext();
        consumeNext();
        await rejected;
        expect(grinderSetParamCalls).toEqual([{ name: 'neuralCustomOutputTrim', value: 0.2 }]);
    });

    it('preserves the startup cause when releasing the new node throws', async () => {
        const building = buildStrategy();
        const rejected = expect(building).rejects.toMatchObject({
            failureKind: 'offline-grinder-setup',
            cause: expect.objectContaining({ message: expect.stringContaining('not completely consumed') }),
        });
        await vi.waitFor(() => expect(queued).toHaveLength(2));
        worklets[0]!.port.close.mockImplementation(() => {
            throw new Error('close failed');
        });
        consumeNext();
        const completion = record(queued.shift());
        completion.correlation = { ...record(completion.correlation), controlSequence: 2 };
        processor.port.onmessage?.({ data: completion });
        await rejected;
        expect(worklets[0]!.port.close).toHaveBeenCalledOnce();
    });

    async function startNodeSetup() {
        const node = await createGrinderNode(
            new OfflineContext() as unknown as BaseAudioContext,
            undefined,
            undefined,
            target
        );
        await node.ready;
        node.setParam('neuralCustomOutputTrim', 0.2);
        if (!node.completeOfflineSetup) {
            throw new Error('Offline node did not expose setup completion');
        }
        return { node, checking: node.completeOfflineSetup() };
    }

    it.each(['generation', 'target'] as const)('rejects a mismatched %s acknowledgement', async (invalid) => {
        const { node, checking } = await startNodeSetup();
        const rejected = expect(checking).rejects.toThrow('acknowledgement is invalid');
        const completion = record(queued[1]);
        let responseTarget = completion.target;
        let correlation = completion.correlation;
        if (invalid === 'target') {
            responseTarget = { ...target, deviceId: 'other' };
        } else {
            correlation = { ...record(completion.correlation), workletGeneration: -1 };
        }
        worklets[0]!.port.onmessage?.(
            new MessageEvent('message', {
                data: {
                    ...completion,
                    type: 'ready',
                    phase: 'offline-grinder-setup',
                    sampleFrame: 0,
                    target: responseTarget,
                    correlation,
                },
            })
        );
        await rejected;
        node.destroy();
    });

    it.each(['disposed', 'error', 'processorerror'] as const)('rejects %s while setup is pending', async (failure) => {
        const { node, checking } = await startNodeSetup();
        const rejected = expect(checking).rejects.toThrow(/destroyed|failed/);
        if (failure === 'disposed') {
            node.destroy();
        } else if (failure === 'error') {
            worklets[0]!.port.onmessage?.(
                new MessageEvent('message', { data: { type: 'error', message: 'processor failed' } })
            );
        } else {
            worklets[0]!.onprocessorerror?.();
        }
        await rejected;
        node.destroy();
        await expect(node.completeOfflineSetup?.()).rejects.toThrow(/destroyed|failed/);
    });

    it('times out a missing receiver response and reuses the same bounded request', async () => {
        vi.useFakeTimers();
        const { node, checking } = await startNodeSetup();
        expect(node.completeOfflineSetup?.()).toBe(checking);
        const rejected = expect(checking).rejects.toThrow('offline setup init timeout');
        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        expect(queued).toHaveLength(2);
        node.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });
});
