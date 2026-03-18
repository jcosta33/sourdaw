/**
 * Model: Factory drum kit preset data.
 * Static kit definitions — no I/O, no logic beyond data access.
 */

import { type SynthParams, defaultSynthParams, type DrumKit, type DrumKitVoice } from '../models/SynthModels';

function voice(name: string, pitch: number, overrides: Partial<SynthParams>): DrumKitVoice {
    return {
        name,
        pitchRange: [pitch, pitch],
        params: { ...defaultSynthParams, ...overrides },
    };
}

const KIT_808: DrumKit = {
    id: 'factory-808',
    name: '808 Kit',
    voices: [
        voice('Kick', 36, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.4,
            sustain: 0,
            release: 0.1,
            filterCutoff: 200,
            filterResonance: 1,
            gain: 0.8,
        }),
        voice('Snare', 38, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.15,
            sustain: 0,
            release: 0.05,
            filterCutoff: 3000,
            filterResonance: 2,
            gain: 0.6,
        }),
        voice('Clap', 40, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.1,
            sustain: 0,
            release: 0.05,
            filterCutoff: 5000,
            filterResonance: 1,
            gain: 0.5,
        }),
        voice('Closed HH', 42, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.05,
            sustain: 0,
            release: 0.02,
            filterCutoff: 8000,
            filterResonance: 5,
            gain: 0.4,
        }),
        voice('Tom Low', 45, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.25,
            sustain: 0,
            release: 0.1,
            filterCutoff: 400,
            filterResonance: 1,
            gain: 0.6,
        }),
        voice('Open HH', 46, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.2,
            sustain: 0,
            release: 0.1,
            filterCutoff: 10000,
            filterResonance: 4,
            gain: 0.4,
        }),
        voice('Tom Mid', 47, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.2,
            sustain: 0,
            release: 0.1,
            filterCutoff: 600,
            filterResonance: 1,
            gain: 0.6,
        }),
        voice('Tom High', 48, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.15,
            sustain: 0,
            release: 0.1,
            filterCutoff: 800,
            filterResonance: 1,
            gain: 0.6,
        }),
    ],
};

const KIT_ANALOG: DrumKit = {
    id: 'factory-analog',
    name: 'Analog Kit',
    voices: [
        voice('Kick', 36, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.5,
            sustain: 0,
            release: 0.15,
            filterCutoff: 150,
            filterResonance: 1,
            gain: 0.9,
        }),
        voice('Snare', 38, {
            waveform: 'triangle',
            attack: 0.001,
            decay: 0.18,
            sustain: 0,
            release: 0.06,
            filterCutoff: 2000,
            filterResonance: 3,
            gain: 0.55,
        }),
        voice('Clap', 40, {
            waveform: 'triangle',
            attack: 0.002,
            decay: 0.12,
            sustain: 0,
            release: 0.04,
            filterCutoff: 4000,
            filterResonance: 2,
            gain: 0.45,
        }),
        voice('Closed HH', 42, {
            waveform: 'sawtooth',
            attack: 0.001,
            decay: 0.04,
            sustain: 0,
            release: 0.02,
            filterCutoff: 7000,
            filterResonance: 3,
            gain: 0.35,
        }),
        voice('Tom Low', 45, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.3,
            sustain: 0,
            release: 0.12,
            filterCutoff: 350,
            filterResonance: 1,
            gain: 0.6,
        }),
        voice('Open HH', 46, {
            waveform: 'sawtooth',
            attack: 0.001,
            decay: 0.25,
            sustain: 0,
            release: 0.12,
            filterCutoff: 9000,
            filterResonance: 3,
            gain: 0.35,
        }),
        voice('Tom Mid', 47, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.22,
            sustain: 0,
            release: 0.1,
            filterCutoff: 500,
            filterResonance: 1,
            gain: 0.6,
        }),
        voice('Tom High', 48, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.18,
            sustain: 0,
            release: 0.08,
            filterCutoff: 700,
            filterResonance: 1,
            gain: 0.6,
        }),
    ],
};

const KIT_ELECTRONIC: DrumKit = {
    id: 'factory-electronic',
    name: 'Electronic Kit',
    voices: [
        voice('Kick', 36, {
            waveform: 'sine',
            attack: 0.001,
            decay: 0.25,
            sustain: 0,
            release: 0.05,
            filterCutoff: 250,
            filterResonance: 4,
            gain: 0.85,
        }),
        voice('Snare', 38, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.08,
            sustain: 0,
            release: 0.03,
            filterCutoff: 4000,
            filterResonance: 6,
            gain: 0.65,
        }),
        voice('Clap', 40, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.06,
            sustain: 0,
            release: 0.02,
            filterCutoff: 6000,
            filterResonance: 5,
            gain: 0.55,
        }),
        voice('Closed HH', 42, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
            filterCutoff: 10000,
            filterResonance: 8,
            gain: 0.4,
        }),
        voice('Tom Low', 45, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.15,
            sustain: 0,
            release: 0.05,
            filterCutoff: 500,
            filterResonance: 4,
            gain: 0.6,
        }),
        voice('Open HH', 46, {
            waveform: 'sawtooth',
            attack: 0.001,
            decay: 0.12,
            sustain: 0,
            release: 0.06,
            filterCutoff: 12000,
            filterResonance: 7,
            gain: 0.4,
        }),
        voice('Tom Mid', 47, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.12,
            sustain: 0,
            release: 0.04,
            filterCutoff: 700,
            filterResonance: 4,
            gain: 0.6,
        }),
        voice('Tom High', 48, {
            waveform: 'square',
            attack: 0.001,
            decay: 0.1,
            sustain: 0,
            release: 0.03,
            filterCutoff: 900,
            filterResonance: 4,
            gain: 0.6,
        }),
    ],
};

const KIT_ACOUSTIC: DrumKit = {
    id: 'factory-acoustic',
    name: 'Acoustic Kit',
    voices: [
        voice('Kick', 36, {
            waveform: 'sine',
            attack: 0.002,
            decay: 0.45,
            sustain: 0.05,
            release: 0.2,
            filterCutoff: 180,
            filterResonance: 0.5,
            gain: 0.75,
        }),
        voice('Snare', 38, {
            waveform: 'triangle',
            attack: 0.001,
            decay: 0.2,
            sustain: 0.03,
            release: 0.1,
            filterCutoff: 2500,
            filterResonance: 1,
            gain: 0.55,
        }),
        voice('Clap', 40, {
            waveform: 'triangle',
            attack: 0.003,
            decay: 0.15,
            sustain: 0.02,
            release: 0.08,
            filterCutoff: 3500,
            filterResonance: 1,
            gain: 0.45,
        }),
        voice('Closed HH', 42, {
            waveform: 'triangle',
            attack: 0.001,
            decay: 0.06,
            sustain: 0,
            release: 0.03,
            filterCutoff: 6000,
            filterResonance: 1,
            gain: 0.35,
        }),
        voice('Tom Low', 45, {
            waveform: 'sine',
            attack: 0.002,
            decay: 0.35,
            sustain: 0.05,
            release: 0.15,
            filterCutoff: 300,
            filterResonance: 0.5,
            gain: 0.6,
        }),
        voice('Open HH', 46, {
            waveform: 'triangle',
            attack: 0.001,
            decay: 0.3,
            sustain: 0.02,
            release: 0.15,
            filterCutoff: 8000,
            filterResonance: 1,
            gain: 0.35,
        }),
        voice('Tom Mid', 47, {
            waveform: 'sine',
            attack: 0.002,
            decay: 0.28,
            sustain: 0.04,
            release: 0.12,
            filterCutoff: 500,
            filterResonance: 0.5,
            gain: 0.6,
        }),
        voice('Tom High', 48, {
            waveform: 'sine',
            attack: 0.002,
            decay: 0.22,
            sustain: 0.03,
            release: 0.1,
            filterCutoff: 700,
            filterResonance: 0.5,
            gain: 0.6,
        }),
    ],
};

export const FACTORY_KITS: readonly DrumKit[] = [KIT_808, KIT_ANALOG, KIT_ELECTRONIC, KIT_ACOUSTIC];

const kitIndex = new Map<string, DrumKit>(FACTORY_KITS.map((k) => [k.id, k]));

export function getFactoryDrumKits(): readonly DrumKit[] {
    return FACTORY_KITS;
}

export function getDrumKitById(id: string): DrumKit | null {
    return kitIndex.get(id) ?? null;
}

const KIT_ID_BY_INDEX: Record<number, string> = Object.fromEntries(FACTORY_KITS.map((k, i) => [i, k.id]));

export function getDrumKitByIndex(index: number): DrumKit | null {
    return getDrumKitById(KIT_ID_BY_INDEX[index] ?? '');
}
