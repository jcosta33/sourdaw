import { type GrinderNeuralArchitecture } from '../models/GrinderPatch';

/**
 * Complete structural validation for `.nam` model files, mirroring the native
 * runtime (`crates/daw-dsp/src/grinder/nam/`) rejection-for-rejection: the
 * same supported version window, the same architecture set, and the same
 * per-architecture weight-count derivation. A file that survives this
 * validation is guaranteed to construct in the runtime — nothing is ever
 * substituted for an unsupported architecture or an inconsistent model.
 */

type UnknownRecord = Record<string, unknown>;

const SUPPORTED_ARCHITECTURES: readonly GrinderNeuralArchitecture[] = ['WaveNet', 'LSTM', 'ConvNet', 'Linear'];

const EARLIEST_SUPPORTED_VERSION: readonly [number, number] = [0, 5];
const LATEST_SUPPORTED_MAJOR = 0;
const LATEST_SUPPORTED_MINOR = 7;

const ACTIVATION_NAMES: readonly string[] = [
    'Tanh',
    'Hardtanh',
    'Fasttanh',
    'ReLU',
    'LeakyReLU',
    'PReLU',
    'Sigmoid',
    'SiLU',
    'Hardswish',
    'LeakyHardtanh',
    'LeakyHardTanh',
    'Softsign',
];

/** Config keys that would activate FiLM modulation (NAMCore treats a present,
 * non-false key as active by default). */
const FILM_KEYS: readonly string[] = [
    'conv_pre_film',
    'conv_post_film',
    'input_mixin_pre_film',
    'input_mixin_post_film',
    'activation_pre_film',
    'activation_post_film',
    'layer1x1_post_film',
    'head1x1_post_film',
];

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, message: string): UnknownRecord {
    if (!isRecord(value)) {
        throw new TypeError(message);
    }
    return value;
}

function requireNumber(value: UnknownRecord, key: string, message: string): number {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new TypeError(message);
    }
    return raw;
}

function requirePositiveInt(value: UnknownRecord, key: string, message: string): number {
    const raw = requireNumber(value, key, message);
    if (!Number.isInteger(raw) || raw < 1) {
        throw new TypeError(message);
    }
    return raw;
}

function requireBool(value: UnknownRecord, key: string, message: string): boolean {
    const raw = value[key];
    if (typeof raw !== 'boolean') {
        throw new TypeError(message);
    }
    return raw;
}

function requireIntArray(value: UnknownRecord, key: string, message: string): number[] {
    const raw = value[key];
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new TypeError(message);
    }
    return raw.map((entry) => {
        if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1) {
            throw new TypeError(message);
        }
        return entry;
    });
}

function requireKnownActivation(value: UnknownRecord, message: string): void {
    const raw = value.activation;
    const name = isRecord(raw) ? raw.type : raw;
    if (typeof name !== 'string' || !ACTIVATION_NAMES.includes(name)) {
        throw new Error(message);
    }
    // Mirror the runtime's PReLU parse rejection-for-rejection: it resolves
    // the channel slope as `slopes.get(channel).unwrap_or(slopes[0])`, so a
    // slope-less PReLU would panic on the first sample. A bare `"PReLU"`, a
    // non-numeric `negative_slope`, and an absent, empty or non-numeric
    // `negative_slopes` are each refused here exactly as the native parser
    // refuses them, keeping the import guarantee that a validated file
    // constructs in the runtime.
    if (name === 'PReLU') {
        if (!isRecord(raw)) {
            throw new TypeError('Invalid NAM model: PReLU requires negative_slope or negative_slopes');
        }
        if (raw.negative_slope !== undefined) {
            if (typeof raw.negative_slope !== 'number' || !Number.isFinite(raw.negative_slope)) {
                throw new TypeError('Invalid NAM model: PReLU negative_slope must be a number');
            }
        } else if (!Array.isArray(raw.negative_slopes)) {
            throw new TypeError('Invalid NAM model: PReLU requires negative_slope or negative_slopes');
        } else if (raw.negative_slopes.length === 0) {
            throw new Error('Invalid NAM model: PReLU requires at least one negative slope');
        } else {
            for (const slope of raw.negative_slopes) {
                if (typeof slope !== 'number' || !Number.isFinite(slope)) {
                    throw new TypeError('Invalid NAM model: PReLU slopes must be numbers');
                }
            }
        }
    }
}

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

function rejectUnsupportedWaveNetFeatures(layer: UnknownRecord): void {
    for (const key of ['groups_input', 'groups_input_mixin'] as const) {
        const groups = layer[key];
        if (groups !== undefined && groups !== 1) {
            throw new Error(
                `Unsupported NAM model: grouped WaveNet convolutions (${key} = ${JSON.stringify(groups)}) are not supported`
            );
        }
    }
    const layer1x1 = layer.layer1x1;
    if (isRecord(layer1x1) && layer1x1.groups !== undefined && layer1x1.groups !== 1) {
        throw new Error('Unsupported NAM model: grouped layer1x1 convolutions are not supported');
    }
    const head1x1 = layer.head1x1;
    if (isRecord(head1x1) && head1x1.active === true && head1x1.groups !== undefined && head1x1.groups !== 1) {
        throw new Error('Unsupported NAM model: grouped head1x1 convolutions are not supported');
    }
    for (const key of FILM_KEYS) {
        const film = layer[key];
        // A non-object value (typically `false`) leaves FiLM inactive —
        // NAMCore's convention for opting out.
        if (isRecord(film) && film.active !== false) {
            throw new Error(`Unsupported NAM model: FiLM modulation ("${key}") is not supported`);
        }
    }
}

/** The array head, normalized across the nested-`head` and legacy shapes. */
type WaveNetArrayHead = {
    head_size: number;
    head_kernel_size: number;
    head_bias: boolean;
};

function readWaveNetArrayHead(layer: UnknownRecord): WaveNetArrayHead {
    const raw_head = layer.head;
    if (isRecord(raw_head)) {
        return {
            head_size: requirePositiveInt(raw_head, 'out_channels', 'Invalid NAM model: head requires out_channels'),
            head_kernel_size: requirePositiveInt(
                raw_head,
                'kernel_size',
                'Invalid NAM model: head requires kernel_size'
            ),
            head_bias: requireBool(raw_head, 'bias', 'Invalid NAM model: head requires bias'),
        };
    }
    return {
        head_size: requirePositiveInt(layer, 'head_size', 'Invalid NAM model: layer array requires head_size'),
        head_kernel_size: 1,
        head_bias: requireBool(layer, 'head_bias', 'Invalid NAM model: layer array requires head_bias'),
    };
}

/** Kernel sizes: either one `kernel_size` for every layer, or a per-layer
 * `kernel_sizes` array matching the dilation list (NAMCore supports both). */
function readWaveNetKernelSizes(layer: UnknownRecord, dilations: readonly number[]): number[] {
    const raw_kernel_sizes = layer.kernel_sizes;
    if (raw_kernel_sizes === undefined) {
        const kernel_size = requirePositiveInt(
            layer,
            'kernel_size',
            'Invalid NAM model: layer array requires kernel_size'
        );
        return dilations.map(() => kernel_size);
    }
    if (!Array.isArray(raw_kernel_sizes) || raw_kernel_sizes.length !== dilations.length) {
        throw new Error('Invalid NAM model: kernel_sizes must match dilations length');
    }
    return raw_kernel_sizes.map((entry) => {
        if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1) {
            throw new TypeError('Invalid NAM model: kernel_sizes must be positive integers');
        }
        return entry;
    });
}

/** Gating resolution with NAMCore's precedence: an explicit `gating_mode`
 * wins, then the legacy `gated` boolean, else none. */
function readWaveNetGating(layer: UnknownRecord, bottleneck: number): number {
    const gating_mode = layer.gating_mode;
    if (gating_mode !== undefined && gating_mode !== 'gated' && gating_mode !== 'blended' && gating_mode !== 'none') {
        throw new Error(`Invalid NAM model: unknown gating_mode ${JSON.stringify(gating_mode)}`);
    }
    const is_gated = layer.gated === true || gating_mode === 'gated' || gating_mode === 'blended';
    if (!is_gated) {
        return bottleneck;
    }
    return 2 * bottleneck;
}

function waveNetArrayWeightCount(layer: UnknownRecord): number {
    const input_size = requirePositiveInt(layer, 'input_size', 'Invalid NAM model: layer array requires input_size');
    const condition_size = requirePositiveInt(
        layer,
        'condition_size',
        'Invalid NAM model: layer array requires condition_size'
    );
    if (condition_size !== 1) {
        throw new Error('Invalid NAM model: condition_size must be 1 for non-parametric captures');
    }
    const channels = requirePositiveInt(layer, 'channels', 'Invalid NAM model: layer array requires channels');
    const dilations = requireIntArray(layer, 'dilations', 'Invalid NAM model: layer array requires dilations');
    const head = readWaveNetArrayHead(layer);
    const kernel_sizes = readWaveNetKernelSizes(layer, dilations);

    let bottleneck = channels;
    if (layer.bottleneck !== undefined) {
        bottleneck = requirePositiveInt(
            layer,
            'bottleneck',
            'Invalid NAM model: bottleneck must be a positive integer'
        );
    }
    const out2 = readWaveNetGating(layer, bottleneck);

    const layer1x1 = layer.layer1x1;
    const layer1x1_active = !isRecord(layer1x1) || layer1x1.active !== false;
    if (!layer1x1_active && bottleneck !== channels) {
        throw new Error('Invalid NAM model: layer1x1 inactive requires bottleneck == channels');
    }
    const head1x1 = layer.head1x1;
    const head1x1_active = isRecord(head1x1) && head1x1.active === true;
    let head1x1_out: number | null = null;
    if (head1x1_active) {
        head1x1_out = requirePositiveInt(head1x1, 'out_channels', 'Invalid NAM model: head1x1 requires out_channels');
    }

    requireKnownActivation(layer, 'Invalid NAM model: layer array requires a known activation');

    let count = input_size * channels; // rechannel, no bias
    for (let index = 0; index < dilations.length; index++) {
        count += channels * out2 * kernel_sizes[index]! + out2; // dilated conv, bias
        count += condition_size * out2; // input mixin, no bias
        if (layer1x1_active) {
            count += bottleneck * channels + channels; // layer1x1, bias
        }
        if (head1x1_out !== null) {
            count += bottleneck * head1x1_out + head1x1_out; // head1x1, bias
        }
    }
    const head_input_size = head1x1_out ?? bottleneck;
    count += head_input_size * head.head_size * head.head_kernel_size + (head.head_bias ? head.head_size : 0);
    return count;
}

/** The size the array's head accumulation produces: head1x1 out, else the
 * layer bottleneck (which defaults to channels). */
function waveNetArrayHeadOutputSize(layer: UnknownRecord): number {
    const head1x1 = layer.head1x1;
    if (isRecord(head1x1) && head1x1.active === true) {
        return requirePositiveInt(head1x1, 'out_channels', 'Invalid NAM model: head1x1 requires out_channels');
    }
    const channels = requirePositiveInt(layer, 'channels', 'Invalid NAM model: layer array requires channels');
    if (layer.bottleneck === undefined) {
        return channels;
    }
    return requirePositiveInt(layer, 'bottleneck', 'Invalid NAM model: bottleneck must be a positive integer');
}

function waveNetWeightCount(config: UnknownRecord): number {
    const layers = config.layers;
    if (!Array.isArray(layers) || layers.length === 0) {
        throw new Error('Invalid NAM model: WaveNet config requires a non-empty layers array');
    }
    for (let index = 0; index < layers.length; index++) {
        const layer = requireObject(layers[index], 'Invalid NAM model: layer arrays must be objects');
        rejectUnsupportedWaveNetFeatures(layer);
        if (index > 0) {
            const previous = requireObject(layers[index - 1], 'Invalid NAM model: layer arrays must be objects');
            if (layer.input_size !== previous.channels) {
                throw new Error(
                    `Invalid NAM model: layer array ${index}: input_size must equal the preceding array's channels`
                );
            }
            if (layer.channels !== readWaveNetArrayHead(previous).head_size) {
                throw new Error(
                    `Invalid NAM model: layer array ${index}: channels must equal the preceding array's head_size`
                );
            }
            if (waveNetArrayHeadOutputSize(layer) !== readWaveNetArrayHead(previous).head_size) {
                throw new Error(
                    `Invalid NAM model: layer array ${index}: head input size must equal the preceding array's head_size`
                );
            }
        }
    }

    let count = 0;
    let last_head_size = 1;
    for (const layer of layers) {
        const layer_record = requireObject(layer, 'Invalid NAM model: layer arrays must be objects');
        count += waveNetArrayWeightCount(layer_record);
        last_head_size = readWaveNetArrayHead(layer_record).head_size;
    }

    if (typeof config.head_scale !== 'number' || !Number.isFinite(config.head_scale)) {
        throw new TypeError('Invalid NAM model: WaveNet config requires head_scale');
    }
    // Post-stack head convolutions, then the single trailing head-scale weight.
    const raw_head = config.head;
    if (raw_head !== undefined && raw_head !== null) {
        const head = requireObject(raw_head, 'Invalid NAM model: head must be an object');
        const channels = requirePositiveInt(head, 'channels', 'Invalid NAM model: head requires channels');
        const out_channels = requirePositiveInt(head, 'out_channels', 'Invalid NAM model: head requires out_channels');
        const kernel_sizes = requireIntArray(head, 'kernel_sizes', 'Invalid NAM model: head requires kernel_sizes');
        requireKnownActivation(head, 'Invalid NAM model: head requires a known activation');
        let cin = last_head_size;
        for (let index = 0; index < kernel_sizes.length; index++) {
            const cout = index + 1 === kernel_sizes.length ? out_channels : channels;
            count += cin * cout * kernel_sizes[index]! + cout;
            cin = cout;
        }
    }
    return count + 1;
}

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
