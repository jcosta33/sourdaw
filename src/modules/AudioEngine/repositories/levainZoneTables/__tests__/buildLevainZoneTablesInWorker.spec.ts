import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLevainZoneTablesInWorker } from '../buildLevainZoneTablesInWorker';

import type { LevainZoneTableRequest } from '../../../models/LevainZoneTables';

const compiled = vi.hoisted(() => ({ module: {} as WebAssembly.Module }));

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    compileWasmModule: vi.fn(() => Promise.resolve(compiled.module)),
}));

class FakeWorker {
    static created: FakeWorker[] = [];
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly posted: unknown[] = [];
    terminated = false;

    constructor(
        readonly url: URL,
        readonly options: WorkerOptions
    ) {
        FakeWorker.created.push(this);
    }

    postMessage(message: unknown): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminated = true;
    }

    answer(data: unknown): void {
        this.onmessage?.({ data } as MessageEvent<unknown>);
    }
}

const REQUEST: LevainZoneTableRequest = {
    zones: [{ zoneId: 0, articulationId: 0, micId: 0, loKey: 0, hiKey: 127, loVel: 0, hiVel: 127 }],
    numArticulations: 1,
    numMics: 1,
};

async function startedWorker(): Promise<FakeWorker> {
    await vi.waitFor(() => {
        expect(FakeWorker.created).toHaveLength(1);
    });
    return FakeWorker.created[0]!;
}

describe('buildLevainZoneTablesInWorker', () => {
    beforeEach(() => {
        FakeWorker.created = [];
        vi.stubGlobal('Worker', FakeWorker);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('hands the Worker the compiled module and the request, resolves its tables and terminates it', async () => {
        const pending = buildLevainZoneTablesInWorker(REQUEST);
        const worker = await startedWorker();
        expect(worker.options).toEqual({ type: 'module' });
        expect(worker.posted).toEqual([{ type: 'build', wasmModule: compiled.module, request: REQUEST }]);

        const lut = new Uint32Array([0, 1]);
        const arena = new Uint32Array([0]);
        worker.answer({ type: 'built', lut, arena });

        await expect(pending).resolves.toEqual({ lut, arena });
        expect(worker.terminated).toBe(true);
    });

    it('rejects with the failure the Worker reports, and terminates it', async () => {
        const pending = buildLevainZoneTablesInWorker(REQUEST);
        const worker = await startedWorker();

        worker.answer({ type: 'failed', message: 'Levain zone tables exceed the DSP dimension or capacity limits' });

        await expect(pending).rejects.toThrow(
            'Levain zone-table worker failed: Levain zone tables exceed the DSP dimension or capacity limits'
        );
        expect(worker.terminated).toBe(true);
    });

    it('rejects when the Worker errors or answers with something that is not tables', async () => {
        const crashed = buildLevainZoneTablesInWorker(REQUEST);
        const crashing = await startedWorker();
        crashing.onerror?.({ message: 'script failed to load' } as ErrorEvent);
        await expect(crashed).rejects.toThrow('Levain zone-table worker failed: script failed to load');
        expect(crashing.terminated).toBe(true);

        FakeWorker.created = [];
        const garbled = buildLevainZoneTablesInWorker(REQUEST);
        const garbling = await startedWorker();
        garbling.answer({ type: 'built', lut: [0, 1], arena: new Uint32Array(0) });
        await expect(garbled).rejects.toThrow(
            'Levain zone-table worker failed: it answered with an unreadable message'
        );
        expect(garbling.terminated).toBe(true);
    });

    it('stops waiting at once when the load aborts, terminating the Worker', async () => {
        const controller = new AbortController();
        const reason = new Error('superseded');
        const pending = buildLevainZoneTablesInWorker(REQUEST, controller.signal);
        const worker = await startedWorker();

        controller.abort(reason);

        await expect(pending).rejects.toBe(reason);
        expect(worker.terminated).toBe(true);
    });

    it('starts no Worker for a load that has already aborted', async () => {
        const controller = new AbortController();
        controller.abort(new Error('gone'));

        await expect(buildLevainZoneTablesInWorker(REQUEST, controller.signal)).rejects.toThrow('gone');
        expect(FakeWorker.created).toHaveLength(0);
    });
});
