import {
    type GrinderImportedNeuralModel,
    type GrinderNeuralProfile,
    type GrinderNeuralTier,
} from '../models/GrinderPatch';

type ParseGrinderNamFileInput = {
    file_name: string;
    file_text: string;
};

type NamJson = {
    version?: unknown;
    architecture?: unknown;
    config?: unknown;
    metadata?: unknown;
    weights?: unknown;
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
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function hash_string(value: string): string {
    let hash = 5381;
    for (let index = 0; index < value.length; index++) {
        hash = (hash * 33) ^ value.charCodeAt(index);
    }
    return Math.abs(hash >>> 0).toString(36);
}

function get_string(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function get_finite_number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collect_weights(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const flattened: number[] = [];
    const queue: unknown[] = [...value];
    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            queue.unshift(...current);
            continue;
        }
        const numeric = get_finite_number(current);
        if (numeric !== null) {
            flattened.push(numeric);
        }
    }

    return flattened;
}

function sample_normalized_weights(weights: readonly number[], count: number): number[] {
    if (weights.length === 0) {
        return Array.from({ length: count }, () => 0);
    }

    const max_abs = weights.reduce((running, value) => Math.max(running, Math.abs(value)), 0.000_001);
    return Array.from({ length: count }, (_, index) => {
        const source_index = Math.min(
            weights.length - 1,
            Math.floor((index / Math.max(1, count - 1)) * (weights.length - 1))
        );
        return clamp(weights[source_index]! / max_abs, -1, 1);
    });
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

function derive_profile(input: {
    architecture: string;
    sample_rate: number;
    tone_type: string;
    weights: readonly number[];
}): GrinderNeuralProfile {
    const normalized = sample_normalized_weights(input.weights, 30);
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

    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Invalid NAM file: ${input.file_name} did not contain an object payload`);
    }

    const nam_json = parsed as NamJson;
    const architecture = get_string(nam_json.architecture);
    const version = get_string(nam_json.version);
    const weights = collect_weights(nam_json.weights);
    if (!architecture || !version || weights.length === 0) {
        throw new Error(`Invalid NAM file: ${input.file_name} is missing documented architecture/version/weights data`);
    }

    const metadata = (
        nam_json.metadata && typeof nam_json.metadata === 'object' ? nam_json.metadata : {}
    ) as NamMetadata;
    const config =
        nam_json.config && typeof nam_json.config === 'object' ? (nam_json.config as Record<string, unknown>) : {};
    const sample_rate = get_finite_number(metadata.sample_rate) ?? get_finite_number(config.sample_rate) ?? 48_000;
    const display_name = get_string(metadata.name) ?? input.file_name.replace(/\.(nam|json)$/i, '');
    const tone_type = get_string(metadata.tone_type) ?? 'capture';
    const modeled_by = get_string(metadata.modeled_by);
    const description = modeled_by
        ? `Imported from ${input.file_name} • modeled by ${modeled_by}`
        : `Imported from ${input.file_name}`;
    const profile = derive_profile({
        architecture,
        sample_rate,
        tone_type,
        weights,
    });

    return {
        id: `imported-${slugify(display_name || input.file_name)}-${hash_string(input.file_text)}`,
        source: 'imported',
        name: display_name,
        family: `NAM import • ${architecture}`,
        placement: derive_placement(`${tone_type} ${description}`),
        description,
        importedAt: Date.now(),
        sourceFileName: input.file_name,
        sourceFileText: input.file_text,
        profile,
    };
}
