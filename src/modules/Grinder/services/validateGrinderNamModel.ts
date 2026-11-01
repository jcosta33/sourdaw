import { type GrinderNeuralArchitecture } from '../models/GrinderPatch';

import {
    isRecord,
    requireBool,
    requireIntArray,
    requireKnownActivation,
    requireObject,
    requirePositiveInt,
    type UnknownRecord,
} from './namConfigReaders';
import { waveNetWeightCount } from './waveNetWeightCount';

/**
 * Complete structural validation for `.nam` model files, mirroring the native
 * runtime (`crates/daw-dsp/src/grinder/nam/`) rejection-for-rejection: the
 * same supported version window, the same architecture set, and the same
 * per-architecture weight-count derivation. A file that survives this
 * validation is guaranteed to construct in the runtime — nothing is ever
 * substituted for an unsupported architecture or an inconsistent model.
 */

const SUPPORTED_ARCHITECTURES: readonly GrinderNeuralArchitecture[] = ['WaveNet', 'LSTM', 'ConvNet', 'Linear'];

const EARLIEST_SUPPORTED_VERSION: readonly [number, number] = [0, 5];
const LATEST_SUPPORTED_MAJOR = 0;
const LATEST_SUPPORTED_MINOR = 7;

function verifyVersion(version: string): void {
    const unsupported = `Unsupported NAM file version "${version}" (supported: 0.5.0 through 0.7.x)`;
    const parts = version.split('.');
    if (parts.length !== 3) {
        throw new Error(unsupported);
    }
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    const patch = Number(parts[2]);
    if (![major, minor, patch].every((value) => Number.isInteger(value) && value >= 0)) {
        throw new Error(unsupported);
    }
    const beforeEarliest =
        major < EARLIEST_SUPPORTED_VERSION[0] ||
        (major === EARLIEST_SUPPORTED_VERSION[0] && minor < EARLIEST_SUPPORTED_VERSION[1]);
    const afterLatest =
        major > LATEST_SUPPORTED_MAJOR || (major === LATEST_SUPPORTED_MAJOR && minor > LATEST_SUPPORTED_MINOR);
    if (beforeEarliest || afterLatest) {
        throw new Error(unsupported);
    }
}

/** NAMCore reads the sample rate from the document root; older files omit it. */
export function rootSampleRate(nam_json: UnknownRecord): number | null {
    const rate = nam_json.sample_rate;
    return typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
}

export type ValidatedNamModel = {
    architecture: GrinderNeuralArchitecture;
    version: string | null;
    sampleRate: number | null;
    config: UnknownRecord;
    weights: number[];
};

function lstmWeightCount(config: UnknownRecord): number {
    const num_layers = requirePositiveInt(config, 'num_layers', 'Invalid NAM model: LSTM config requires num_layers');
    const input_size = requirePositiveInt(config, 'input_size', 'Invalid NAM model: LSTM config requires input_size');
    const hidden_size = requirePositiveInt(
        config,
        'hidden_size',
        'Invalid NAM model: LSTM config requires hidden_size'
    );
    if (input_size !== 1) {
        throw new Error(
            `Invalid NAM model: multi-input LSTM captures (${input_size} inputs) are not supported; Grinder captures are mono`
        );
    }
    let out_channels = 1;
    if (config.out_channels !== undefined) {
        out_channels = requirePositiveInt(
            config,
            'out_channels',
            'Invalid NAM model: out_channels must be a positive integer'
        );
    }
    if (out_channels !== 1) {
        throw new Error(
            `Invalid NAM model: multi-channel LSTM output (${out_channels} channels) is not supported; Grinder captures are mono`
        );
    }
    if (num_layers > 1 && hidden_size > 1) {
        throw new Error('Invalid NAM model: stacked wide LSTM unsupported by current runtime');
    }
    let count = 0;
    for (let index = 0; index < num_layers; index++) {
        const layer_input = index === 0 ? input_size : hidden_size;
        count += 4 * hidden_size * (layer_input + hidden_size); // W
        count += 4 * hidden_size; // b
        count += hidden_size; // initial hidden
        count += hidden_size; // initial cell
    }
    count += hidden_size * out_channels + out_channels; // head
    return count;
}

function convNetWeightCount(config: UnknownRecord): number {
    requirePositiveInt(config, 'channels', 'Invalid NAM model: ConvNet config requires channels');
    requireIntArray(config, 'dilations', 'Invalid NAM model: ConvNet config requires dilations');
    requireBool(config, 'batchnorm', 'Invalid NAM model: ConvNet config requires batchnorm');
    requireKnownActivation(config, 'Invalid NAM model: ConvNet config requires a known activation');
    let in_channels = 1;
    if (config.in_channels !== undefined) {
        in_channels = requirePositiveInt(
            config,
            'in_channels',
            'Invalid NAM model: in_channels must be a positive integer'
        );
    }
    let out_channels = 1;
    if (config.out_channels !== undefined) {
        out_channels = requirePositiveInt(
            config,
            'out_channels',
            'Invalid NAM model: out_channels must be a positive integer'
        );
    }
    if (config.groups !== undefined && config.groups !== 1) {
        throw new Error('Unsupported NAM model: grouped ConvNet convolutions are not supported');
    }
    if (in_channels !== 1 || out_channels !== 1) {
        throw new Error(
            `Invalid NAM model: multi-channel ConvNet (${in_channels} -> ${out_channels}) is not supported; Grinder captures are mono`
        );
    }
    const channels = config.channels as number;
    const dilations = config.dilations as number[];
    const batchnorm = config.batchnorm === true;
    let count = 0;
    let block_input = 1;
    for (const dilation of dilations) {
        count += block_input * channels * 2 + (batchnorm ? 0 : channels); // Conv1D kernel 2
        if (batchnorm) {
            count += 4 * channels + 1;
        }
        block_input = channels;
        void dilation;
    }
    count += channels + 1; // head
    return count;
}

function linearWeightCount(config: UnknownRecord, sample_rate: number | null): number {
    const receptive_field = requirePositiveInt(
        config,
        'receptive_field',
        'Invalid NAM model: Linear config requires receptive_field'
    );
    requireBool(config, 'bias', 'Invalid NAM model: Linear config requires bias');
    let in_channels = 1;
    if (config.in_channels !== undefined) {
        in_channels = requirePositiveInt(
            config,
            'in_channels',
            'Invalid NAM model: in_channels must be a positive integer'
        );
    }
    let out_channels = 1;
    if (config.out_channels !== undefined) {
        out_channels = requirePositiveInt(
            config,
            'out_channels',
            'Invalid NAM model: out_channels must be a positive integer'
        );
    }
    if (in_channels !== 1 || out_channels !== 1) {
        throw new Error(
            `Invalid NAM model: multi-channel Linear (${in_channels} -> ${out_channels}) is not supported; Grinder captures are mono`
        );
    }
    if (sample_rate !== null && Math.abs(sample_rate - 48_000) > 1) {
        throw new Error(
            'Unsupported NAM model: Linear capture recorded at a different sample rate than the engine; impulse-response resampling is not supported'
        );
    }
    return receptive_field + (config.bias === true ? 1 : 0);
}

/** Batchnorm variances must be positive: a corrupt file would fold NaN into
 * the network (NAMCore only survives it through ReLU's NaN-swallowing). */
function assertConvNetBatchnormValid(config: UnknownRecord, weights: readonly number[]): void {
    const channels = config.channels as number;
    const dilations = config.dilations as number[];
    let cursor = 0;
    let block_input = 1;
    for (const _dilation of dilations) {
        cursor += block_input * channels * 2; // conv taps (no bias under batchnorm)
        const var_offset = cursor + channels; // mean block, then var block
        for (let index = 0; index < channels; index++) {
            const variance = weights[var_offset + index]! + weights[cursor + 4 * channels]!;
            if (!(variance > 0)) {
                throw new Error('Invalid NAM model: batchnorm running variance must be positive');
            }
        }
        cursor += 4 * channels + 1;
        block_input = channels;
    }
}

/**
 * Validate one parsed `.nam` document completely, or throw with the named
 * reason. Mirrors the native runtime: same version window, same architecture
 * set, same derived weight counts.
 */
export function validateGrinderNamModel(nam_json: unknown, file_name: string): ValidatedNamModel {
    const prefix = `Invalid NAM file: ${file_name}`;
    if (!isRecord(nam_json)) {
        throw new TypeError(`${prefix} did not contain an object payload`);
    }
    const architecture = nam_json.architecture;
    if (typeof architecture !== 'string' || architecture.trim().length === 0) {
        throw new Error(`${prefix} is missing documented architecture/weights data`);
    }
    const architecture_name = architecture.trim();
    if (!SUPPORTED_ARCHITECTURES.includes(architecture as GrinderNeuralArchitecture)) {
        throw new Error(`Unsupported NAM architecture "${architecture}" (supported: WaveNet, LSTM, ConvNet, Linear)`);
    }
    const version = nam_json.version;
    if (version !== undefined) {
        if (typeof version !== 'string') {
            throw new TypeError(
                `Unsupported NAM file version ${JSON.stringify(version)} (supported: 0.5.0 through 0.7.x)`
            );
        }
        verifyVersion(version);
    }
    const config = requireObject(nam_json.config, `${prefix} is missing a valid config object`);
    const raw_weights = nam_json.weights;
    if (!Array.isArray(raw_weights) || raw_weights.length === 0) {
        throw new Error(`${prefix} is missing documented architecture/weights data`);
    }
    const weights: number[] = [];
    for (const entry of raw_weights) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
            throw new TypeError(`Invalid NAM model: weights must all be finite numbers (${file_name})`);
        }
        weights.push(entry);
    }

    rejectKnownArchitectureGaps(architecture, config);

    const sample_rate = rootSampleRate(nam_json);
    const expected_count = architectureWeightCount(architecture, config, sample_rate);
    if (expected_count !== weights.length) {
        throw new Error(
            `Invalid NAM model: architecture expects ${expected_count} weights but the file carries ${weights.length}`
        );
    }
    if (architecture_name === 'ConvNet' && config.batchnorm === true) {
        assertConvNetBatchnormValid(config, weights);
    }

    return {
        architecture: architecture_name as GrinderNeuralArchitecture,
        version: typeof version === 'string' ? version : null,
        sampleRate: sample_rate,
        config,
        weights,
    };
}

/** Variant-level rejections for the supported architectures: NAMCore features
 * this runtime does not implement (parametric conditioning, slimmable
 * channels) are refused by name before any count is derived. */
function rejectKnownArchitectureGaps(architecture: string, config: UnknownRecord): void {
    if (architecture !== 'WaveNet') {
        return;
    }
    if (config.condition_dsp !== undefined && config.condition_dsp !== null) {
        throw new Error('Unsupported NAM model: condition_dsp (parametric) captures are not supported');
    }
    const layers = config.layers;
    if (!Array.isArray(layers)) {
        return;
    }
    for (const layer of layers) {
        if (isRecord(layer) && isRecord(layer.slimmable)) {
            throw new Error('Unsupported NAM model: slimmable (dynamic-channel) captures are not supported');
        }
    }
}

function architectureWeightCount(architecture: string, config: UnknownRecord, sample_rate: number | null): number {
    switch (architecture.trim() as GrinderNeuralArchitecture) {
        case 'WaveNet':
            return waveNetWeightCount(config);
        case 'LSTM':
            return lstmWeightCount(config);
        case 'ConvNet':
            return convNetWeightCount(config);
        case 'Linear':
            return linearWeightCount(config, sample_rate);
        default:
            throw new Error(
                `Unsupported NAM architecture "${architecture}" (supported: WaveNet, LSTM, ConvNet, Linear)`
            );
    }
}
