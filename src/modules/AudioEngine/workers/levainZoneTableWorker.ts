/// <reference lib="webworker" />
/**
 * Levain zone-table Worker. Computes one bank's zone tables on its own daw-dsp
 * instance, so the AudioWorklet's render thread only ever copies finished
 * tables in bounded chunks and never computes them.
 *
 * One request per Worker; the client terminates it once answered.
 *
 *   ← { type: 'build', wasmModule: WebAssembly.Module, request: LevainZoneTableRequest }
 *   → { type: 'built', lut: Uint32Array, arena: Uint32Array }   (both buffers transferred)
 *   → { type: 'failed', message: string }
 */

import { type LevainZoneTableRequest } from '../models/LevainZoneTables';
import { computeLevainZoneTables } from '../transformers/computeLevainZoneTables';

type LevainZoneTableWorkerMsg = {
    type: 'build';
    wasmModule: WebAssembly.Module;
    request: LevainZoneTableRequest;
};

self.onmessage = ({ data }: MessageEvent<LevainZoneTableWorkerMsg>): void => {
    try {
        const { lut, arena } = computeLevainZoneTables(data.wasmModule, data.request);
        self.postMessage({ type: 'built', lut, arena }, [lut.buffer, arena.buffer]);
    } catch (error) {
        self.postMessage({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
};
