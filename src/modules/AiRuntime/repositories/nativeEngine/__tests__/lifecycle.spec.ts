import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { initNativeEngine } from '../initNativeEngine';
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

describe('nativeEngine lifecycle injectables', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        vi.clearAllMocks();
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
});
