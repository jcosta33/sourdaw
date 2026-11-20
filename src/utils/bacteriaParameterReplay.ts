export const BACTERIA_MAX_BANDS = 6;

export const BACTERIA_BAND_PARAMETER_IDS = [
    'enabled',
    'solo',
    'mute',
    'gain',
    'oversampling',
    'distortionEnabled',
    'filterEnabled',
    'granularEnabled',
    'spectralEnabled',
    'modulationEnabled',
    'convolutionEnabled',
    'freqShiftEnabled',
    'chorusEnabled',
    'phaserEnabled',
    'lofiEnabled',
    'distortionMode',
    'drive',
    'asymmetry',
    'foldbackThreshold',
    'bitDepth',
    'sampleRateReduce',
    'tubeBias',
    'breakdownDepth',
    'filterMode',
    'filterCutoff',
    'filterResonance',
    'filterEnvAmount',
    'filterEnvAttack',
    'filterEnvRelease',
    'chorusRate',
    'chorusDepth',
    'chorusFeedback',
    'chorusMix',
    'phaserRate',
    'phaserDepth',
    'phaserFeedback',
    'phaserMix',
    'grainSize',
    'grainDensity',
    'grainPosOffset',
    'grainPitch',
    'grainWindow',
    'grainFreeze',
    'grainMix',
    'spectralBlur',
    'spectralFreeze',
    'spectralMix',
    'freqShiftHz',
    'freqShiftMix',
    'lofiAmount',
    'codecArtifact',
    'convolutionIr',
    'convolutionMix',
    'convolutionSeparation',
    'routingMode',
] as const;

function resolveBandBroadcasts(replay: Map<string, number>): void {
    for (const parameterId of BACTERIA_BAND_PARAMETER_IDS) {
        const value = replay.get(parameterId);
        if (value === undefined || !Number.isFinite(value)) {
            continue;
        }
        const bandIds = Array.from({ length: BACTERIA_MAX_BANDS }, (_value, band) => `band${band}_${parameterId}`);
        if (!bandIds.some((bandId) => replay.has(bandId))) {
            continue;
        }

        replay.delete(parameterId);
        for (const bandId of bandIds) {
            if (!replay.has(bandId)) {
                replay.set(bandId, value);
            }
        }
    }
}

function protectActiveCrossovers(replay: Map<string, number>): void {
    const bandCount = replay.get('bandCount');
    if (bandCount === undefined || !Number.isFinite(bandCount)) {
        return;
    }

    const activeBandCount = Math.trunc(bandCount);
    let lastActiveFrequency = Number.NEGATIVE_INFINITY;
    for (let corner = 1; corner < BACTERIA_MAX_BANDS; corner++) {
        const parameterId = `crossoverFreq${corner}`;
        const frequency = replay.get(parameterId);
        if (frequency === undefined || !Number.isFinite(frequency)) {
            continue;
        }

        // Reinsert by corner index to match native replay. The engine yields
        // neighboring corners to the latest write, including dormant corners.
        replay.delete(parameterId);
        if (corner < activeBandCount) {
            lastActiveFrequency = frequency;
            replay.set(parameterId, frequency);
        } else {
            replay.set(parameterId, Math.max(frequency, lastActiveFrequency));
        }
    }
}

/** Project saved values onto both carriers, whose write order may differ. */
export function projectBacteriaParameters(parameterValues: Readonly<Record<string, number>>): Record<string, number> {
    const replay = new Map(Object.entries(parameterValues));
    // Replace a colliding broadcast with direct writes so an explicit band
    // override wins even when native replay sorts the record's names.
    resolveBandBroadcasts(replay);
    protectActiveCrossovers(replay);
    return Object.fromEntries(replay);
}
