import { grinderNeuralModelJson } from '../models/GrinderNeuralModelJson';
import { type GrinderNeuralModel } from '../models/GrinderPatch';

import { isRecord, type UnknownRecord } from './namConfigReaders';

/**
 * The WaveNet half of the admission plan native admission shares with the
 * WASM parser (`crates/daw-dsp/src/grinder/nam/admission_plan.rs`), which runs
 * it before building anything: the size caps, the bounded scan of the runtime
 * text, and the state, resident, prewarm and transient memory envelope. The
 * per-sample work ceilings stay native-only (they feed the desktop instance
 * ledger), so captures that only exceed those still load in the browser.
 *
 * Runs after `waveNetWeightCount`, so every value it reads is already a
 * well-typed positive integer of the shape the runtime accepts.
 */

const MIB = 1024 * 1024;
const MAX_WEIGHTS = 65_536;
const MAX_TEXT_BYTES = MIB;
const MAX_CONFIG_BYTES = 16_384;
const MAX_NODES = 4096;
const MAX_DEPTH = 32;
const MAX_STRING_BYTES = 4096;
/** serde_json's 64-bit `Value` slot, charged per weight on every target. */
const VALUE_SLOT = 32;

const MAX_WIDTH = 64;
const MAX_KERNEL = 9;
const MAX_DILATION = 32_768;
const MAX_ARRAYS = 4;
const MAX_LAYERS = 32;
const MAX_POST_HEAD_KERNELS = 8;

type Plan = {
    floats: number;
    allocations: number;
    structures: number;
    state: number;
    prewarm: number;
    mac: number;
    nonlinear: number;
    touches: number;
};

type TextScan = {
    nodes: number;
};

const utf8 = new TextEncoder();

function byteLength(text: string): number {
    return utf8.encode(text).length;
}

/** A dimension as the runtime's `dimension()` reads it: a positive integer
 * no larger than `max`. Every size, count and list length goes through here. */
function dimension(value: unknown, max: number, name: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
        throw new Error(
            `Unsupported NAM model: WaveNet ${name} (${JSON.stringify(value)}) must be a positive integer within the runtime limit of ${max}`
        );
    }
    return value;
}

/** An optional dimension, as `optional_dimension()` reads it: `fallback` when
 * the key is absent, else a dimension. */
function optionalDimension(record: UnknownRecord, key: string, fallback: number, max: number): number {
    if (record[key] === undefined) {
        return fallback;
    }
    return dimension(record[key], max, key);
}

function buffer(plan: Plan, floats: number): void {
    plan.floats += floats;
    if (floats > 0) {
        plan.allocations += 1;
    }
}

type Convolution = {
    input: number;
    output: number;
    kernel: number;
    dilation: number;
    bias: boolean;
    history: boolean;
};

function convolution(plan: Plan, conv: Convolution): void {
    const taps = conv.input * conv.output * conv.kernel;
    plan.mac += taps;
    plan.touches += conv.input + conv.output;
    buffer(plan, taps);
    if (conv.bias) {
        buffer(plan, conv.output);
    }
    if (conv.history) {
        const lookback = (conv.kernel - 1) * conv.dilation;
        const state = conv.input * (lookback + 1);
        plan.state += state;
        buffer(plan, state);
        plan.prewarm += lookback;
    }
    plan.structures += 1;
}

function pointwise(plan: Plan, input: number, output: number, bias: boolean): void {
    convolution(plan, { input, output, kernel: 1, dilation: 1, bias, history: false });
}

const TRANSCENDENTAL_ACTIVATIONS: readonly unknown[] = ['Tanh', 'Sigmoid', 'SiLU'];

function activation(plan: Plan, value: unknown, channels: number): void {
    const name = isRecord(value) ? value.type : value;
    if (TRANSCENDENTAL_ACTIVATIONS.includes(name)) {
        plan.nonlinear += channels;
    }
    plan.touches += channels;
    if (name === 'PReLU' && isRecord(value)) {
        buffer(plan, preluSlopeCount(value));
        plan.allocations += 1;
    }
}

function preluSlopeCount(value: UnknownRecord): number {
    if (value.negative_slope !== undefined) {
        return 1;
    }
    return dimension((value.negative_slopes as unknown[]).length, MAX_WIDTH, 'PReLU negative_slopes count');
}

function subConfig(layer: UnknownRecord, key: string): UnknownRecord {
    const value = layer[key];
    return isRecord(value) ? value : {};
}

function nestedHead(layer: UnknownRecord): UnknownRecord | null {
    return isRecord(layer.head) ? layer.head : null;
}

function arrayHeadSize(layer: UnknownRecord): number {
    const head = nestedHead(layer);
    if (head !== null) {
        return dimension(head.out_channels, MAX_WIDTH, 'head out_channels');
    }
    return dimension(layer.head_size, MAX_WIDTH, 'head_size');
}

function isGated(layer: UnknownRecord): boolean {
    if (typeof layer.gating_mode === 'string') {
        return layer.gating_mode !== 'none';
    }
    return layer.gated === true;
}

type ArrayCarry = {
    head: number;
};

function layerKernel(layer: UnknownRecord, index: number): number {
    if (Array.isArray(layer.kernel_sizes)) {
        return dimension(layer.kernel_sizes[index], MAX_KERNEL, 'kernel_sizes entry');
    }
    return dimension(layer.kernel_size, MAX_KERNEL, 'kernel_size');
}

function planLayers(plan: Plan, layer: UnknownRecord, channels: number, head_input: number): void {
    const bottleneck = optionalDimension(layer, 'bottleneck', channels, MAX_WIDTH);
    const gated = isGated(layer);
    const output = dimension(gated ? 2 * bottleneck : bottleneck, MAX_WIDTH, 'gated width');
    const layer_active = subConfig(layer, 'layer1x1').active !== false;
    const head_active = subConfig(layer, 'head1x1').active === true;
    const dilations = layer.dilations as unknown[];
    for (const [index, raw_dilation] of dilations.entries()) {
        const kernel = layerKernel(layer, index);
        const dilation = dimension(raw_dilation, MAX_DILATION, 'dilation');
        convolution(plan, { input: channels, output, kernel, dilation, bias: true, history: true });
        pointwise(plan, 1, output, false);
        if (layer_active) {
            pointwise(plan, bottleneck, channels, true);
        }
        if (head_active) {
            pointwise(plan, bottleneck, head_input, true);
        }
        buffer(plan, 2 * output + channels + head_input);
        plan.allocations += 4;
        activation(plan, layer.activation, bottleneck);
        if (gated) {
            activation(plan, layer.secondary_activation ?? 'Sigmoid', bottleneck);
        }
    }
}

function headInputWidth(layer: UnknownRecord, bottleneck: number): number {
    const head1x1 = subConfig(layer, 'head1x1');
    if (head1x1.active !== true) {
        return bottleneck;
    }
    return dimension(head1x1.out_channels, MAX_WIDTH, 'head1x1 out_channels');
}

function headConvolution(layer: UnknownRecord): { kernel: number; dilation: number; bias: boolean } {
    const nested = nestedHead(layer);
    if (nested === null) {
        return { kernel: 1, dilation: 1, bias: layer.head_bias === true };
    }
    return {
        kernel: dimension(nested.kernel_size, MAX_KERNEL, 'head kernel_size'),
        dilation: optionalDimension(nested, 'head_dilation', 1, MAX_DILATION),
        bias: nested.bias === true,
    };
}

function planArray(plan: Plan, layer: UnknownRecord): ArrayCarry {
    const input = dimension(layer.input_size, MAX_WIDTH, 'input_size');
    dimension(layer.condition_size, 1, 'condition_size');
    const channels = dimension(layer.channels, MAX_WIDTH, 'channels');
    const bottleneck = optionalDimension(layer, 'bottleneck', channels, MAX_WIDTH);
    const head_input = headInputWidth(layer, bottleneck);
    pointwise(plan, input, channels, false);
    planLayers(plan, layer, channels, head_input);

    const head = arrayHeadSize(layer);
    convolution(plan, { ...headConvolution(layer), input: head_input, output: head, history: true });
    buffer(plan, head + head_input + 2 * channels);
    plan.allocations += 4;
    // Native reads a present head_size even beside a nested head: it is the
    // width the next array's channels chain to.
    optionalDimension(layer, 'head_size', head, MAX_WIDTH);
    return { head };
}

function planPostStackHead(plan: Plan, raw_head: unknown, input_size: number): void {
    if (!isRecord(raw_head)) {
        return;
    }
    const channels = dimension(raw_head.channels, MAX_WIDTH, 'post-stack head channels');
    dimension(raw_head.out_channels, 1, 'post-stack head out_channels');
    const kernel_sizes = raw_head.kernel_sizes as unknown[];
    dimension(kernel_sizes.length, MAX_POST_HEAD_KERNELS, 'post-stack head kernel count');
    let input = input_size;
    let widest = Math.max(input, channels);
    for (const [index, raw_kernel] of kernel_sizes.entries()) {
        const output = index + 1 === kernel_sizes.length ? 1 : channels;
        activation(plan, raw_head.activation, input);
        const kernel = dimension(raw_kernel, MAX_KERNEL, 'post-stack head kernel size');
        convolution(plan, { input, output, kernel, dilation: 1, bias: true, history: true });
        widest = Math.max(widest, output);
        input = output;
    }
    buffer(plan, 2 * widest);
    plan.allocations += 4;
}

function planWaveNet(config: UnknownRecord): Plan {
    const plan: Plan = {
        floats: 0,
        allocations: 1,
        structures: 1,
        state: 0,
        prewarm: 1,
        mac: 0,
        nonlinear: 0,
        touches: 0,
    };
    optionalDimension(config, 'in_channels', 1, 1);
    optionalDimension(config, 'out_channels', 1, 1);
    const layers = config.layers as UnknownRecord[];
    dimension(layers.length, MAX_ARRAYS, 'layer array count');
    const layer_count = layers.reduce(
        (total, layer) => total + dimension((layer.dilations as unknown[]).length, MAX_LAYERS, 'dilations per array'),
        0
    );
    dimension(layer_count, MAX_LAYERS, 'layer count');
    const widest_head = Math.max(...layers.map(arrayHeadSize));
    let last_head = 1;
    for (const layer of layers) {
        last_head = planArray(plan, layer).head;
    }
    buffer(plan, 1 + (layers[0]!.channels as number) + widest_head + last_head);
    plan.allocations += 4;
    planPostStackHead(plan, config.head, last_head);
    return plan;
}

function isFiniteF32(value: number): boolean {
    return Number.isFinite(Math.fround(value));
}

function scanString(text: string, what: string): void {
    const serialized = JSON.stringify(text);
    if (byteLength(serialized) - 2 > MAX_STRING_BYTES) {
        throw new Error(
            `Unsupported NAM model: a ${what} longer than ${MAX_STRING_BYTES} bytes exceeds the runtime limit`
        );
    }
}

function scanKey(key: string): void {
    scanString(key, 'config key');
    if (JSON.stringify(key).includes('\\')) {
        throw new Error(
            `Unsupported NAM model: config key ${JSON.stringify(key)} needs JSON escaping, which the runtime refuses`
        );
    }
}

/** Count and bound one value of the runtime text as the runtime's scan does:
 * every value is a node, nesting deeper than 32 levels is refused, and every
 * number must stay finite as an f32. */
function scanValue(scan: TextScan, value: unknown, depth: number): void {
    if (depth > MAX_DEPTH || scan.nodes >= MAX_NODES) {
        throw new Error(
            `Unsupported NAM model: config nesting or size exceeds the runtime limit (${MAX_DEPTH} levels, ${MAX_NODES} values)`
        );
    }
    scan.nodes += 1;
    if (typeof value === 'string') {
        scanString(value, 'string');
    } else if (typeof value === 'number' && !isFiniteF32(value)) {
        throw new Error("Unsupported NAM model: a config number overflows the runtime's 32-bit float");
    } else if (Array.isArray(value)) {
        for (const entry of value) {
            scanValue(scan, entry, depth + 1);
        }
    } else if (isRecord(value)) {
        for (const [key, entry] of Object.entries(value)) {
            scanKey(key);
            scanValue(scan, entry, depth + 1);
        }
    }
}

/** The runtime text carries architecture, config, weights and the optional
 * version and sample rate at its root, never metadata, so the runtime's
 * metadata and duplicate-key limits cannot bind here. */
function scanRuntimeDocument(model: GrinderNeuralModel): TextScan {
    if (model.weights.length > MAX_WEIGHTS) {
        throw new Error(
            `Unsupported NAM model: ${model.weights.length} weights exceed the runtime limit of ${MAX_WEIGHTS}`
        );
    }
    if (!model.weights.every(isFiniteF32)) {
        throw new Error("Unsupported NAM model: a weight overflows the runtime's 32-bit float");
    }
    const scan: TextScan = { nodes: 2 };
    scanValue(scan, model.architecture, 1);
    scanValue(scan, model.config, 1);
    if (model.version !== null) {
        scanValue(scan, model.version, 1);
    }
    if (model.sampleRate !== null) {
        scanValue(scan, model.sampleRate, 1);
    }
    return scan;
}

/**
 * Refuse a validated WaveNet model the runtime would refuse at load: its
 * structural caps, the scan limits on the exact text the worklet sends
 * (`grinderNeuralModelJson`), and the memory envelope.
 */
export function assertWaveNetRuntimeAdmission(model: GrinderNeuralModel): void {
    const text_bytes = byteLength(grinderNeuralModelJson(model));
    if (text_bytes > MAX_TEXT_BYTES) {
        throw new Error(
            `Unsupported NAM model: the ${text_bytes}-byte model exceeds the runtime limit of ${MAX_TEXT_BYTES}`
        );
    }
    const config_bytes = byteLength(JSON.stringify(model.config));
    if (config_bytes > MAX_CONFIG_BYTES) {
        throw new Error(
            `Unsupported NAM model: the ${config_bytes}-byte config exceeds the runtime limit of ${MAX_CONFIG_BYTES}`
        );
    }
    const scan = scanRuntimeDocument(model);
    const plan = planWaveNet(model.config);

    const prewarm = Math.ceil(plan.prewarm / 64) * 64;
    // Every owned vector at twice its logical length, 128 bytes per
    // allocation and 2 KiB per runtime node, as the runtime charges it.
    const resident = plan.floats * 8 + plan.allocations * 128 + plan.structures * 2048;
    const work = plan.mac + 64 * plan.nonlinear + 16 * plan.touches;
    if (plan.state > 1_048_576 || resident > 8 * MIB || prewarm > 65_536 || prewarm * work > 268_435_456) {
        throw new Error(
            'Unsupported NAM model: WaveNet capture exceeds the runtime memory budget (state, resident, prewarm or warm-up work)'
        );
    }
    const parser = 2 * text_bytes + model.weights.length * (3 * VALUE_SLOT + 8) + scan.nodes * 1024 + config_bytes * 8;
    if (131_072 + resident + parser > 32 * MIB) {
        throw new Error('Unsupported NAM model: WaveNet capture exceeds the runtime preparation memory budget');
    }
}
