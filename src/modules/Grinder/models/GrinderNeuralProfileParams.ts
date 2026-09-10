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
