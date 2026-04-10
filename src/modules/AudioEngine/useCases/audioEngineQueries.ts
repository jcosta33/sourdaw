import {
    getDrumKitById as getDrumKitByIdFromFactory,
    getDrumKitByIndex as getDrumKitByIndexFromFactory,
} from '#/modules/AudioEngine/models/factoryDrumKits';

export type SynthWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type SynthFilterType = 'lowpass' | 'highpass' | 'bandpass';

export type SynthParams = {
    waveform: SynthWaveform;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    filterCutoff: number;
    filterResonance: number;
    filterType: SynthFilterType;
    filterEnvAmount: number;
    detune: number;
    gain: number;
    osc2Waveform: SynthWaveform;
    osc2Detune: number;
    osc2Mix: number;
    subOscLevel: number;
    noiseLevel: number;
    vibratoRate: number;
    vibratoDepth: number;
    vibratoDelay: number;
    stereoSpread: number;
    filterVelocitySensitivity: number;
};

export type MpeParams = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

export type DrumKitVoice = {
    name: string;
    pitchRange: [number, number];
    params: SynthParams;
};

export type DrumKit = {
    id: string;
    name: string;
    voices: DrumKitVoice[];
};

export const defaultSynthParams: SynthParams = {
    waveform: 'sawtooth',
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5000,
    filterResonance: 1,
    filterType: 'lowpass',
    filterEnvAmount: 0,
    detune: 0,
    gain: 0.3,
    osc2Waveform: 'sawtooth',
    osc2Detune: 0,
    osc2Mix: 0,
    subOscLevel: 0,
    noiseLevel: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    vibratoDelay: 0.3,
    stereoSpread: 0,
    filterVelocitySensitivity: 0,
};

type NativeDrumKit = NonNullable<ReturnType<typeof getDrumKitByIdFromFactory>>;
type NativeDrumKitVoice = NativeDrumKit['voices'][number];

function cloneSynthParams(params: DrumKitVoice['params']): SynthParams {
    return { ...params };
}

function toDrumKitVoice(voice: NativeDrumKitVoice): DrumKitVoice {
    return {
        name: voice.name,
        pitchRange: [voice.pitchRange[0], voice.pitchRange[1]],
        params: cloneSynthParams(voice.params),
    };
}

function toDrumKit(kit: NativeDrumKit | null): DrumKit | null {
    if (!kit) {
        return null;
    }

    return {
        id: kit.id,
        name: kit.name,
        voices: kit.voices.map(toDrumKitVoice),
    };
}

/**
 * Public query contract for AudioEngine synth and drum data.
 */
export function getDrumKitById(id: string): DrumKit | null {
    return toDrumKit(getDrumKitByIdFromFactory(id));
}

export function getDrumKitByIndex(index: number): DrumKit | null {
    return toDrumKit(getDrumKitByIndexFromFactory(index));
}
