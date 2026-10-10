import { type GrinderNeuralModel, type GrinderNeuralProfile, type GrinderNeuralTier } from './GrinderPatch';

// Mirrors the worklet's own table (`grinderProcessor.ts` `NEURAL_TIER_INDEX`
// and `INDEXED_VALUES.neuralTier`).
const NEURAL_TIER_INDEX: Readonly<Record<GrinderNeuralTier, number>> = {
    standard: 0,
    lite: 1,
    nano: 2,
    recurrent: 3,
};

export type GrinderNeuralProfileParam = readonly [name: string, value: number];

/**
 * A 64-bit identity digest for a validated model: four 16-bit FNV-1a words
 * over a canonical form of architecture, version, sample rate, config and
 * weights. The full weights participate, so two captures that differ in even
 * one weight — the issue's "swapping two nonsampled weights leaves the
 * profile identical" defect — now digest differently.
 */
export function grinderNeuralModelDigest(model: GrinderNeuralModel): string {
    const words: number[] = [];
    for (const weight of model.weights) {
        // Floats need bytes; a fixed six-digit exponential keeps the encoding
        // injective for the finite values model files carry.
        words.push(hashWord(weight.toExponential(6)));
    }
    const canonical = [
        model.architecture,
        model.version ?? '',
        model.sampleRate === null ? '' : String(model.sampleRate),
        canonicalJson(model.config),
        ...words,
    ].join('|');
    const seeds = [0x811c_9dc5, 0x1000_0193, 0x7fff_ffff, 0x2545_f491];
    return seeds
        .map((seed) => {
            let hash = seed >>> 0;
            const seeded = `${canonical.length}:${canonical}`;
            for (let index = 0; index < seeded.length; index++) {
                hash ^= seeded.charCodeAt(index);
                hash = Math.imul(hash, 0x0100_0193) >>> 0;
            }
            return (hash & 0xffff).toString(16).padStart(4, '0');
        })
        .join('-');
}

function hashWord(value: string): number {
    let hash = 0x811c_9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x0100_0193) >>> 0;
    }
    return hash;
}

/** Deterministic JSON with recursively sorted keys, so the same model always
 * digests identically across sessions. */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
            left.localeCompare(right)
        );
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

const DIGEST_PARAM_COUNT = 4;

function digestToParams(digest: string): GrinderNeuralProfileParam[] {
    const words = digest.split('-');
    return words
        .slice(0, DIGEST_PARAM_COUNT)
        .map((word, index) => [`neuralCustomModelDigest${index}`, parseInt(word, 16)]);
}

function digestFromParams(values: Readonly<Record<string, unknown>>): string | null {
    const words: string[] = [];
    for (let index = 0; index < DIGEST_PARAM_COUNT; index += 1) {
        const raw = values[`neuralCustomModelDigest${index}`];
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 0xffff || !Number.isInteger(raw)) {
            return null;
        }
        words.push(raw.toString(16).padStart(4, '0'));
    }
    return words.join('-');
}

function convWeightParams(convWeights: GrinderNeuralProfile['convWeights']): GrinderNeuralProfileParam[] {
    return convWeights.flatMap((weights, layer) =>
        weights.map((weight, index): GrinderNeuralProfileParam => [`neuralCustomConvWeight${layer}_${index}`, weight])
    );
}

/**
 * The `NeuralCapture::set_param` names the worklet's `applyNeuralPatch`
 * writes from its structured patch message. The numeric door carries the
 * same profile to whichever host is live and into the persisted record the
 * native body is built from. A profile carrying a full model additionally
 * emits its digest words, so a project reload can re-match the library entry
 * that holds the model asset.
 */
export function grinderNeuralProfileParams(profile: GrinderNeuralProfile): GrinderNeuralProfileParam[] {
    const params: GrinderNeuralProfileParam[] = [
        ['neuralCustomTier', NEURAL_TIER_INDEX[profile.preferredTier]],
        ['neuralCustomInputDrive', profile.inputDrive],
        ['neuralCustomAsymmetry', profile.asymmetry],
        ['neuralCustomOutputTrim', profile.outputTrim],
        ['neuralCustomContourMix', profile.contourMix],
        ['neuralCustomLstmBias', profile.recurrentBias],
        ...convWeightParams(profile.convWeights),
    ];
    if (profile.modelDigest !== null) {
        params.push(...digestToParams(profile.modelDigest));
    }
    return params;
}

const TIERS_BY_INDEX: readonly GrinderNeuralTier[] = ['standard', 'lite', 'nano', 'recurrent'];

const CONV_WEIGHT_NAME = /^neuralCustomConvWeight(\d+)_(\d+)$/;

const CONV_WEIGHTS_PER_LAYER = 3;

function readFiniteNumber(values: Readonly<Record<string, unknown>>, name: string): number | null {
    const raw = values[name];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

type ProfileScalars = {
    tierIndex: number;
    inputDrive: number;
    asymmetry: number;
    outputTrim: number;
    contourMix: number;
    recurrentBias: number;
};

function readProfileScalars(values: Readonly<Record<string, unknown>>): ProfileScalars | null {
    const tierIndex = readFiniteNumber(values, 'neuralCustomTier');
    if (tierIndex === null) {
        return null;
    }
    const inputDrive = readFiniteNumber(values, 'neuralCustomInputDrive');
    if (inputDrive === null) {
        return null;
    }
    const asymmetry = readFiniteNumber(values, 'neuralCustomAsymmetry');
    if (asymmetry === null) {
        return null;
    }
    const outputTrim = readFiniteNumber(values, 'neuralCustomOutputTrim');
    if (outputTrim === null) {
        return null;
    }
    const contourMix = readFiniteNumber(values, 'neuralCustomContourMix');
    if (contourMix === null) {
        return null;
    }
    const recurrentBias = readFiniteNumber(values, 'neuralCustomLstmBias');
    if (recurrentBias === null) {
        return null;
    }
    return { tierIndex, inputDrive, asymmetry, outputTrim, contourMix, recurrentBias };
}

function collectConvWeights(values: Readonly<Record<string, unknown>>): Array<[number, number, number]> | null {
    const layers = new Map<number, Map<number, number>>();
    for (const [name, raw] of Object.entries(values)) {
        const match = CONV_WEIGHT_NAME.exec(name);
        if (!match || typeof raw !== 'number' || !Number.isFinite(raw)) {
            continue;
        }
        const layer = Number(match[1]);
        const weights = layers.get(layer) ?? new Map<number, number>();
        weights.set(Number(match[2]), raw);
        layers.set(layer, weights);
    }

    const convWeights: Array<[number, number, number]> = [];
    const orderedLayers = [...layers.keys()].sort((left, right) => left - right);
    for (const [expectedLayer, layer] of orderedLayers.entries()) {
        const weights = layers.get(layer);
        // A gap between layer indices, or a layer that is not exactly the
        // triplet the emitter writes, means the record is not one of ours.
        if (layer !== expectedLayer || !weights || weights.size !== CONV_WEIGHTS_PER_LAYER) {
            return null;
        }
        const ordered = [...weights.entries()].sort(([left], [right]) => left - right);
        const [first, second, third] = ordered;
        if (
            ordered.length !== CONV_WEIGHTS_PER_LAYER ||
            first === undefined ||
            second === undefined ||
            third === undefined ||
            first[0] !== 0 ||
            second[0] !== 1 ||
            third[0] !== 2
        ) {
            return null;
        }
        convWeights.push([first[1], second[1], third[1]]);
    }
    return convWeights;
}

/**
 * The inverse of `grinderNeuralProfileParams` over a persisted record: rebuild
 * the profile the numeric `neuralCustom*` keys carry, so a project reload can
 * restore an imported capture the record was written from.
 *
 * Returns null unless every scalar the emitter writes is present and every
 * conv-weight layer is a contiguous zero-based triplet — the emitter always
 * writes exactly that shape, so anything else is a corrupt or foreign record
 * rather than a profile to fabricate defaults for. The full model does not
 * travel the numeric record (it lives in the neural library's entry, which
 * persists the original `.nam` file); a record-derived profile carries the
 * model digest words instead, and resolving the profile against the library
 * (`grinderNeuralProfilesEqual`) restores the full entry profile — model
 * included — when the capture is still imported.
 */
export function grinderNeuralProfileFromParamValues(
    values: Readonly<Record<string, unknown>>
): GrinderNeuralProfile | null {
    const scalars = readProfileScalars(values);
    if (scalars === null) {
        return null;
    }
    const convWeights = collectConvWeights(values);
    if (convWeights === null) {
        return null;
    }
    const modelDigest = digestFromParams(values);

    const tier = TIERS_BY_INDEX[Math.max(0, Math.min(TIERS_BY_INDEX.length - 1, Math.round(scalars.tierIndex)))];
    return {
        derivedFrom: 'nam',
        sourceArchitecture: 'unknown',
        sourceSampleRate: 0,
        sourceWeightCount: 0,
        preferredTier: tier ?? 'standard',
        inputDrive: scalars.inputDrive,
        asymmetry: scalars.asymmetry,
        outputTrim: scalars.outputTrim,
        contourMix: scalars.contourMix,
        recurrentBias: scalars.recurrentBias,
        convWeights,
        model: null,
        modelDigest,
    };
}

/**
 * Whether two profiles carry the same audible identity — the fields the
 * numeric record preserves. When both sides prove a model digest (a parsed
 * profile and a record that carried the digest words), the digest decides:
 * every weight participates, so two different captures can no longer collide
 * the way the sampled scalars once let them. When either side lacks a digest
 * (a legacy record or a legacy library entry), equality falls back to the
 * scalar comparison, which is what those records can prove — and a match
 * adopts the entry's full profile, upgrading old projects to real models.
 */
export function grinderNeuralProfilesEqual(left: GrinderNeuralProfile, right: GrinderNeuralProfile): boolean {
    if (left.modelDigest !== null && right.modelDigest !== null) {
        return left.modelDigest === right.modelDigest;
    }
    return (
        left.preferredTier === right.preferredTier &&
        left.inputDrive === right.inputDrive &&
        left.asymmetry === right.asymmetry &&
        left.outputTrim === right.outputTrim &&
        left.contourMix === right.contourMix &&
        left.recurrentBias === right.recurrentBias &&
        left.convWeights.length === right.convWeights.length &&
        left.convWeights.every((weights, layer) => {
            const other = right.convWeights[layer];
            return (
                other !== undefined &&
                weights.length === other.length &&
                weights.every((value, index) => value === other[index])
            );
        })
    );
}

/**
 * A stable id for a profile the record proves but no library entry claims:
 * folded from the audible identity alone (including the model digest when the
 * record proves one), so the same profile reconstructs to the same id on
 * every reload. One FNV-1a stream over a length-prefixed canonical form —
 * this id only names the model a patch carries for display, never keys a
 * library upsert, so the four-stream collision armor the NAM importer needs
 * is not spent here.
 */
export function derivedGrinderNeuralModelId(profile: GrinderNeuralProfile): string {
    const canonical = [
        profile.preferredTier,
        profile.inputDrive,
        profile.asymmetry,
        profile.outputTrim,
        profile.contourMix,
        profile.recurrentBias,
        profile.modelDigest ?? '',
        ...profile.convWeights.flat(),
    ].join('|');
    const seeded = `${canonical.length}:${canonical}`;
    let hash = 0x811c_9dc5;
    for (let index = 0; index < seeded.length; index++) {
        hash ^= seeded.charCodeAt(index);
        hash = Math.imul(hash, 0x0100_0193) >>> 0;
    }
    return `imported-patch-${hash.toString(36)}`;
}
