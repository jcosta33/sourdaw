import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { initNativeEngine, stopNativeEngine } from '../lifecycle';
import { type Logger } from '#/helpers/Logger/Logger';

vi.mock('#/helpers/tauriBridge', () => ({
    isTauri: vi.fn(() => false),
    tauriInvoke: vi.fn(),
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: { set: vi.fn(), value: {} },
}));

describe('nativeEngine lifecycle injectables', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.unstubAllGlobals();
    });

    it('should connect to llama-server in browser mode when health check passes', async () => {
        const logger = createMock<Logger>();
        injectDependencies(initNativeEngine, { logger });

        await initNativeEngine();

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('llama-server'));
    });

    it('should stop without invoking native unload when not in Tauri', async () => {
        const { tauriInvoke } = await import('#/helpers/tauriBridge');

        const logger = createMock<Logger>();
        injectDependencies(stopNativeEngine, { logger });

        await stopNativeEngine();

        expect(tauriInvoke).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith('[Native AI] Engine stopped');
    });
});
