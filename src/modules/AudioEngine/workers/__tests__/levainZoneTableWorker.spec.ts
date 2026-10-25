import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeLevainZoneTables } from '../../transformers/computeLevainZoneTables';

import type { LevainZoneTableRequest } from '../../models/LevainZoneTables';

// The Worker entry, driven through its own `self.onmessage` over the shipped
// wasm: it answers one build request with the engine's tables, transferring
// both buffers, or with the failure.

const wasmModule = new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm')));

type Answer = { message: Record<string, unknown>; transfer: unknown };

async function loadWorker(): Promise<{ answers: Answer[]; post: (data: unknown) => void }> {
    vi.resetModules();
    const answers: Answer[] = [];
    vi.spyOn(self, 'postMessage').mockImplementation(((message: Record<string, unknown>, transfer?: unknown) => {
        answers.push({ message, transfer });
    }) as typeof self.postMessage);
    await import('../levainZoneTableWorker');
    return {
        answers,
        post: (data) => self.onmessage?.(new MessageEvent('message', { data })),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    self.onmessage = null;
});

describe('levainZoneTableWorker', () => {
    it('answers a build request with the engine tables, transferring both buffers', async () => {
        const request: LevainZoneTableRequest = {
            zones: [
                { zoneId: 0, articulationId: 0, micId: 0, loKey: 40, hiKey: 60, loVel: 0, hiVel: 90 },
                { zoneId: 1, articulationId: 1, micId: 1, loKey: 50, hiKey: 70, loVel: 64, hiVel: 127 },
            ],
            numArticulations: 2,
            numMics: 2,
        };
        const expected = computeLevainZoneTables(wasmModule, request);
        const { answers, post } = await loadWorker();

        post({ type: 'build', wasmModule, request });

        expect(answers).toHaveLength(1);
        const [{ message, transfer }] = answers as [Answer];
        expect(message.type).toBe('built');
        expect(message.lut).toEqual(expected.lut);
        expect(message.arena).toEqual(expected.arena);
        expect(transfer).toEqual([(message.lut as Uint32Array).buffer, (message.arena as Uint32Array).buffer]);
    });

    it('answers a request the engine refuses with the failure', async () => {
        const { answers, post } = await loadWorker();

        post({ type: 'build', wasmModule, request: { zones: [], numArticulations: 33, numMics: 1 } });

        expect(answers.map(({ message }) => message)).toEqual([
            { type: 'failed', message: 'Levain zone tables exceed the DSP dimension or capacity limits' },
        ]);
    });
});
