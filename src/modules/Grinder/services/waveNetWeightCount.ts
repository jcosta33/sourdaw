import {
    isRecord,
    readOptionalBool,
    requireBool,
    requireIntArray,
    requireKnownActivation,
    requireObject,
    requirePositiveInt,
    type UnknownRecord,
} from './namConfigReaders';

/**
 * WaveNet weight-count derivation and shape admission, rule for rule with the
 * admission plan native admission and the WASM parser share
 * (`crates/daw-dsp/src/grinder/nam/admission_plan.rs`): a shape either
 * constructs and renders in both runtimes or is refused here by name.
 */

function rejectUnsupportedWaveNetFeatures(layer: UnknownRecord): void {
    for (const key of ['groups_input', 'groups_input_mixin'] as const) {
        const groups = layer[key];
        if (groups !== undefined && groups !== 1) {
            throw new Error(
                `Unsupported NAM model: grouped WaveNet convolutions (${key} = ${JSON.stringify(groups)}) are not supported`
            );
        }
    }
    // Native admission reads a 1x1's groups whether or not the 1x1 is active.
    for (const key of ['layer1x1', 'head1x1'] as const) {
        const sub_config = layer[key];
        if (isRecord(sub_config) && sub_config.groups !== undefined && sub_config.groups !== 1) {
            throw new Error(`Unsupported NAM model: grouped ${key} convolutions are not supported`);
        }
    }
    // Any key naming FiLM is active unless it is `false` or an object whose
    // `active` is `false`, as native admission and the runtime read it.
    for (const [key, film] of Object.entries(layer)) {
        const inactive = film === false || (isRecord(film) && film.active === false);
        if (key.includes('film') && !inactive) {
            throw new Error(`Unsupported NAM model: FiLM modulation ("${key}") is not supported`);
        }
    }
}

/** A nested 1x1 config (`layer1x1`, `head1x1`); any non-object reads as an
 * empty one, as native admission reads it. */
function readSubConfig(layer: UnknownRecord, key: string): UnknownRecord {
    const sub_config = layer[key];
    return isRecord(sub_config) ? sub_config : {};
}

/** The array head, normalized across the nested-`head` and legacy shapes. */
type WaveNetArrayHead = {
    head_size: number;
    head_kernel_size: number;
    head_bias: boolean;
};

function readWaveNetArrayHead(layer: UnknownRecord): WaveNetArrayHead {
    const raw_head = layer.head;
    if (raw_head !== undefined && raw_head !== null) {
        if (!isRecord(raw_head)) {
            throw new TypeError('Invalid NAM model: layer array head must be an object');
        }
        if (raw_head.head_dilation !== undefined) {
            requirePositiveInt(
                raw_head,
                'head_dilation',
                'Invalid NAM model: head_dilation must be a positive integer'
            );
        }
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

/** The head width the next array's channels must match: the legacy
 * `head_size` key, else the nested head's `out_channels`, as native admission
 * and the WASM parser resolve it. */
function waveNetChainedHeadSize(layer: UnknownRecord): number {
    if (layer.head_size === undefined) {
        return readWaveNetArrayHead(layer).head_size;
    }
    return requirePositiveInt(layer, 'head_size', 'Invalid NAM model: head_size must be a positive integer');
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

/** Whether the array gates, with NAMCore's precedence: a `gating_mode`
 * string decides, and only without one does the legacy `gated` flag. */
function readWaveNetGated(layer: UnknownRecord): boolean {
    const gating_mode = layer.gating_mode;
    if (typeof gating_mode !== 'string') {
        return readOptionalBool(layer, 'gated', false, 'Invalid NAM model: gated must be a boolean');
    }
    if (gating_mode !== 'gated' && gating_mode !== 'blended' && gating_mode !== 'none') {
        throw new Error(`Invalid NAM model: unknown gating_mode ${JSON.stringify(gating_mode)}`);
    }
    return gating_mode !== 'none';
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
    // The runtime requires head_bias on every array, even one whose nested
    // head carries its own bias.
    requireBool(layer, 'head_bias', 'Invalid NAM model: layer array requires head_bias');
    const kernel_sizes = readWaveNetKernelSizes(layer, dilations);

    let bottleneck = channels;
    if (layer.bottleneck !== undefined) {
        bottleneck = requirePositiveInt(
            layer,
            'bottleneck',
            'Invalid NAM model: bottleneck must be a positive integer'
        );
    }
    const gated = readWaveNetGated(layer);
    const out2 = gated ? 2 * bottleneck : bottleneck;

    const layer1x1_active = readOptionalBool(
        readSubConfig(layer, 'layer1x1'),
        'active',
        true,
        'Invalid NAM model: layer1x1 active must be a boolean'
    );
    if (!layer1x1_active && bottleneck !== channels) {
        throw new Error('Invalid NAM model: layer1x1 inactive requires bottleneck == channels');
    }
    const head1x1 = readSubConfig(layer, 'head1x1');
    let head1x1_out: number | null = null;
    if (readOptionalBool(head1x1, 'active', false, 'Invalid NAM model: head1x1 active must be a boolean')) {
        head1x1_out = requirePositiveInt(head1x1, 'out_channels', 'Invalid NAM model: head1x1 requires out_channels');
    }

    requireKnownActivation(layer, 'Invalid NAM model: layer array requires a known activation');
    if (gated && layer.secondary_activation !== undefined) {
        requireKnownActivation(
            { activation: layer.secondary_activation },
            'Invalid NAM model: layer array requires a known secondary_activation'
        );
    }

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
    const head1x1 = readSubConfig(layer, 'head1x1');
    if (head1x1.active === true) {
        return requirePositiveInt(head1x1, 'out_channels', 'Invalid NAM model: head1x1 requires out_channels');
    }
    const channels = requirePositiveInt(layer, 'channels', 'Invalid NAM model: layer array requires channels');
    if (layer.bottleneck === undefined) {
        return channels;
    }
    return requirePositiveInt(layer, 'bottleneck', 'Invalid NAM model: bottleneck must be a positive integer');
}

/** The runtime carries each array's output into the next through one scratch
 * span sized from the first array's channels, and each array's head into the
 * next through one sized to the widest head. An array that feeds another must
 * keep the first array's channels (only the final array may differ), and every
 * head an array is seeded with must fill its accumulation exactly. Native
 * admission refuses the same shapes. */
function rejectWaveNetScratchWidthChanges(layers: readonly UnknownRecord[]): void {
    const first_channels = layers[0]!.channels;
    for (let index = 1; index < layers.length - 1; index++) {
        if (layers[index]!.channels !== first_channels) {
            throw new Error(
                `Invalid NAM model: layer array ${index}: channels must equal the first array's channels; only the final array may differ`
            );
        }
    }
    const widest_head = Math.max(...layers.map((layer) => readWaveNetArrayHead(layer).head_size));
    for (let index = 1; index < layers.length; index++) {
        const head_input_size = waveNetArrayHeadOutputSize(layers[index]!);
        if (head_input_size !== widest_head) {
            throw new Error(
                `Invalid NAM model: layer array ${index}: head input size (${head_input_size}) must equal the widest array head_size (${widest_head})`
            );
        }
    }
}

/** Grinder captures are mono: a root channel count must be 1, and the first
 * array reads the one-sample input. */
function rejectNonMonoWaveNetInput(config: UnknownRecord, layers: readonly unknown[]): void {
    for (const key of ['in_channels', 'out_channels'] as const) {
        if (config[key] === undefined) {
            continue;
        }
        const channels = requirePositiveInt(config, key, `Invalid NAM model: ${key} must be a positive integer`);
        if (channels !== 1) {
            throw new Error(
                `Invalid NAM model: multi-channel WaveNet (${key} = ${channels}) is not supported; Grinder captures are mono`
            );
        }
    }
    if (requireObject(layers[0], 'Invalid NAM model: layer arrays must be objects').input_size !== 1) {
        throw new Error('Invalid NAM model: layer array 0: input_size must be 1 (the mono input)');
    }
}

/** The post-stack head's weights. It must end in one channel; without it the
 * last array's head is the output, so that head must be mono, since only its
 * first channel would ever be played. */
function waveNetOutputHeadWeightCount(raw_head: unknown, last_head_size: number): number {
    if (raw_head === undefined || raw_head === null) {
        if (last_head_size !== 1) {
            throw new Error(
                `Invalid NAM model: multi-channel WaveNet output (${last_head_size} channels) is not supported; a last array head_size other than 1 needs a post-stack head`
            );
        }
        return 0;
    }
    const head = requireObject(raw_head, 'Invalid NAM model: head must be an object');
    const channels = requirePositiveInt(head, 'channels', 'Invalid NAM model: head requires channels');
    const out_channels = requirePositiveInt(head, 'out_channels', 'Invalid NAM model: head requires out_channels');
    if (out_channels !== 1) {
        throw new Error(
            `Invalid NAM model: multi-channel WaveNet output (${out_channels} channels) is not supported; Grinder captures are mono`
        );
    }
    const kernel_sizes = requireIntArray(head, 'kernel_sizes', 'Invalid NAM model: head requires kernel_sizes');
    requireKnownActivation(head, 'Invalid NAM model: head requires a known activation');
    let count = 0;
    let cin = last_head_size;
    for (let index = 0; index < kernel_sizes.length; index++) {
        const cout = index + 1 === kernel_sizes.length ? out_channels : channels;
        count += cin * cout * kernel_sizes[index]! + cout;
        cin = cout;
    }
    return count;
}

export function waveNetWeightCount(config: UnknownRecord): number {
    const layers = config.layers;
    if (!Array.isArray(layers) || layers.length === 0) {
        throw new Error('Invalid NAM model: WaveNet config requires a non-empty layers array');
    }
    rejectNonMonoWaveNetInput(config, layers);
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
            if (layer.channels !== waveNetChainedHeadSize(previous)) {
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
    rejectWaveNetScratchWidthChanges(
        layers.map((layer: unknown) => requireObject(layer, 'Invalid NAM model: layer arrays must be objects'))
    );

    let count = 0;
    let last_head_size = 1;
    for (const layer of layers) {
        const layer_record = requireObject(layer, 'Invalid NAM model: layer arrays must be objects');
        count += waveNetArrayWeightCount(layer_record);
        last_head_size = readWaveNetArrayHead(layer_record).head_size;
    }

    // Post-stack head convolutions, then the single trailing head-scale weight.
    // The runtimes take the scale from that weight and never read
    // config.head_scale, so it is not required here either.
    return count + waveNetOutputHeadWeightCount(config.head, last_head_size) + 1;
}
