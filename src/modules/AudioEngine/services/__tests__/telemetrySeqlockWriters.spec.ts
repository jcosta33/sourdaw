import { describe, it, expect, vi, beforeEach } from 'vitest';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

/**
 * Audit RT-2 — every SAB telemetry device must publish its multi-field snapshot
 * under the seqlock the slot layout documents, not with bare float stores.
 *
 * Proof already did (`proofProcessor.spec.ts`); this covers the remaining four
 * SAB devices. Each spec drives the real processor over a full telemetry cadence
 * and then reads the slot exactly the way the main thread does — sampling the
 * generation counter around the field read — so a writer that skipped the
 * bracketing fails on the counter assertion, and a writer that bracketed the
 * wrong range fails on the field values.
 */

type ProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters?: Record<string, Float32Array>): boolean;
};

const { registry } = installWorkletGlobals<ProcessorLike>();

// ── Shared daw-dsp heap (Gluten / Bacteria / Grinder) ────────────────────────
const DSP_HEAP = new ArrayBuffer(393_216);
const SCORING_HEAP = new ArrayBuffer(32_768);
const FRAMES = 128;

const GLUTEN_PTR = { inLeft: 0, inRight: 4_096, scLeft: 8_192, scRight: 12_288, outLeft: 16_384, outRight: 20_480 };
const BACTERIA_PTR = { inLeft: 32_768, inRight: 36_864, outLeft: 40_960, outRight: 45_056, bandLevels: 49_152 };
const GRINDER_PTR = { inLeft: 65_536, inRight: 73_728, outLeft: 81_920, outRight: 90_112, automation: 131_072 };
const SCORING_PTR = { outLeft: 0, outRight: 4_096 };

const BACTERIA_BAND_LEVELS = [0.11, 0.22, 0.33, 0.44, 0.55, 0.66];

class GlutenInstanceMock {
    set_param(): void {}
    get_latency_samples(): number {
        return 64;
    }
    get_input_left_ptr(): number {
        return GLUTEN_PTR.inLeft;
    }
    get_input_right_ptr(): number {
        return GLUTEN_PTR.inRight;
    }
    get_sc_left_ptr(): number {
        return GLUTEN_PTR.scLeft;
    }
    get_sc_right_ptr(): number {
        return GLUTEN_PTR.scRight;
    }
    process(): number {
        return GLUTEN_PTR.outLeft;
    }
    get_right_ptr(): number {
        return GLUTEN_PTR.outRight;
    }
    get_gr_db(): number {
        return -6;
    }
    get_input_db(): number {
        return -12;
    }
    get_output_db(): number {
        return -9;
    }
    get_crest(): number {
        return 8;
    }
    get_phase_corr(): number {
        return 0.5;
    }
}

class BacteriaInstanceMock {
    set_param(): void {}
    get_latency_samples(): number {
        return 96;
    }
    get_input_left_ptr(): number {
        return BACTERIA_PTR.inLeft;
    }
    get_input_right_ptr(): number {
        return BACTERIA_PTR.inRight;
    }
    process(): number {
        // Seed the band-levels window the processor blits into the slot.
        const bands = new Float32Array(DSP_HEAP, BACTERIA_PTR.bandLevels, BACTERIA_BAND_LEVELS.length);
        bands.set(BACTERIA_BAND_LEVELS);
        return BACTERIA_PTR.outLeft;
    }
    get_right_ptr(): number {
        return BACTERIA_PTR.outRight;
    }
    get_band_levels_ptr(): number {
        return BACTERIA_PTR.bandLevels;
    }
    get_input_db(): number {
        return -11;
    }
    get_output_db(): number {
        return -7;
    }
}

class GrinderInstanceMock {
    set_param(): void {}
    get_latency_samples(): number {
        return 32;
    }
    get_input_left_ptr(): number {
        return GRINDER_PTR.inLeft;
    }
    get_input_right_ptr(): number {
        return GRINDER_PTR.inRight;
    }
    get_output_left_ptr(): number {
        return GRINDER_PTR.outLeft;
    }
    get_right_ptr(): number {
        return GRINDER_PTR.outRight;
    }
    get_automation_values_ptr(): number {
        return GRINDER_PTR.automation;
    }
    process_automated(): boolean {
        return true;
    }
    get_input_db(): number {
        return -13;
    }
    get_preamp_db(): number {
        return -5;
    }
    get_power_amp_db(): number {
        return -4;
    }
    get_output_db(): number {
        return -3;
    }
    get_gate_open(): number {
        return 1;
    }
    get_gate_envelope_db(): number {
        return -20;
    }
    get_sag_voltage(): number {
        return 9;
    }
    get_neural_cpu_percent(): number {
        return 12;
    }
    get_neural_warmup_progress(): number {
        return 0.75;
    }
}

class ScoringInstanceMock {
    set_param(): void {}
    process(): number {
        return SCORING_PTR.outLeft;
    }
    get_right_ptr(): number {
        return SCORING_PTR.outRight;
    }
    is_active(): boolean {
        return true;
    }
    get_frequency(): number {
        return 440;
    }
    get_cents(): number {
        return -3;
    }
    get_confidence(): number {
        return 0.9;
    }
    get_note_index(): number {
        return 9;
    }
    get_octave(): number {
        return 4;
    }
    get_midi_note(): number {
        return 69;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: DSP_HEAP } })),
    GlutenInstance: GlutenInstanceMock,
    BacteriaInstance: BacteriaInstanceMock,
    GrinderInstance: GrinderInstanceMock,
}));

vi.mock('../../wasm/scoring.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: SCORING_HEAP } })),
    ScoringInstance: ScoringInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

// Mirrors TELEMETRY_SEQ_IDX / FLOATS_PER_SLOT in engine/telemetryAllocator.ts.
const TELEMETRY_SEQ_IDX = 31;
const FLOATS_PER_SLOT = 32;

type DeviceCase = {
    device: string;
    processorName: string;
    modulePath: string;
    /** process() calls needed for exactly one telemetry publish. */
    blocksPerPublish: number;
    /** Slot index → value the mocked WASM instance reports for that field. */
    expectedFields: ReadonlyArray<readonly [number, number]>;
};

const DEVICE_CASES: readonly DeviceCase[] = [
    {
        device: 'Gluten',
        processorName: 'gluten-processor',
        modulePath: '../glutenProcessor',
        blocksPerPublish: 8,
        expectedFields: [
            [0, -6],
            [1, -12],
            [2, -9],
            [3, 8],
            [4, 0.5],
            [5, 64],
        ],
    },
    {
        device: 'Bacteria',
        processorName: 'bacteria-processor',
        modulePath: '../bacteriaProcessor',
        blocksPerPublish: 8,
        expectedFields: [
            [0, -11],
            [1, -7],
            [2, 96],
            ...BACTERIA_BAND_LEVELS.map((level, index): readonly [number, number] => [3 + index, level]),
        ],
    },
    {
        device: 'Grinder',
        processorName: 'grinder-processor',
        modulePath: '../grinderProcessor',
        blocksPerPublish: 8,
        expectedFields: [
            [0, -13],
            [1, -5],
            [2, -4],
            [3, -3],
            [4, 1],
            [5, -20],
            [6, 9],
            [7, 32],
            [8, 12],
            [9, 0.75],
        ],
    },
    {
        device: 'Scoring',
        processorName: 'scoring-processor',
        modulePath: '../scoringProcessor',
        blocksPerPublish: 4,
        expectedFields: [
            [0, 1],
            [1, 440],
            [2, -3],
            [3, 0.9],
            [4, 9],
            [5, 4],
            [6, 69],
        ],
    },
];

async function loadProcessor(testCase: DeviceCase): Promise<ProcessorLike> {
    await import(/* @vite-ignore */ testCase.modulePath);
    const Ctor = registry.get(testCase.processorName);
    if (!Ctor) {
        throw new Error(`${testCase.processorName} was not registered`);
    }
    return new Ctor({
        processorOptions: { wasmModule: new WebAssembly.Module(MINIMAL_WASM) },
    });
}

function runBlocks(proc: ProcessorLike, blocks: number): void {
    for (let block = 0; block < blocks; block++) {
        const inputs = [makeChannels(2, FRAMES, (_channel, frame) => frame / FRAMES)];
        const outputs = [makeChannels(2, FRAMES)];
        proc.process(inputs, outputs, {});
    }
}

/**
 * The faithful main-thread reader: sample the counter, read the fields, sample
 * again; accept only an unchanged, even counter. Returns the accepted field
 * values and the attempt index they were accepted on.
 */
function seqlockRead(
    floatView: Float32Array,
    seqView: Int32Array,
    indices: readonly number[]
): { values: number[]; acceptedOnAttempt: number } {
    for (let attempt = 0; attempt <= 8; attempt++) {
        const before = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        const values = indices.map((index) => floatView[index] ?? Number.NaN);
        const after = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        if (before === after && (before & 1) === 0) {
            return { values, acceptedOnAttempt: attempt };
        }
    }
    throw new Error('seqlock never settled');
}

describe.each(DEVICE_CASES)('$device telemetry seqlock writer (audit RT-2)', (testCase) => {
    let sab: SharedArrayBuffer;
    let floatView: Float32Array;
    let seqView: Int32Array;

    beforeEach(() => {
        sab = new SharedArrayBuffer(FLOATS_PER_SLOT * Float32Array.BYTES_PER_ELEMENT);
        floatView = new Float32Array(sab);
        seqView = new Int32Array(sab);
    });

    async function readyProcessor(): Promise<ProcessorLike> {
        const proc = await loadProcessor(testCase);
        proc.port.onmessage?.({
            data: { type: 'init', wasmModule: new WebAssembly.Module(MINIMAL_WASM) },
        });
        proc.port.onmessage?.({ data: { type: 'init-sab', sab, byteOffset: 0 } });
        return proc;
    }

    it('advances the slot generation counter by exactly one odd/even cycle per publish', async () => {
        const proc = await readyProcessor();

        const before = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        runBlocks(proc, testCase.blocksPerPublish);
        const afterOne = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        runBlocks(proc, testCase.blocksPerPublish);
        const afterTwo = Atomics.load(seqView, TELEMETRY_SEQ_IDX);

        expect(afterOne - before).toBe(2);
        expect(afterTwo - afterOne).toBe(2);
        // Settled (even) between publishes — odd is the write-in-progress state.
        expect(afterTwo % 2).toBe(0);
    });

    it('publishes every mapped field inside that cycle, readable on the first attempt', async () => {
        const proc = await readyProcessor();
        runBlocks(proc, testCase.blocksPerPublish);

        const indices = testCase.expectedFields.map(([index]) => index);
        const { values, acceptedOnAttempt } = seqlockRead(floatView, seqView, indices);

        expect(acceptedOnAttempt).toBe(0);
        for (const [position, [, expected]] of testCase.expectedFields.entries()) {
            expect(values[position]).toBeCloseTo(expected, 4);
        }
    });
});
