const GRINDER_SCALARS = [
    'gain',
    'bass',
    'mid',
    'treble',
    'presence',
    'resonance',
    'master',
    'inputGain',
    'outputGain',
    'transformerDrive',
    'negFeedback',
    'inputImpedance',
    'inputMode',
    'gateEnabled',
    'gateThreshold',
    'gateAttack',
    'gateRelease',
    'channel',
    'bright',
    'fat',
    'tubeBias',
    'tubeAge',
    'millerCapacitance',
    'gridConduction',
    'couplingCapCharge',
    'ampModel',
    'toneStackType',
    'brightCap',
    'powerTubeType',
    'rectifierType',
    'sagAmount',
    'sagRecovery',
    'powerAmpBias',
    'transformerHysteresis',
    'transformerLfSaturation',
    'cabType',
    'routingMode',
    'cabIrSlot',
    'cabEnabled',
    'micBlend',
    'roomAmount',
    'cabResonanceFreq',
    'cabResonanceQ',
    'cabDamping',
    'cabOpenBack',
    'coneBreakup',
    'backEmf',
    'outputMix',
    'cleanBlend',
    'limiterEnabled',
    'limiterThreshold',
    'bypass',
] as const;

const SOURCE_SENSITIVE = [
    'engineMode',
    'neuralEnabled',
    'neuralPlacement',
    'neuralMix',
    'neuralTier',
    'neuralCpuBudget',
    'neuralModelMode',
    'neuralModelSlot',
    'neuralCustomTier',
    'neuralCustomInputDrive',
    'neuralCustomAsymmetry',
    'neuralCustomOutputTrim',
    'neuralCustomContourMix',
    'neuralCustomLstmBias',
] as const;

const PEDAL_SUFFIXES = {
    Compressor: ['Enabled', 'Threshold', 'Ratio', 'Attack', 'Release', 'Order'],
    Overdrive: ['Enabled', 'Drive', 'Tone', 'Level', 'Order'],
    Distortion: ['Enabled', 'Drive', 'Tone', 'Level', 'Order'],
    Fuzz: ['Enabled', 'Fuzz', 'Tone', 'Level', 'Order'],
} as const;

export const GRINDER_LIVE_PARAMETER_IDS: readonly string[] = [
    ...GRINDER_SCALARS,
    ...(['pre', 'post'] as const).flatMap((position) =>
        Object.entries(PEDAL_SUFFIXES).flatMap(([pedal, suffixes]) =>
            suffixes.map((suffix) => `${position}${pedal}${suffix}`)
        )
    ),
    ...([1, 2] as const).flatMap((mic) =>
        ['Enabled', 'PositionX', 'PositionY', 'Distance', 'Gain'].map((suffix) => `mic${mic}${suffix}`)
    ),
];

const SOURCE_PARAMETER_IDS: readonly string[] = [
    ...SOURCE_SENSITIVE,
    ...Array.from({ length: 10 }, (_, layer) =>
        Array.from({ length: 3 }, (_, index) => `neuralCustomConvWeight${layer}_${index}`)
    ).flat(),
];

const GRINDER_LIVE_SET = new Set(GRINDER_LIVE_PARAMETER_IDS);
export function isGrinderLiveParameter(id: string): boolean {
    return GRINDER_LIVE_SET.has(id);
}

const GRINDER_PARAMETER_IDS = new Set([...GRINDER_LIVE_PARAMETER_IDS, ...SOURCE_PARAMETER_IDS]);
export const GRINDER_PARAMETER_COUNT = GRINDER_PARAMETER_IDS.size;
export function isGrinderRuntimeParameter(id: string): boolean {
    return GRINDER_PARAMETER_IDS.has(id);
}
