export type ModulationSourceType = 'lfo' | 'envelope' | 'midi-cc' | 'macro' | 'random' | 'step-seq';

export type ModulationSource = {
    id: string;
    type: ModulationSourceType;
    name: string;
    /** LFO rate in Hz, envelope times, CC number, etc. */
    parameters: Record<string, number>;
};

export type ModulationTarget = {
    deviceId: string;
    parameterName: string;
};

export type ModulationRoute = {
    id: string;
    sourceId: string;
    target: ModulationTarget;
    amount: number; // -1 to +1
    bipolar: boolean;
};

/** Default parameters per modulation source type */
export const DEFAULT_MOD_PARAMS: Record<ModulationSourceType, Record<string, number>> = {
    lfo: { rate: 1, depth: 1, phase: 0, waveform: 0 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
    'midi-cc': { cc: 1, channel: 0 },
    macro: { value: 0.5 },
    random: { rate: 4, smoothing: 0.5 },
    'step-seq': { steps: 8, rate: 1 },
};
