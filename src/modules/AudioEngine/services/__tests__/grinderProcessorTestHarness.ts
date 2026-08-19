import { vi } from 'vitest';

import grinderAudioParamContract from '../grinderAudioParamContract.json';

type GrinderAudioParamDescriptor = {
    name: string;
    defaultValue: number;
    minValue: number;
    maxValue: number;
    automationRate?: 'a-rate' | 'k-rate';
};

export type GrinderProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};

type GrinderProcessorConstructor = {
    new (...args: unknown[]): GrinderProcessorLike;
    readonly parameterDescriptors: readonly GrinderAudioParamDescriptor[];
};

const registry = new Map<string, GrinderProcessorConstructor>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, processor: GrinderProcessorConstructor) => {
    registry.set(name, processor);
});
vi.stubGlobal('sampleRate', 48_000);

const WASM_HEAP = new ArrayBuffer(160_000);
const INPUT_LEFT_PTR = 1_024;
const INPUT_RIGHT_PTR = 10_240;
const OUTPUT_LEFT_PTR = 19_456;
const OUTPUT_RIGHT_PTR = 28_672;
const AUTOMATION_PTR = 40_960;
const MAX_GRINDER_BLOCK_SIZE = 2_048;
// Read off the same contract the processor reads. Restating `11` here made this
// harness a *second* copy of the number under test: it decoded the mock buffer
// at the same wrong offsets the processor would write to, so no spec built on it
// could ever observe a header/value-region disagreement. The real TS↔Rust weld
// is `wasm/__tests__/dawDspGrinderAutomationLayout.spec.ts`, which drives the
// shipped binary; this only has to stop contradicting it.
const AUTOMATABLE_PARAM_COUNT = grinderAudioParamContract.length;

export const grinderSetParamCalls: Array<{ name: string; value: number }> = [];
export const grinderProcessSizes: number[] = [];
export const grinderAutomatedProcessSizes: number[] = [];
export let grinderRightPtrCalls = 0;
let grinderLatencySamples = 0;
let grinderLatencySamplesAfterSetParam: number | null = null;

class GrinderInstanceMock {
    get_input_left_ptr(): number {
        return INPUT_LEFT_PTR;
    }

    get_input_right_ptr(): number {
        return INPUT_RIGHT_PTR;
    }

    get_right_ptr(): number {
        grinderRightPtrCalls++;
        return OUTPUT_RIGHT_PTR;
    }

    get_output_left_ptr(): number {
        return OUTPUT_LEFT_PTR;
    }

    get_automation_values_ptr(): number {
        return AUTOMATION_PTR;
    }

    set_param(name: string, value: number): void {
        grinderSetParamCalls.push({ name, value });
        if (grinderLatencySamplesAfterSetParam !== null) {
            grinderLatencySamples = grinderLatencySamplesAfterSetParam;
        }
    }

    process(frames: number): number {
        grinderProcessSizes.push(frames);
        const inputLeft = new Float32Array(WASM_HEAP, INPUT_LEFT_PTR, frames);
        const inputRight = new Float32Array(WASM_HEAP, INPUT_RIGHT_PTR, frames);
        new Float32Array(WASM_HEAP, OUTPUT_LEFT_PTR, frames).set(inputLeft);
        new Float32Array(WASM_HEAP, OUTPUT_RIGHT_PTR, frames).set(inputRight);
        return OUTPUT_LEFT_PTR;
    }

    process_automated(frames: number): number {
        grinderAutomatedProcessSizes.push(frames);
        const inputLeft = new Float32Array(WASM_HEAP, INPUT_LEFT_PTR, frames);
        const inputRight = new Float32Array(WASM_HEAP, INPUT_RIGHT_PTR, frames);
        new Float32Array(WASM_HEAP, OUTPUT_LEFT_PTR, frames).set(inputLeft);
        new Float32Array(WASM_HEAP, OUTPUT_RIGHT_PTR, frames).set(inputRight);
        return OUTPUT_LEFT_PTR;
    }

    get_latency_samples(): number {
        return grinderLatencySamples;
    }

    get_input_db(): number {
        return 0;
    }

    get_preamp_db(): number {
        return 0;
    }

    get_power_amp_db(): number {
        return 0;
    }

    get_output_db(): number {
        return 0;
    }

    get_gate_open(): number {
        return 0;
    }

    get_gate_envelope_db(): number {
        return 0;
    }

    get_sag_voltage(): number {
        return 0;
    }

    get_neural_cpu_percent(): number {
        return 0;
    }

    get_neural_warmup_progress(): number {
        return 0;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: WASM_HEAP } })),
    GrinderInstance: GrinderInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

export async function loadGrinderProcessorConstructor(): Promise<GrinderProcessorConstructor> {
    await import('../grinderProcessor');
    const processor = registry.get('grinder-processor');
    if (!processor) {
        throw new Error('grinder-processor was not registered');
    }
    return processor;
}

export async function createReadyGrinderProcessor(): Promise<GrinderProcessorLike> {
    const Processor = await loadGrinderProcessorConstructor();
    const processor = new Processor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
    processor.port.onmessage?.({ data: { type: 'init', wasmModule: MINIMAL_WASM_MODULE } });
    return processor;
}

export function resetGrinderProcessorCalls(): void {
    grinderSetParamCalls.length = 0;
    grinderProcessSizes.length = 0;
    grinderAutomatedProcessSizes.length = 0;
    grinderRightPtrCalls = 0;
    grinderLatencySamples = 0;
    grinderLatencySamplesAfterSetParam = null;
}

export function setGrinderLatencySamplesAfterSetParam(latency: number): void {
    grinderLatencySamplesAfterSetParam = latency;
}

export function getGrinderAutomationHeader(paramIndex: number): number {
    return new Float32Array(WASM_HEAP, AUTOMATION_PTR, AUTOMATABLE_PARAM_COUNT)[paramIndex] ?? 0;
}

export function getGrinderAutomationValue(paramIndex: number, frame: number): number {
    const valueIndex = AUTOMATABLE_PARAM_COUNT + paramIndex * MAX_GRINDER_BLOCK_SIZE + frame;
    return new Float32Array(WASM_HEAP, AUTOMATION_PTR, valueIndex + 1)[valueIndex] ?? 0;
}
