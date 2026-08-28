/**
 * Initializes the shared Faust compiler lazily.
 *
 * The compiler and its WASM module are loaded only when the first DSP is
 * compiled. The promise is kept in the shared engine state so concurrent
 * callers coalesce into one initialization — and a rejected one is dropped
 * rather than kept, so a failed load is answered by a fresh attempt, not by
 * the same rejection until the page is reloaded.
 */

import { instantiateFaustModuleFromFile, FaustCompiler, LibFaust, type IFaustCompiler } from '@grame/faustwasm';

import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createFaustError } from '../../errors/FaustError';

import { faustEngineState } from './faustEngineState';
import { getFaustErrorMessage } from './getFaustErrorMessage';

export async function getFaustCompiler(): Promise<IFaustCompiler> {
    const compilerState = faustEngineState.compiler;
    if (!compilerState.promise) {
        const promise = (async () => {
            try {
                // Use an origin-relative path for dev, desktop, and hosted builds.
                const faustPath = `${window.location.origin}/faust/libfaust-wasm.js`;
                const module = await instantiateFaustModuleFromFile(faustPath);
                const libFaust = new LibFaust(module);
                const compiler = new FaustCompiler(libFaust);
                compilerState.ready = true;
                // A later attempt can succeed where an earlier one failed, and a
                // stale error from the failed one would keep answering
                // `createFaustNode`'s "why not" question after recovery.
                compilerState.error = null;
                return compiler;
            } catch (error) {
                const message = getFaustErrorMessage(error);
                compilerState.error = message;
                logger.warn(`[Faust] Compiler initialization failed: ${message}`);
                // The surface every other device-load failure reaches. The
                // console alone is invisible to a musician whose Faust devices
                // just went silent.
                notifyUser(`Faust compiler unavailable: ${message}`, 'error');
                throw createFaustError(`Faust compiler unavailable: ${message}`);
            }
        })();
        compilerState.promise = promise;
        // Clear a rejection instead of caching it: kept, it would answer every
        // later call with the first failure and disable all Faust devices until
        // a page reload. Clearing gives one retry per caller — not a retry
        // loop, because each attempt is the heavyweight WASM fetch a compile
        // asked for, and callers still coalesce into one attempt while a
        // promise is pending.
        promise.catch(() => {
            compilerState.promise = null;
        });
    }
    return compilerState.promise;
}
