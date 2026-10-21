import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { fetchCompiledWasmModule } from '#/infra/audioWorklet/workletInitShared';

import type { LevainZoneTableRequest, LevainZoneTables } from '../../models/LevainZoneTables';

const DAW_DSP_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

function abortReason(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) {
        return signal.reason;
    }
    return new DOMException('Levain zone-table build aborted', 'AbortError');
}

function readBuiltTables(data: unknown): LevainZoneTables | null {
    if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== 'built') {
        return null;
    }
    const lut: unknown = Reflect.get(data, 'lut');
    const arena: unknown = Reflect.get(data, 'arena');
    return lut instanceof Uint32Array && arena instanceof Uint32Array ? { lut, arena } : null;
}

function readFailure(data: unknown): string {
    if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== 'failed') {
        return 'it answered with an unreadable message';
    }
    const message: unknown = Reflect.get(data, 'message');
    return typeof message === 'string' ? message : 'it answered with an unreadable message';
}

/**
 * Compute one Levain bank's zone tables in a dedicated Worker running its own
 * daw-dsp instance, so the worklet's render thread never builds them. One
 * Worker per request, terminated once it answers, fails or the load aborts:
 * the tables are computed once per bank load, and a terminated Worker returns
 * every byte its instance grew to.
 *
 * Rejects when the Worker reports a failure, errors or answers with anything
 * but tables, and at once on `signal`; it never falls back to building on
 * another thread.
 */
export async function buildLevainZoneTablesInWorker(
    request: LevainZoneTableRequest,
    signal?: AbortSignal
): Promise<LevainZoneTables> {
    signal?.throwIfAborted();
    const wasmModule = await raceAbortSignal(fetchCompiledWasmModule(DAW_DSP_WASM_URL), signal);
    signal?.throwIfAborted();

    return new Promise<LevainZoneTables>((resolve, reject) => {
        const worker = new Worker(new URL('../../workers/levainZoneTableWorker.ts', import.meta.url), {
            type: 'module',
        });

        function finish(): void {
            signal?.removeEventListener('abort', onAbort);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
        function fail(error: Error): void {
            finish();
            reject(error);
        }
        function onAbort(): void {
            if (signal) {
                fail(abortReason(signal));
            }
        }

        worker.onmessage = (event: MessageEvent<unknown>): void => {
            const tables = readBuiltTables(event.data);
            if (!tables) {
                fail(new Error(`Levain zone-table worker failed: ${readFailure(event.data)}`));
                return;
            }
            finish();
            resolve(tables);
        };
        worker.onerror = (event: ErrorEvent): void => {
            fail(new Error(`Levain zone-table worker failed: ${event.message || 'it crashed'}`));
        };
        worker.onmessageerror = (): void => {
            fail(new Error('Levain zone-table worker failed: it sent an unreadable message'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
            worker.postMessage({ type: 'build', wasmModule, request });
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
