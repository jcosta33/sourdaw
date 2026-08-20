/**
 * Initializes the shared Faust compiler lazily.
 *
 * The compiler and its WASM module are loaded only when the first DSP is
 * compiled. The promise is kept in the shared engine state so concurrent
 * callers coalesce into one initialization.
 */

import { instantiateFaustModuleFromFile, FaustCompiler, LibFaust, type IFaustCompiler } from '@grame/faustwasm';

import { logger } from '#/infra/logger/appLogger';

import { createFaustError } from '../../errors/FaustError';

import { faustEngineState } from './faustEngineState';
import { getFaustErrorMessage } from './getFaustErrorMessage';

export async function getFaustCompiler(): Promise<IFaustCompiler> {
    const compilerState = faustEngineState.compiler;
    if (!compilerState.promise) {
        compilerState.promise = (async () => {
            try {
                // Use an origin-relative path for dev, desktop, and hosted builds.
                const faustPath = `${window.location.origin}/faust/libfaust-wasm.js`;
                const module = await instantiateFaustModuleFromFile(faustPath);
                const libFaust = new LibFaust(module);
                const compiler = new FaustCompiler(libFaust);
                compilerState.ready = true;
                return compiler;
            } catch (error) {
                const message = getFaustErrorMessage(error);
                compilerState.error = message;
                logger.warn(`[Faust] Compiler initialization failed: ${message}`);
                throw createFaustError(`Faust compiler unavailable: ${message}`);
            }
        })();
    }
    return compilerState.promise;
}
