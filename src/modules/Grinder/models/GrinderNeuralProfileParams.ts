import { type GrinderNeuralProfile, type GrinderNeuralTier } from './GrinderPatch';

// Mirrors the worklet's own table (`grinderProcessor.ts` `NEURAL_TIER_INDEX`
// and `INDEXED_VALUES.neuralTier`).
const NEURAL_TIER_INDEX: Readonly<Record<GrinderNeuralTier, number>> = {
    standard: 0,
    lite: 1,
    nano: 2,
    recurrent: 3,
};

export type GrinderNeuralProfileParam = readonly [name: string, value: number];

function convWeightParams(convWeights: GrinderNeuralProfile['convWeights']): GrinderNeuralProfileParam[] {
    return convWeights.flatMap((weights, layer) =>
        weights.map((weight, index): GrinderNeuralProfileParam => [`neuralCustomConvWeight${layer}_${index}`, weight])
    );
}

/**
 * The `NeuralCapture::set_param` names the worklet's `applyNeuralPatch`
 * writes from its structured patch message. The numeric door carries the
 * same profile to whichever host is live and into the persisted record the
 * native body is built from.
 */
export function grinderNeuralProfileParams(profile: GrinderNeuralProfile): GrinderNeuralProfileParam[] {
    return [
        ['neuralCustomTier', NEURAL_TIER_INDEX[profile.preferredTier]],
        ['neuralCustomInputDrive', profile.inputDrive],
        ['neuralCustomAsymmetry', profile.asymmetry],
        ['neuralCustomOutputTrim', profile.outputTrim],
        ['neuralCustomContourMix', profile.contourMix],
        ['neuralCustomLstmBias', profile.recurrentBias],
        ...convWeightParams(profile.convWeights),
    ];
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
 * rather than a profile to fabricate defaults for. The provenance fields
 * (`sourceArchitecture`, `sourceSampleRate`, `sourceWeightCount`) do not
 * travel the numeric door, so a record-derived profile carries placeholders;
 * resolving the profile against the neural library (`grinderNeuralProfilesEqual`)
 * restores the full entry profile when the capture is still imported.
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
    };
}

/**
 * Whether two profiles carry the same audible identity — the fields the
 * numeric record preserves. The provenance fields are deliberately excluded:
 * a record-derived profile cannot carry them, so an entry matches on what the
 * record can prove, and a match adopts the entry's full profile.
 */
export function grinderNeuralProfilesEqual(left: GrinderNeuralProfile, right: GrinderNeuralProfile): boolean {
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
 * folded from the audible identity alone, so the same profile reconstructs to
 * the same id on every reload. One FNV-1a stream over a length-prefixed
 * canonical form — this id only names the model a patch carries for display,
 * never keys a library upsert, so the four-stream collision armor the NAM
 * importer needs is not spent here.
 */
export function derivedGrinderNeuralModelId(profile: GrinderNeuralProfile): string {
    const canonical = [
        profile.preferredTier,
        profile.inputDrive,
        profile.asymmetry,
        profile.outputTrim,
        profile.contourMix,
        profile.recurrentBias,
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
