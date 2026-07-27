import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { initNativeEngine } from '../initNativeEngine';
import { nativeEngineState } from '../lifecycleState';
import { stopNativeEngine } from '../stopNativeEngine';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(() => false),
    tauriInvoke: vi.fn(),
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: { set: vi.fn(), value: {} },
}));

function ignoreResolution(): void {}

function getInvocationArgs(callIndex: number): Record<string, unknown> {
    const call: unknown = vi.mocked(tauriInvoke).mock.calls[callIndex];
    if (!Array.isArray(call)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    const args: unknown = call[1];
    if (!isRecord(args)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('nativeEngine lifecycle injectables', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(false);
        nativeEngineState.ready = false;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.unstubAllGlobals();
    });

    it('should connect to llama-server in browser mode when health check passes', async () => {
        await initNativeEngine();
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('llama-server'));
    });

    it('should stop without invoking native unload when not in Tauri', async () => {
        const { tauriInvoke } = await import('#/utils/tauriBridge');
        await stopNativeEngine();
        expect(tauriInvoke).not.toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith('[Native AI] Engine stopped');
    });

    it('only cleans up the model owned by a cancelled native initialization', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        let resolveInitialization: () => void = ignoreResolution;
        vi.mocked(tauriInvoke).mockImplementation((command) => {
            if (command === 'init_native_llm') {
                return new Promise<void>((resolve) => {
                    resolveInitialization = resolve;
                });
            }
            return Promise.resolve(undefined);
        });
        const controller = new AbortController();
        const pending = initNativeEngine({ signal: controller.signal });
        await vi.waitFor(() => expect(vi.mocked(tauriInvoke).mock.calls[0]?.[0]).toBe('init_native_llm'));
        const requestId = getInvocationArgs(0).requestId;
        expect(typeof requestId).toBe('string');

        const cancellation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        resolveInitialization();

        await cancellation;
        expect(vi.mocked(tauriInvoke).mock.calls[1]?.[0]).toBe('cancel_native_llm_generation');
        expect(getInvocationArgs(1).requestId).toBe(requestId);
        expect(vi.mocked(tauriInvoke).mock.calls[2]?.[0]).toBe('unload_native_llm_if_owned');
        expect(getInvocationArgs(2).requestId).toBe(requestId);
        expect(tauriInvoke).not.toHaveBeenCalledWith('unload_native_llm');
        expect(nativeEngineState.ready).toBe(false);
    });

    it('keeps replacement readiness when a cancelled initialization resolves late', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        const initializationResolvers: Array<() => void> = [];
        vi.mocked(tauriInvoke).mockImplementation((command) => {
            if (command === 'init_native_llm') {
                return new Promise<void>((resolve) => {
                    initializationResolvers.push(resolve);
                });
            }
            if (command === 'finalize_native_llm_initialization') {
                return Promise.resolve({ loaded: true, modelId: 'qwen3-8b' });
            }
            return Promise.resolve(undefined);
        });
        const cancelledController = new AbortController();
        const cancelled = initNativeEngine({ signal: cancelledController.signal });
        await vi.waitFor(() => expect(initializationResolvers).toHaveLength(1));

        const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        cancelledController.abort();
        await cancellation;

        const replacement = initNativeEngine();
        await vi.waitFor(() => expect(initializationResolvers).toHaveLength(2));
        initializationResolvers[1]?.();
        await replacement;

        initializationResolvers[0]?.();
        await Promise.resolve();

        expect(nativeEngineState.ready).toBe(true);
        expect(tauriInvoke).not.toHaveBeenCalledWith('unload_native_llm');
    });

    it('does not report readiness when native finalization finds no loaded model', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockImplementation((command) => {
            if (command === 'finalize_native_llm_initialization') {
                return Promise.resolve({ loaded: false, modelId: null });
            }
            return Promise.resolve(undefined);
        });

        await expect(initNativeEngine()).rejects.toThrow('could not commit a loaded model');

        expect(nativeEngineState.ready).toBe(false);
    });

    it('cleans up owned native state when cancellation wins during finalization', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        let resolveFinalization: (status: { loaded: boolean; modelId: string | null }) => void = ignoreResolution;
        vi.mocked(tauriInvoke).mockImplementation((command) => {
            if (command === 'finalize_native_llm_initialization') {
                return new Promise((resolve) => {
                    resolveFinalization = resolve;
                });
            }
            return Promise.resolve(undefined);
        });
        const controller = new AbortController();
        const pending = initNativeEngine({ signal: controller.signal });
        await vi.waitFor(() =>
            expect(
                vi.mocked(tauriInvoke).mock.calls.some(([command]) => command === 'finalize_native_llm_initialization')
            ).toBe(true)
        );
        const initCallIndex = vi.mocked(tauriInvoke).mock.calls.findIndex(([command]) => command === 'init_native_llm');
        const requestId = getInvocationArgs(initCallIndex).requestId;
        const cancellation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

        controller.abort();
        resolveFinalization({ loaded: true, modelId: 'qwen3-8b' });

        await cancellation;
        expect(tauriInvoke).toHaveBeenCalledWith('unload_native_llm_if_owned', { requestId });
        expect(nativeEngineState.ready).toBe(false);
    });
});
