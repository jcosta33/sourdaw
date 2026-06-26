export type ModulatorKind = 'lfo' | 'envelope' | 'step';

export type LfoWaveform = 'sine' | 'square' | 'saw' | 'triangle' | 'random';

export type LfoModulator = {
    kind: 'lfo';
    waveform: LfoWaveform;
    rate: number; // beats
    sync: boolean;
    phase: number;
    depth: number;
};

export type EnvelopeModulator = {
    kind: 'envelope';
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    triggerMode: 'midi' | 'audio' | 'sync';
};

export type StepModulator = {
    kind: 'step';
    steps: number[];
    rate: number;
    smooth: number;
};

export type ModulatorMapping = {
    targetTrackId: string;
    targetDeviceId: string;
    targetParamId: string;
    amount: number; // -1 to 1
};

export type Modulator = {
    id: string;
    name: string;
    trackId: string; // Modulators are owned by a track
    kind: ModulatorKind;
    config: LfoModulator | EnvelopeModulator | StepModulator;
    mappings: ModulatorMapping[];
    enabled: boolean;
};
