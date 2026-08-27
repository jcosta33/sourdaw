import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';
import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { type PluginDescriptor } from './DeviceParameterTypes';
import { BACTERIA_DESCRIPTOR } from './PluginDescriptors/BacteriaDescriptor';
import { BUILTIN_EFFECT_DESCRIPTORS } from './PluginDescriptors/BuiltinEffectDescriptors';
import { BUILTIN_INSTRUMENT_DESCRIPTORS } from './PluginDescriptors/BuiltinInstrumentDescriptors';
import { CRUMBS_DESCRIPTOR } from './PluginDescriptors/CrumbsDescriptor';
import { CRUST_DESCRIPTOR } from './PluginDescriptors/CrustDescriptor';
import { FAUST_EFFECT_DESCRIPTORS } from './PluginDescriptors/FaustEffectDescriptors';
import { FERMENTER_DESCRIPTOR } from './PluginDescriptors/FermenterDescriptor';
import { GLUTEN_DESCRIPTOR } from './PluginDescriptors/GlutenDescriptor';
import { GRAND_BOULE_DESCRIPTOR } from './PluginDescriptors/GrandBouleDescriptor';
import { GRINDER_DESCRIPTOR } from './PluginDescriptors/GrinderDescriptor';
import { KNEAD_DESCRIPTOR } from './PluginDescriptors/KneadDescriptor';
import { LEVAIN_DESCRIPTOR } from './PluginDescriptors/LevainDescriptor';
import { NATIVE_DSP_DESCRIPTORS } from './PluginDescriptors/NativeDspDescriptors';
import { PROOF_DESCRIPTOR } from './PluginDescriptors/ProofDescriptor';
import { TOASTER_DESCRIPTOR } from './PluginDescriptors/ToasterDescriptor';
import { YEAST_DESCRIPTOR } from './PluginDescriptors/YeastDescriptor';

/**
 * Built-in plugin catalog and aggregation helpers.
 *
 * Type definitions live in `./DeviceParameterTypes.ts`; descriptor data is
 * split by family in `./PluginDescriptors/`. This file only owns the
 * variant builders, the aggregated `BUILTIN_PLUGINS` array, and the
 * platform/availability helpers. It re-exports the shared types so existing
 * in-module callers do not need to update their import paths.
 */

// ── Descriptor sub-modules ─────────────────────────────────────────────────

export type {
    DeviceParameterType,
    DeviceParameter,
    PluginParamDef,
    PluginFormat,
    PluginPlatform,
    PluginDescriptor,
    DeviceParameterModulationDeclaration,
    DeviceGainCompensationDeclaration,
    DeviceParameterGuidance,
    PluginDescriptorGuidance,
} from './DeviceParameterTypes';

// ── Synth variants (generated from builtin-synth base) ─────────────────────
function createSynthVariant(id: string, name: string, overrides: Record<string, number>): PluginDescriptor {
    const base = BUILTIN_INSTRUMENT_DESCRIPTORS.find((param) => param.id === 'builtin-synth');
    if (!base) {
        // A bare `.find(...)!` here used to fail as a generic
        // `Cannot read properties of undefined` deep inside the spread below,
        // the moment this module loaded — taking down every module that
        // transitively imports the plugin catalog rather than naming the
        // missing descriptor.
        throw new Error(
            "createSynthVariant: base descriptor 'builtin-synth' not found in BUILTIN_INSTRUMENT_DESCRIPTORS"
        );
    }
    // Spread the base rather than re-listing its fields. Re-listing silently
    // dropped every capability the base declared but the literal did not name:
    // the variants lost `tail`, so all four exported with a tail of zero while
    // "Analog Strings" was setting `release: 1.2`. A field added to
    // `PluginDescriptor` now reaches the variants without touching this function.
    return {
        ...base,
        id,
        name,
        parameters: base.parameters.map((param) => {
            const val = overrides[param.id] !== undefined ? overrides[param.id]! : param.defaultValue;
            return { ...param, deviceId: id, value: val, defaultValue: val };
        }),
    };
}

const SYNTH_VARIANTS: PluginDescriptor[] = [
    createSynthVariant('builtin-synth-mellotron', 'Mellotron', {
        waveform: 3,
        attack: 0.1,
        decay: 0.4,
        release: 0.3,
        filterCutoff: 2500,
        vibratoRate: 5.5,
        vibratoDepth: 20,
        noiseLevel: 0.05,
    }),
    createSynthVariant('builtin-synth-strings', 'Analog Strings', {
        waveform: 2,
        attack: 0.3,
        release: 1.2,
        osc2Mix: 0.5,
        osc2Detune: 15,
        stereoSpread: 1,
    }),
    createSynthVariant('builtin-synth-808bass', '808 Bass', {
        waveform: 0,
        attack: 0.01,
        decay: 1.2,
        sustain: 0,
        subOscLevel: 1.0,
        filterCutoff: 800,
        filterEnvAmount: 1200,
    }),
    createSynthVariant('builtin-synth-brass', 'Classic Brass', {
        waveform: 2,
        attack: 0.05,
        filterEnvAmount: 3000,
        osc2Waveform: 3,
        osc2Mix: 0.3,
        filterCutoff: 500,
        filterResonance: 3,
        stereoSpread: 0.5,
    }),
];

// ── Drum variants (generated from builtin-drum-kit base) ──────────────────
function createDrumVariant(id: string, name: string, kitIndex: number): PluginDescriptor {
    const base = BUILTIN_INSTRUMENT_DESCRIPTORS.find((param) => param.id === 'builtin-drum-kit');
    if (!base) {
        // Same rule as `createSynthVariant`: name the missing descriptor
        // instead of crashing on a property access several lines away.
        throw new Error(
            "createDrumVariant: base descriptor 'builtin-drum-kit' not found in BUILTIN_INSTRUMENT_DESCRIPTORS"
        );
    }
    // Same inheritance rule as the synth variants: spread, never re-list.
    return {
        ...base,
        id,
        name,
        parameters: base.parameters.map((param) => {
            if (param.id === 'kit') {
                return { ...param, deviceId: id, value: kitIndex, defaultValue: kitIndex };
            }
            return { ...param, deviceId: id };
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
    ...FAUST_EFFECT_DESCRIPTORS,
    ...SYNTH_VARIANTS,
    ...DRUM_VARIANTS,
    FERMENTER_DESCRIPTOR,
    TOASTER_DESCRIPTOR,
    LEVAIN_DESCRIPTOR,
    GLUTEN_DESCRIPTOR,
    BACTERIA_DESCRIPTOR,
    GRINDER_DESCRIPTOR,
    PROOF_DESCRIPTOR,
    YEAST_DESCRIPTOR,
    CRUST_DESCRIPTOR,
    CRUMBS_DESCRIPTOR,
    GRAND_BOULE_DESCRIPTOR,
    KNEAD_DESCRIPTOR,
];

// ── Utility functions ──────────────────────────────────────────────────────

export function getPluginById(pluginId: string): PluginDescriptor | undefined {
    return BUILTIN_PLUGINS.find((param) => param.id === pluginId);
}

/**
 * Check whether a device type is supported on the current runtime.
 * Returns false for native-only plugins when running on web.
 * The desktop app can run both web and native plugins since it uses a Chromium
 * renderer + Web Audio.
 */
export function isDeviceSupportedOnCurrentPlatform(deviceType: string): boolean {
    if (!isDeviceReleaseAdmitted(deviceType)) {
        return false;
    }
    const descriptor = BUILTIN_PLUGINS.find((param) => param.id === deviceType);
    if (!descriptor) {
        return true;
    } // unknown devices pass through (e.g. external plugins)
    const platform = descriptor.platform ?? 'both';
    if (platform === 'both') {
        return true;
    }
    const isNativeRuntime = isDesktopRuntime();
    if (isNativeRuntime) {
        return true;
    } // native can run both web and native plugins
    return platform === 'web'; // web can only run web plugins
}
