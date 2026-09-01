import { instantiateFaustModuleFromFile } from '@grame/faustwasm';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { compileFaustDSP } from '../compileFaustDSP';
import { getFaustCompiler } from '../compilerEngine';
import { createFaustNode } from '../createFaustNode';
import { faustEngineState } from '../faustEngineState';
import { isFaustModule } from '../isFaustModule';
import { registerFaustDSP } from '../registerFaustDSP';

vi.mock('@grame/faustwasm', () => ({
    instantiateFaustModuleFromFile: vi.fn(),
    FaustCompiler: vi.fn(),
    LibFaust: vi.fn(),
    FaustMonoDspGenerator: vi.fn(),
    FaustPolyDspGenerator: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setWriters: vi.fn() },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function resetCompilerState(): void {
    faustEngineState.compiler.promise = null;
    faustEngineState.compiler.ready = false;
    faustEngineState.compiler.error = null;
}

describe('compilerEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCompilerState();
    });

    it('should export compileFaustDSP', () => {
        expect(typeof compileFaustDSP).toBe('function');
    });
    it('should export createFaustNode', () => {
        expect(typeof createFaustNode).toBe('function');
    });
    it('should export isFaustModule', () => {
        expect(typeof isFaustModule).toBe('function');
    });
    it('should export registerFaustDSP', () => {
        expect(typeof registerFaustDSP).toBe('function');
    });

    it('shares registered modules with the registry matcher', () => {
        const registered = registerFaustDSP('Compiler Engine Test', 'process = _;');

        expect(faustEngineState.modules.get(registered.id)).toBe(registered);
        expect(isFaustModule(registered.id)).toBe(true);
    });
});

describe('getFaustCompiler failure recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCompilerState();
    });

    it('clears a rejected initialization so the next caller retries instead of replaying the first failure', async () => {
        // Regression (#2305): the memo cached a rejected promise exactly like a
        // resolved one — one failed WASM fetch and every later call returned
        // the same rejection without touching the network again, leaving all
        // Faust devices dead until a page reload.
        const wasmModule = {} as Awaited<ReturnType<typeof instantiateFaustModuleFromFile>>;
        vi.mocked(instantiateFaustModuleFromFile)
            .mockRejectedValueOnce(new Error('libfaust-wasm.js fetch failed'))
            .mockResolvedValueOnce(wasmModule);

        await expect(getFaustCompiler()).rejects.toThrow('Faust compiler unavailable');
        await getFaustCompiler();

        expect(instantiateFaustModuleFromFile).toHaveBeenCalledTimes(2);
        expect(faustEngineState.compiler.ready).toBe(true);
        // The recovered attempt does not keep answering "why not" with the
        // failure it repaired.
        expect(faustEngineState.compiler.error).toBeNull();
    });

    it('still coalesces concurrent callers into one initialization attempt', async () => {
        const wasmModule = {} as Awaited<ReturnType<typeof instantiateFaustModuleFromFile>>;
        vi.mocked(instantiateFaustModuleFromFile).mockResolvedValue(wasmModule);

        const [first, second] = await Promise.all([getFaustCompiler(), getFaustCompiler()]);

        expect(instantiateFaustModuleFromFile).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
    });

    it('surfaces the initialization failure to the user, not only the console', async () => {
        // Regression (#2305): the failure was logger.warn-only — invisible to
        // a musician whose Faust devices went silent. It now reaches the same
        // notification surface every other device-load failure uses.
        vi.mocked(instantiateFaustModuleFromFile).mockRejectedValue(new Error('libfaust-wasm.js fetch failed'));

        await expect(getFaustCompiler()).rejects.toThrow('Faust compiler unavailable');

        expect(notifyUser).toHaveBeenCalledWith('Faust compiler unavailable: libfaust-wasm.js fetch failed', 'error');
        expect(logger.warn).toHaveBeenCalledWith(
            '[Faust] Compiler initialization failed: libfaust-wasm.js fetch failed'
        );
    });
});
