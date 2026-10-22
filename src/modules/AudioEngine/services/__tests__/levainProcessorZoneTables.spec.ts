import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEVAIN_ZONE_TABLE_CHUNK_ENTRIES } from '#/infra/audioWorklet/levainZoneTableChunk';

import { computeLevainZoneTables } from '../../transformers/computeLevainZoneTables';

import { deliverZoneTables, type Deliver, WIDE_ZONE } from './levainZoneTableHarness';
import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

import type { LevainZoneSpan, LevainZoneTableRequest, LevainZoneTables } from '../../models/LevainZoneTables';

// The shipped engine, driven through the shipped processor: a bank's zone
// tables are computed off the render thread by the engine's own builder and
// staged in bounded, checked chunks; the processor never builds them.

type Engine = {
    has_retired_bank: () => boolean;
    build_zone_map: (numArticulations: number, numMics: number) => boolean;
    zone_table_write_ptr: () => number;
    zone_table_write_words: () => number;
    commit_zone_lut_chunk: (start: number, entries: number) => boolean;
    commit_zone_arena_chunk: (start: number, entries: number) => boolean;
};

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: unknown[], outputs: unknown[]) => boolean;
    _instance: Engine | null;
    _memory: WebAssembly.Memory | null;
};

type Posted = { type?: string; loadToken?: number; message?: string; done?: boolean };

const FRAMES = 128;
const SAMPLE_RATE = 48_000;
const SAMPLE_FRAMES = 4_000;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function send(processor: LevainProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function posted(processor: LevainProcessorLike): Posted[] {
    return processor.port.postMessage.mock.calls.map(([message]) => message as Posted);
}

function bankErrors(processor: LevainProcessorLike): string[] {
    return posted(processor)
        .filter((message) => message.type === 'sampleBankError')
        .map((message) => message.message ?? '');
}

function loaded(processor: LevainProcessorLike, loadToken: number): boolean {
    return posted(processor).some((message) => message.type === 'sampleBankLoaded' && message.loadToken === loadToken);
}

/** A registry of processors that share one module instance, as every Levain processor of a context does. */
async function processorFactory(): Promise<() => LevainProcessorLike> {
    vi.resetModules();
    const { registry } = installWorkletGlobals<LevainProcessorLike>();
    await import('../levainProcessor');
    const Processor = registry.get('levain-processor');
    if (!Processor) {
        throw new TypeError('Expected levain-processor registration');
    }
    vi.stubGlobal('currentFrame', 0);
    return () => {
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        return processor;
    };
}

async function createProcessor(): Promise<LevainProcessorLike> {
    return (await processorFactory())();
}

function engineOf(processor: LevainProcessorLike): Engine {
    if (!processor._instance) {
        throw new TypeError('Expected an initialised engine');
    }
    return processor._instance;
}

function sine(frames: number, cyclesPerFrame: number): Float32Array {
    return new Float32Array(frames).map((_, frame) => Math.sin(frame * cyclesPerFrame * 2 * Math.PI) * 0.5);
}

function uploadSample(processor: LevainProcessorLike, loadToken: number, sampleId: number, data: Float32Array): void {
    send(processor, {
        type: 'beginSample',
        loadToken,
        sampleId,
        frameCount: data.length,
        channels: 1,
        sampleRate: SAMPLE_RATE,
    });
    send(processor, { type: 'sampleChunk', loadToken, sampleId, data });
    send(processor, { type: 'sealSample', loadToken, sampleId });
}

function addZone(processor: LevainProcessorLike, loadToken: number, zone: LevainZoneSpan, sampleId: number): void {
    send(processor, {
        type: 'addZone',
        loadToken,
        sampleId,
        zoneId: zone.zoneId,
        articulationId: zone.articulationId,
        micId: zone.micId,
        rootNote: 60,
        loKey: zone.loKey,
        hiKey: zone.hiKey,
        loVel: zone.loVel,
        hiVel: zone.hiVel,
        rrPos: 0,
        rrLen: 1,
        loopMode: 'forward',
        loopStart: 0,
        loopEnd: SAMPLE_FRAMES,
        loopCrossfade: 0,
        gainDb: 0,
        attack: 0.005,
        decay: 0.1,
        sustain: 1,
        release: 0.3,
    });
}

/**
 * Begin a bank, upload one sample per entry of `samples`, and add `zones`
 * (zone `i` plays sample `i % samples.length`). The owner of a fresh key
 * uploads; a follower or ready load's sample messages are ignored.
 */
function stageBankContents(
    processor: LevainProcessorLike,
    loadToken: number,
    bankKey: string,
    zones: readonly LevainZoneSpan[],
    samples: readonly Float32Array[]
): void {
    send(processor, { type: 'beginSampleBank', bankKey, instrumentId: 'violin-1', loadToken });
    for (const [sampleId, data] of samples.entries()) {
        uploadSample(processor, loadToken, sampleId, data);
    }
    for (const zone of zones) {
        addZone(processor, loadToken, zone, zone.zoneId % samples.length);
    }
}

/**
 * The largest bank the engine takes: 32 articulations by 8 mics, four zones
 * per pair, each eight keys by four velocity buckets, so the arena stays
 * inside its fixed capacity while every pair of the LUT is populated.
 */
function largestBankZones(): LevainZoneSpan[] {
    const zones: LevainZoneSpan[] = [];
    for (let articulationId = 0; articulationId < 32; articulationId++) {
        for (let micId = 0; micId < 8; micId++) {
            for (let layer = 0; layer < 4; layer++) {
                const loKey = 24 + ((articulationId * 3 + micId * 5 + layer * 17) % 90);
                zones.push({
                    zoneId: zones.length,
                    articulationId,
                    micId,
                    loKey,
                    hiKey: loKey + 7,
                    loVel: layer * 32,
                    hiVel: layer * 32 + 31,
                });
            }
        }
    }
    return zones;
}

/** Record every table chunk the engine accepted, read from its window as it committed. */
function recordAcceptedTables(processor: LevainProcessorLike): { lut: number[]; arena: number[] } {
    const engine = engineOf(processor);
    const accepted = { lut: [] as number[], arena: [] as number[] };
    const windowWords = (words: number): number[] => {
        if (!processor._memory) {
            throw new TypeError('Expected the engine memory');
        }
        return [...new Uint32Array(processor._memory.buffer, engine.zone_table_write_ptr(), words)];
    };
    const commitLut = engine.commit_zone_lut_chunk.bind(engine);
    engine.commit_zone_lut_chunk = (start, entries) => {
        const words = windowWords(entries * 2);
        const committed = commitLut(start, entries);
        if (committed) {
            expect(start * 2).toBe(accepted.lut.length);
            accepted.lut.push(...words);
        }
        return committed;
    };
    const commitArena = engine.commit_zone_arena_chunk.bind(engine);
    engine.commit_zone_arena_chunk = (start, entries) => {
        const ids = windowWords(entries);
        const committed = commitArena(start, entries);
        if (committed) {
            expect(start).toBe(accepted.arena.length);
            accepted.arena.push(...ids);
        }
        return committed;
    };
    return accepted;
}

/** Index of the first word the two tables disagree on, or -1: a failure reads as one number. */
function firstMismatch(actual: readonly number[], expected: Uint32Array): number {
    if (actual.length !== expected.length) {
        return Math.min(actual.length, expected.length);
    }
    return actual.findIndex((word, index) => word !== expected[index]);
}

function messageEntries(data: Record<string, unknown>): number {
    const words = data.data instanceof Uint32Array ? data.data.length : 0;
    return data.table === 'lut' ? words / 2 : words;
}

/** Render `quanta` quanta of left output. */
function render(processor: LevainProcessorLike, quanta: number): number[] {
    const rendered: number[] = [];
    for (let quantum = 0; quantum < quanta; quantum++) {
        const output = makeChannels(2, FRAMES);
        processor.process([], [output]);
        rendered.push(...output[0]!);
    }
    return rendered;
}

function peak(samples: readonly number[]): number {
    return samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

function stageAndCommit(
    processor: LevainProcessorLike,
    loadToken: number,
    request: LevainZoneTableRequest,
    tables: LevainZoneTables = computeLevainZoneTables(wasmModule, request)
): void {
    deliverZoneTables((data) => send(processor, data), loadToken, request, tables);
    send(processor, { type: 'commitSampleBank', loadToken });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped LevainProcessor zone-table staging', () => {
    it('pins the loader chunk size to the engine window, which holds one LUT chunk', async () => {
        const processor = await createProcessor();

        expect(engineOf(processor).zone_table_write_words()).toBe(2 * LEVAIN_ZONE_TABLE_CHUNK_ENTRIES);
    });

    it('stages a 32 x 8 bank in messages of at most one chunk, and the engine holds exactly the builder tables', async () => {
        const zones = largestBankZones();
        const request: LevainZoneTableRequest = { zones, numArticulations: 32, numMics: 8 };
        const tables = computeLevainZoneTables(wasmModule, request);
        expect(tables.lut.length / 2).toBe(32 * 8 * 128 * 16);

        const processor = await createProcessor();
        stageBankContents(processor, 1, 'largest', zones, [sine(SAMPLE_FRAMES, 0.01)]);
        const accepted = recordAcceptedTables(processor);
        const delivered: { type: string; entries: number }[] = [];
        const deliver: Deliver = (data) => {
            send(processor, data);
            delivered.push({ type: data.type, entries: messageEntries(data) });
        };

        deliverZoneTables(deliver, 1, request, tables);
        send(processor, { type: 'commitSampleBank', loadToken: 1 });

        expect(bankErrors(processor)).toEqual([]);
        expect(loaded(processor, 1)).toBe(true);
        const chunks = delivered.filter(({ type }) => type === 'zoneTableChunk');
        expect(Math.max(...chunks.map(({ entries }) => entries))).toBe(LEVAIN_ZONE_TABLE_CHUNK_ENTRIES);
        expect(chunks.length).toBe(
            Math.ceil(tables.lut.length / 2 / LEVAIN_ZONE_TABLE_CHUNK_ENTRIES) +
                Math.ceil(tables.arena.length / LEVAIN_ZONE_TABLE_CHUNK_ENTRIES)
        );
        expect(posted(processor).filter((message) => message.type === 'zoneTableChunkWritten')).toHaveLength(
            chunks.length
        );
        expect(firstMismatch(accepted.lut, tables.lut)).toBe(-1);
        expect(firstMismatch(accepted.arena, tables.arena)).toBe(-1);
    }, 120_000);

    // A measurement, not a check: set LEVAIN_ZONE_TABLE_TIMING to print the
    // longest message handler of each path on the same 32 x 8 bank, cold and
    // then again on the same processor. Today's `buildZoneMap` handler was the
    // build plus the commit, inside one port message.
    it.runIf(process.env.LEVAIN_ZONE_TABLE_TIMING !== undefined)(
        'times the staged path against the build it replaces',
        async () => {
            const zones = largestBankZones();
            const request: LevainZoneTableRequest = { zones, numArticulations: 32, numMics: 8 };
            const tables = computeLevainZoneTables(wasmModule, request);
            const sample = [sine(SAMPLE_FRAMES, 0.01)];
            const maxMs = (timings: readonly { type: string; ms: number }[]): Record<string, number> => {
                const byType = new Map<string, number>();
                for (const { type, ms } of timings) {
                    byType.set(type, Math.max(byType.get(type) ?? 0, ms));
                }
                return Object.fromEntries(byType);
            };

            const staged = await createProcessor();
            const stagedTimings: { type: string; ms: number }[][] = [];
            for (const loadToken of [1, 2]) {
                send(staged, { type: 'releaseRetiredBank', loadToken: loadToken - 1 });
                stageBankContents(staged, loadToken, `staged-${loadToken}`, zones, sample);
                const timings: { type: string; ms: number }[] = [];
                const timed: Deliver = (data) => {
                    const started = performance.now();
                    send(staged, data);
                    timings.push({ type: data.type, ms: performance.now() - started });
                };
                deliverZoneTables(timed, loadToken, request, tables);
                timed({ type: 'commitSampleBank', loadToken });
                expect(loaded(staged, loadToken)).toBe(true);
                stagedTimings.push(timings);
            }

            const built = await createProcessor();
            const buildMs: number[] = [];
            for (const loadToken of [1, 2]) {
                send(built, { type: 'releaseRetiredBank', loadToken: loadToken - 1 });
                stageBankContents(built, loadToken, `built-${loadToken}`, zones, sample);
                const started = performance.now();
                expect(engineOf(built).build_zone_map(32, 8)).toBe(true);
                send(built, { type: 'commitSampleBank', loadToken });
                buildMs.push(performance.now() - started);
                expect(loaded(built, loadToken)).toBe(true);
            }

            console.info(
                JSON.stringify({
                    kind: 'levain-zone-table-staging-32x8',
                    stagedMessages: stagedTimings[0]?.length,
                    stagedCold: maxMs(stagedTimings[0] ?? []),
                    stagedWarm: maxMs(stagedTimings[1] ?? []),
                    buildZoneMapHandlerCold: buildMs[0],
                    buildZoneMapHandlerWarm: buildMs[1],
                })
            );
        },
        120_000
    );

    it('refuses a table posted in one message, so nothing is installed', async () => {
        const zones = largestBankZones();
        const request: LevainZoneTableRequest = { zones, numArticulations: 32, numMics: 8 };
        const tables = computeLevainZoneTables(wasmModule, request);
        const processor = await createProcessor();
        stageBankContents(processor, 1, 'one-message', zones, [sine(SAMPLE_FRAMES, 0.01)]);
        send(processor, {
            type: 'reserveZoneTables',
            loadToken: 1,
            numArticulations: 32,
            numMics: 8,
            lutEntries: tables.lut.length / 2,
            arenaEntries: tables.arena.length,
        });

        send(processor, { type: 'zoneTableChunk', loadToken: 1, table: 'lut', start: 0, data: tables.lut });
        send(processor, { type: 'sealZoneTables', loadToken: 1 });
        send(processor, { type: 'commitSampleBank', loadToken: 1 });

        expect(bankErrors(processor)).toEqual(['Levain zone-table chunk does not fit the write window']);
        expect(loaded(processor, 1)).toBe(false);
    });

    describe('refuses what would make lookup unsound: the load rejects and nothing is installed', () => {
        // One wide zone on one articulation and mic: 2,048 LUT slots, a 2,048-entry arena.
        const request: LevainZoneTableRequest = { zones: [WIDE_ZONE], numArticulations: 1, numMics: 1 };

        function corrupt(
            tables: LevainZoneTables,
            change: (lut: Uint32Array, arena: Uint32Array) => void
        ): LevainZoneTables {
            const copy = { lut: tables.lut.slice(), arena: tables.arena.slice() };
            change(copy.lut, copy.arena);
            return copy;
        }

        const CHUNK_REFUSED = 'Levain DSP refused a zone-table chunk';
        const RESERVATION_REFUSED = 'Levain DSP refused the zone-table reservation';
        const cases: Array<{
            name: string;
            refusal: string;
            deliver: (deliver: Deliver, tables: LevainZoneTables) => void;
        }> = [
            {
                name: 'a LUT ref reaching past the declared arena',
                refusal: CHUNK_REFUSED,
                deliver: (deliver, tables) =>
                    deliverZoneTables(
                        deliver,
                        1,
                        request,
                        corrupt(tables, (lut) => (lut[0] = tables.arena.length))
                    ),
            },
            {
                name: 'an arena id the bank holds no zone for',
                refusal: CHUNK_REFUSED,
                deliver: (deliver, tables) =>
                    deliverZoneTables(
                        deliver,
                        1,
                        request,
                        corrupt(tables, (_, arena) => (arena[5] = 1))
                    ),
            },
            {
                name: 'a chunk out of order',
                refusal: CHUNK_REFUSED,
                deliver: (deliver, tables) => {
                    deliver({
                        type: 'reserveZoneTables',
                        loadToken: 1,
                        numArticulations: 1,
                        numMics: 1,
                        lutEntries: tables.lut.length / 2,
                        arenaEntries: tables.arena.length,
                    });
                    deliver({
                        type: 'zoneTableChunk',
                        loadToken: 1,
                        table: 'lut',
                        start: 1,
                        data: tables.lut.slice(2),
                    });
                },
            },
            {
                name: 'a chunk past the end of its table',
                refusal: CHUNK_REFUSED,
                deliver: (deliver, tables) => {
                    deliver({
                        type: 'reserveZoneTables',
                        loadToken: 1,
                        numArticulations: 1,
                        numMics: 1,
                        lutEntries: tables.lut.length / 2,
                        arenaEntries: tables.arena.length,
                    });
                    deliver({ type: 'zoneTableChunk', loadToken: 1, table: 'lut', start: 0, data: tables.lut });
                    deliver({
                        type: 'zoneTableChunk',
                        loadToken: 1,
                        table: 'lut',
                        start: tables.lut.length / 2,
                        data: new Uint32Array(2),
                    });
                },
            },
            {
                name: 'dimensions over the DSP limits',
                refusal: RESERVATION_REFUSED,
                deliver: (deliver, tables) =>
                    deliverZoneTables(deliver, 1, { numArticulations: 33, numMics: 1 }, tables),
            },
            {
                name: 'a LUT size the dimensions do not imply',
                refusal: RESERVATION_REFUSED,
                deliver: (deliver, tables) =>
                    deliverZoneTables(deliver, 1, { numArticulations: 2, numMics: 1 }, tables),
            },
            {
                name: 'a seal before every entry is written',
                refusal: 'Levain DSP could not seal zone tables that are incomplete',
                deliver: (deliver, tables) => {
                    deliver({
                        type: 'reserveZoneTables',
                        loadToken: 1,
                        numArticulations: 1,
                        numMics: 1,
                        lutEntries: tables.lut.length / 2,
                        arenaEntries: tables.arena.length,
                    });
                    deliver({ type: 'zoneTableChunk', loadToken: 1, table: 'lut', start: 0, data: tables.lut });
                    deliver({ type: 'sealZoneTables', loadToken: 1 });
                },
            },
        ];

        it.each(cases)('$name', async ({ deliver, refusal }) => {
            const tables = computeLevainZoneTables(wasmModule, request);
            const processor = await createProcessor();
            stageBankContents(processor, 1, 'unsound', [WIDE_ZONE], [sine(SAMPLE_FRAMES, 0.01)]);

            deliver((data) => send(processor, data), tables);
            send(processor, { type: 'sealZoneTables', loadToken: 1 });
            send(processor, { type: 'commitSampleBank', loadToken: 1 });

            // The refusal is the first and only answer: the load rejects at the
            // message that broke the rule, and nothing after it is applied.
            expect(bankErrors(processor)).toEqual([refusal]);
            expect(loaded(processor, 1)).toBe(false);
            // Nothing committed: a fresh engine has no bank and no fallback tone to sound.
            send(processor, { type: 'noteOn', note: 60, velocity: 100 });
            expect(peak(render(processor, 4))).toBeLessThan(1e-6);
        });
    });

    it('stages and commits on owner, follower and ready processors, and each plays', async () => {
        const create = await processorFactory();
        const request: LevainZoneTableRequest = { zones: [WIDE_ZONE], numArticulations: 1, numMics: 1 };
        const owner = create();
        const follower = create();
        const sample = [sine(SAMPLE_FRAMES, 0.01)];

        stageBankContents(owner, 1, 'shared', [WIDE_ZONE], sample);
        stageBankContents(follower, 2, 'shared', [WIDE_ZONE], sample);
        stageAndCommit(follower, 2, request);
        expect(loaded(follower, 2)).toBe(false);
        stageAndCommit(owner, 1, request);
        expect(loaded(owner, 1)).toBe(true);
        expect(loaded(follower, 2)).toBe(true);

        const ready = create();
        stageBankContents(ready, 3, 'shared', [WIDE_ZONE], sample);
        expect(posted(ready)).toContainEqual({ type: 'sampleBankUploadDecision', loadToken: 3, uploadRequired: false });
        stageAndCommit(ready, 3, request);
        expect(loaded(ready, 3)).toBe(true);

        for (const processor of [owner, follower, ready]) {
            expect(bankErrors(processor)).toEqual([]);
            send(processor, { type: 'noteOn', note: 60, velocity: 100 });
            expect(peak(render(processor, 8))).toBeGreaterThan(1e-3);
        }
    });

    it('drops a zone-table chunk and a reservation that reach a follower after its owner failed, and the follower stays live', async () => {
        const create = await processorFactory();
        const request: LevainZoneTableRequest = { zones: [WIDE_ZONE], numArticulations: 1, numMics: 1 };
        const owner = create();
        const follower = create();
        const sample = [sine(SAMPLE_FRAMES, 0.01)];
        stageBankContents(owner, 1, 'owner-fails', [WIDE_ZONE], sample);
        stageBankContents(follower, 2, 'owner-fails', [WIDE_ZONE], sample);
        const deliveries: Array<Record<string, unknown> & { type: string }> = [];
        deliverZoneTables((data) => deliveries.push(data), 2, request, computeLevainZoneTables(wasmModule, request));
        expect(deliveries.map(({ type }) => type)).toEqual([
            'reserveZoneTables',
            'zoneTableChunk',
            'zoneTableChunk',
            'sealZoneTables',
        ]);
        const written = (): number => posted(follower).filter(({ type }) => type === 'zoneTableChunkWritten').length;
        // The follower's loader has posted its tables; the worklet has read the reservation and the LUT chunk.
        send(follower, deliveries[0]);
        send(follower, deliveries[1]);
        expect(written()).toBe(1);

        // The owner fails (it seals tables it never reserved), which rejects every follower of its bank.
        send(owner, { type: 'sealZoneTables', loadToken: 1 });
        const refusal = 'Levain DSP could not seal zone tables that are incomplete';
        expect(bankErrors(owner)).toEqual([refusal]);
        expect(bankErrors(follower)).toEqual([refusal]);
        const engine = engineOf(follower);
        const memory = follower._memory;
        if (!memory) {
            throw new TypeError('Expected the engine memory');
        }
        const window = (): number[] => [
            ...new Uint32Array(memory.buffer, engine.zone_table_write_ptr(), engine.zone_table_write_words()),
        ];
        const windowBefore = window();

        // The arena chunk the follower's loader posted before it heard is now stale.
        send(follower, deliveries[2]);
        // So is a reservation that arrives after it: the engine already holds one, so applying it would fault the follower.
        send(follower, deliveries[0]);

        expect(window()).toEqual(windowBefore);
        expect(written()).toBe(1);
        expect(posted(follower).filter(({ type }) => type === 'error')).toEqual([]);
        expect(bankErrors(follower)).toEqual([refusal]);
        stageBankContents(follower, 3, 'after-owner-failed', [WIDE_ZONE], sample);
        stageAndCommit(follower, 3, request);
        expect(loaded(follower, 3)).toBe(true);
    });

    it('retires a reservation an abort catches mid-staging and frees it in the paced release', async () => {
        const zones = largestBankZones();
        const request: LevainZoneTableRequest = { zones, numArticulations: 32, numMics: 8 };
        const tables = computeLevainZoneTables(wasmModule, request);
        const processor = await createProcessor();
        stageBankContents(processor, 1, 'aborted', zones, [sine(SAMPLE_FRAMES, 0.01)]);
        const deliveries: Array<Record<string, unknown> & { type: string }> = [];
        deliverZoneTables((data) => deliveries.push(data), 1, request, tables);
        for (const data of deliveries.slice(0, 4)) {
            send(processor, data);
        }

        send(processor, { type: 'abortSampleBank', loadToken: 1 });
        expect(engineOf(processor).has_retired_bank()).toBe(true);

        let steps = 0;
        while (!posted(processor).some((message) => message.type === 'retiredBankReleased' && message.done === true)) {
            send(processor, { type: 'releaseRetiredBank', loadToken: 1 });
            steps++;
            expect(steps).toBeLessThan(100);
        }
        expect(engineOf(processor).has_retired_bank()).toBe(false);

        stageBankContents(processor, 2, 'after-abort', [WIDE_ZONE], [sine(SAMPLE_FRAMES, 0.01)]);
        stageAndCommit(processor, 2, { zones: [WIDE_ZONE], numArticulations: 1, numMics: 1 });
        expect(loaded(processor, 2)).toBe(true);
    });

    it('plays every articulation, mic and velocity layer the same as a bank whose tables the engine built itself', async () => {
        // Three articulations by two mics, two velocity layers each, every zone its own pitch.
        const zones: LevainZoneSpan[] = [];
        for (let articulationId = 0; articulationId < 3; articulationId++) {
            for (let micId = 0; micId < 2; micId++) {
                for (const [loVel, hiVel] of [
                    [0, 63],
                    [64, 127],
                ] as const) {
                    zones.push({ zoneId: zones.length, articulationId, micId, loKey: 48, hiKey: 72, loVel, hiVel });
                }
            }
        }
        const samples = zones.map((zone) => sine(SAMPLE_FRAMES, 0.004 + zone.zoneId * 0.0013));
        const request: LevainZoneTableRequest = { zones, numArticulations: 3, numMics: 2 };

        const playEverything = (processor: LevainProcessorLike): number[] => {
            const rendered: number[] = [];
            for (let articulationId = 0; articulationId < 3; articulationId++) {
                for (const velocity of [40, 100]) {
                    for (const note of [50, 60, 70]) {
                        send(processor, { type: 'noteOn', note, velocity, articulationId });
                        rendered.push(...render(processor, 3));
                        send(processor, { type: 'allNotesOff' });
                        rendered.push(...render(processor, 2));
                    }
                }
            }
            return rendered;
        };

        const staged = await createProcessor();
        stageBankContents(staged, 1, 'identity-staged', zones, samples);
        stageAndCommit(staged, 1, request);
        expect(loaded(staged, 1)).toBe(true);
        const stagedOutput = playEverything(staged);

        const built = await createProcessor();
        stageBankContents(built, 1, 'identity-built', zones, samples);
        expect(engineOf(built).build_zone_map(3, 2)).toBe(true);
        send(built, { type: 'commitSampleBank', loadToken: 1 });
        expect(loaded(built, 1)).toBe(true);
        const builtOutput = playEverything(built);

        expect(peak(stagedOutput)).toBeGreaterThan(1e-3);
        expect(stagedOutput.findIndex((sample, index) => !Object.is(sample, builtOutput[index]))).toBe(-1);
    });
});
