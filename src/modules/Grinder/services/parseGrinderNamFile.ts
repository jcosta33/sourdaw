import { grinderNeuralModelDigest } from '../models/GrinderNeuralProfileParams';
import {
    type GrinderImportedNeuralModel,
    type GrinderNeuralProfile,
    type GrinderNeuralTier,
} from '../models/GrinderPatch';

import { rootSampleRate, validateGrinderNamModel } from './validateGrinderNamModel';

type ParseGrinderNamFileInput = {
    file_name: string;
    file_text: string;
};

type NamMetadata = {
    name?: unknown;
    modeled_by?: unknown;
    tone_type?: unknown;
    sample_rate?: unknown;
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-+|-+$/g, '')
        .slice(0, 48);
}

// Deterministic content hash with a collision-safe width. A single 32-bit
// accumulator (the previous djb2) leaves only ~2^32 distinct ids, so two
// different NAM files can collide and the Map-keyed library upsert silently
// overwrites the first import. We instead fold four independent FNV-1a streams
// (seeded differently) plus the content length into a 128-bit value rendered as
// fixed-width base36. Same text always yields the same id (so re-importing one
// file stays idempotent), while distinct text is astronomically unlikely to
// collide.
const FNV_PRIME = 0x0100_0193;
const FNV_OFFSETS = [0x811c_9dc5, 0x1000_0193, 0x7fff_ffff, 0x2545_f491] as const;

function fnv1a_stream(value: string, offset: number): number {
    let hash = offset >>> 0;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

function to_base36_fixed(word: number, width: number): string {
    return word.toString(36).padStart(width, '0').slice(-width);
}

function hash_string(value: string): string {
    // Length-prefix guards against collisions between texts that only differ in
    // trailing/leading content the per-stream mixing might otherwise align.
    const seeded = `${value.length}:${value}`;
    return FNV_OFFSETS.map((offset) => to_base36_fixed(fnv1a_stream(seeded, offset), 7)).join('');
}

function get_string(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function get_finite_number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function derive_preferred_tier(architecture: string, weight_count: number): GrinderNeuralTier {
    const architecture_lower = architecture.toLowerCase();
    if (architecture_lower.includes('lstm') || architecture_lower.includes('recurrent')) {
        return 'recurrent';
    }
    if (weight_count < 256) {
        return 'nano';
    }
    if (weight_count < 1024) {
        return 'lite';
    }
    return 'standard';
}

function derive_placement(description: string): 'amp-capture' | 'rig-capture' {
    const lowered = description.toLowerCase();
    return lowered.includes('cab') || lowered.includes('rig') || lowered.includes('room')
        ? 'rig-capture'
        : 'amp-capture';
}

/**
 * The display/telemetry scalars stay derived from the weights (they feed the
 * tier picker and the legacy numeric record), but the runtime no longer uses
 * them as a substitute: `model` carries the complete validated network the
 * native runtime executes directly.
 */
function derive_profile(input: {
    architecture: string;
    sample_rate: number;
    tone_type: string;
    weights: readonly number[];
}): Omit<GrinderNeuralProfile, 'model' | 'modelDigest'> {
    const max_abs = input.weights.reduce((running, value) => Math.max(running, Math.abs(value)), 0.000_001);
    const normalized = Array.from({ length: 30 }, (_, index) => {
        const source_index = Math.min(input.weights.length - 1, Math.floor((index / 29) * (input.weights.length - 1)));
        return clamp(input.weights[source_index]! / max_abs, -1, 1);
    });
    const rms = Math.sqrt(input.weights.reduce((sum, value) => sum + value * value, 0) / input.weights.length);
    const signed_mean = input.weights.reduce((sum, value) => sum + value, 0) / input.weights.length;
    const contour_energy =
        normalized.reduce((sum, value, index) => sum + Math.abs(value) * (index % 3 === 1 ? 0.6 : 1.0), 0) /
        normalized.length;
    const tone_bias = input.tone_type.toLowerCase().includes('high') ? 0.05 : 0;
    const conv_weights: Array<[number, number, number]> = [];

    for (let index = 0; index < 10; index++) {
        const left_seed = Math.abs(normalized[index * 3] ?? 0);
        const center_seed = Math.abs(normalized[index * 3 + 1] ?? 0);
        const right_seed = Math.abs(normalized[index * 3 + 2] ?? 0);
        const left = 0.05 + left_seed * 0.18;
        const center = 0.54 + center_seed * 0.22;
        const right = 0.05 + right_seed * 0.18;
        const total = left + center + right;
        const scale = total > 0.98 ? 0.98 / total : 1;
        conv_weights.push([left * scale, center * scale, right * scale]);
    }

    return {
        derivedFrom: 'nam',
        sourceArchitecture: input.architecture,
        sourceSampleRate: input.sample_rate,
        sourceWeightCount: input.weights.length,
        preferredTier: derive_preferred_tier(input.architecture, input.weights.length),
        inputDrive: clamp(0.92 + Math.log10(1 + rms * 24) * 0.34, 0.85, 1.55),
        asymmetry: clamp(Math.tanh(signed_mean * 12) * 0.18, -0.18, 0.18),
        outputTrim: clamp(1 / (1 + rms * 0.16), 0.72, 1.02),
        contourMix: clamp(0.1 + contour_energy * 0.16 + tone_bias, 0.08, 0.32),
        recurrentBias: clamp(signed_mean * 0.24, -0.12, 0.12),
        convWeights: conv_weights,
    };
}

export function parseGrinderNamFile(input: ParseGrinderNamFileInput): GrinderImportedNeuralModel {
    let parsed: unknown;
    try {
        parsed = JSON.parse(input.file_text);
    } catch {
        throw new Error(`Invalid NAM file: ${input.file_name} is not valid JSON`);
    }

    // Complete structural validation, mirroring the native runtime. Throws
    // with a named reason for unsupported architectures/versions or an
    // inconsistent model — nothing is ever substituted.
    const model = validateGrinderNamModel(parsed, input.file_name);

    const record = (parsed ?? {}) as Record<string, unknown>;
    const raw_metadata = typeof record.metadata === 'object' && record.metadata !== null ? record.metadata : {};
    const metadata = raw_metadata as NamMetadata;
    // NAMCore reads the sample rate from the document root; older exports put
    // it in metadata or config.
    const sample_rate =
        model.sampleRate ??
        get_finite_number(metadata.sample_rate) ??
        get_finite_number(model.config.sample_rate) ??
        48_000;
    const display_name = get_string(metadata.name) ?? input.file_name.replace(/\.(nam|json)$/i, '');
    const tone_type = get_string(metadata.tone_type) ?? 'capture';
    const modeled_by = get_string(metadata.modeled_by);
    const description = modeled_by
        ? `Imported from ${input.file_name} • modeled by ${modeled_by}`
        : `Imported from ${input.file_name}`;
    const profile: GrinderNeuralProfile = {
        ...derive_profile({
            architecture: model.architecture,
            sample_rate,
            tone_type,
            weights: model.weights,
        }),
        model: {
            architecture: model.architecture,
            version: model.version,
            sampleRate: rootSampleRate(record),
            config: model.config,
            weights: model.weights,
        },
        modelDigest: grinderNeuralModelDigest({
            architecture: model.architecture,
            version: model.version,
            sampleRate: model.sampleRate,
            config: model.config,
            weights: model.weights,
        }),
    };

    return {
        id: `imported-${slugify(display_name || input.file_name)}-${hash_string(input.file_text)}`,
        source: 'imported',
        name: display_name,
        family: `NAM import • ${model.architecture}`,
        placement: derive_placement(`${tone_type} ${description}`),
        description,
        importedAt: Date.now(),
        sourceFileName: input.file_name,
        sourceFileText: input.file_text,
        profile,
    };
}
