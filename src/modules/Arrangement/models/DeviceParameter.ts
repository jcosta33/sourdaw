/**
 * Device parameter type definitions and plugin descriptors.
 *
 * This file owns the shared types and utility functions. The descriptor data
 * is split by family in the `./pluginDescriptors/` sub-directory.
 */

// ── Shared types ─────────────────────────────────────────────────────────────

export type DeviceParameterType = 'float' | 'int' | 'bool' | 'choice';

export type DeviceParameter = {
    id: string;
    deviceId: string;
    name: string;
    type: DeviceParameterType;
    value: number;
    defaultValue: number;
    minValue: number;
    maxValue: number;
    unit: string;
    choices?: string[];
    automatable: boolean;
    hasAutomation: boolean;
};

export type PluginFormat = 'builtin' | 'vst3' | 'clap' | 'au';

export type PluginPlatform = 'web' | 'native' | 'both';

export type PluginDescriptor = {
    id: string;
    name: string;
    vendor: string;
    format: PluginFormat;
    category: 'instrument' | 'effect' | 'analyzer' | 'utility';
    parameters: DeviceParameter[];
    hasCustomUI: boolean;
    /** Which runtime this plugin is available on. Defaults to 'both'. */
    platform?: PluginPlatform;
};

// ── Descriptor sub-modules ─────────────────────────────────────────────────
import { BUILTIN_EFFECT_DESCRIPTORS } from './pluginDescriptors/builtinEffectDescriptors';
import { BUILTIN_INSTRUMENT_DESCRIPTORS } from './pluginDescriptors/builtinInstrumentDescriptors';
import { NATIVE_DSP_DESCRIPTORS } from './pluginDescriptors/nativeDspDescriptors';
import { FERMENTER_DESCRIPTOR } from './pluginDescriptors/fermenterDescriptor';

// ── Synth variants (generated from builtin-synth base) ─────────────────────
function createSynthVariant(id: string, name: string, overrides: Record<string, number>): PluginDescriptor {
    const base = BUILTIN_INSTRUMENT_DESCRIPTORS.find((p) => p.id === 'builtin-synth')!;
    return {
        id,
        name,
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        parameters: base.parameters.map((p) => {
            const val = overrides[p.id] !== undefined ? overrides[p.id]! : (p.defaultValue as number);
            return { ...p, deviceId: id, value: val, defaultValue: val };
        }),
    };
}

const SYNTH_VARIANTS: PluginDescriptor[] = [
    createSynthVariant('builtin-synth-mellotron', 'Mellotron', {
        waveform: 3, attack: 0.1, decay: 0.4, release: 0.3,
        filterCutoff: 2500, vibratoRate: 5.5, vibratoDepth: 20, noiseLevel: 0.05,
    }),
    createSynthVariant('builtin-synth-strings', 'Analog Strings', {
        waveform: 2, attack: 0.3, release: 1.2, osc2Mix: 0.5, osc2Detune: 15, stereoSpread: 1,
    }),
    createSynthVariant('builtin-synth-808bass', '808 Bass', {
        waveform: 0, attack: 0.01, decay: 1.2, sustain: 0,
        subOscLevel: 1.0, filterCutoff: 800, filterEnvAmount: 1200,
    }),
    createSynthVariant('builtin-synth-brass', 'Classic Brass', {
        waveform: 2, attack: 0.05, filterEnvAmount: 3000,
        osc2Waveform: 3, osc2Mix: 0.3, filterCutoff: 500, filterResonance: 3, stereoSpread: 0.5,
    }),
];

// ── Drum variants (generated from builtin-drum-kit base) ──────────────────
function createDrumVariant(id: string, name: string, kitIndex: number): PluginDescriptor {
    const base = BUILTIN_INSTRUMENT_DESCRIPTORS.find((p) => p.id === 'builtin-drum-kit')!;
    return {
        id,
        name,
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        parameters: base.parameters.map((p) => {
            if (p.id === 'kit') {
                return { ...p, deviceId: id, value: kitIndex, defaultValue: kitIndex };
            }
            return { ...p, deviceId: id };
        }),
    };
}

const DRUM_VARIANTS: PluginDescriptor[] = [
    createDrumVariant('builtin-drum-machine-808', '808 Drum Machine', 0),
    createDrumVariant('builtin-drum-machine-analog', 'Analog Drum Machine', 1),
    createDrumVariant('builtin-drum-machine-electronic', 'Electronic Drum Machine', 2),
    createDrumVariant('builtin-drum-machine-acoustic', 'Acoustic Drum Kit', 3),
];

// ── Aggregated registry ────────────────────────────────────────────────────

export const BUILTIN_PLUGINS: PluginDescriptor[] = [
    ...BUILTIN_EFFECT_DESCRIPTORS,
    ...BUILTIN_INSTRUMENT_DESCRIPTORS,
    ...NATIVE_DSP_DESCRIPTORS,
    ...SYNTH_VARIANTS,
    ...DRUM_VARIANTS,
    FERMENTER_DESCRIPTOR,
];

// ── Utility functions ──────────────────────────────────────────────────────

export function getPluginById(pluginId: string): PluginDescriptor | undefined {
    return BUILTIN_PLUGINS.find((p) => p.id === pluginId);
}

/**
 * Check whether a device type is supported on the current runtime.
 * Returns false for native-only plugins when running on web.
 * Native (Tauri) can run both web and native plugins since it uses WebView + Web Audio.
 */
export function isDeviceSupportedOnCurrentPlatform(deviceType: string): boolean {
    const descriptor = BUILTIN_PLUGINS.find((p) => p.id === deviceType);
    if (!descriptor) return true; // unknown devices pass through (e.g. external plugins)
    const platform = descriptor.platform ?? 'both';
    if (platform === 'both') return true;
    const isNativeRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isNativeRuntime) return true; // native can run both web and native plugins
    return platform === 'web'; // web can only run web plugins
}
