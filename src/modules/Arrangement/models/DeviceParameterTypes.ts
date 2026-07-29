/**
 * Device parameter and plugin descriptor type definitions.
 *
 * Pure types only — no catalog data, no helpers. The aggregated catalog
 * (`BUILTIN_PLUGINS`), variant builders, and query helpers live in
 * `DeviceParameter.ts`. Per-family descriptor data lives in
 * `./PluginDescriptors/*.ts`; those files import this module rather than
 * the aggregator to avoid circular dependencies.
 */

import { type DeviceTailDeclaration } from './DeviceTailTypes';

export type DeviceParameterType = 'float' | 'int' | 'bool' | 'choice';

export type DeviceParameter = {
    id: string;
    deviceId: string;
    name: string;
    type: DeviceParameterType;
    value: number;
    defaultValue: number;
    /**
     * The narrowest and widest value the engine will accept for this parameter.
     *
     * This is a **write law**, not a display hint: every device-parameter write
     * is held to it (see `DeviceParameterLaw`). It therefore has to describe
     * what the DSP actually accepts, and it can no longer double as the
     * convenient span for a knob.
     *
     * Before the law bound at the write, tightening this pair was free: it
     * changed the parameter picker and the knob and nothing else. It is not
     * free now. Narrowing it silently rewrites every value outside the new
     * range, including ones already shipped in demo projects, factory presets
     * and saved user projects.
     *
     * There is deliberately no separate "floor the knob offers" field. One was
     * tried and reintroduced the same defect one layer out: `RotaryKnob` clamps
     * to its `min`, so a knob floor above a stored value rewrites that value on
     * the first drag, one-way — the store keeps 0.05 forever and the user has
     * no way back to it. A control that needs usable resolution near the bottom
     * wants `scaling: 'log'`, which gives resolution without exclusion.
     */
    minValue: number;
    maxValue: number;
    unit: string;
    scaling?: 'log' | 'linear';
    choices?: string[];
    automatable: boolean;
    hasAutomation: boolean;
};

/**
 * Minimal parameter definition shape used by plugin descriptors within
 * this module. Each instrument module owns its own full param-def type;
 * this local type captures only the fields the descriptor mapping needs.
 * Models must not cross module boundaries — each descriptor file inlines
 * its own param array using this type rather than importing from the
 * instrument module.
 */
export type PluginParamDef = {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
    unit: string;
    step?: number;
    scaling?: 'log' | 'linear';
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
    /**
     * How long this device keeps sounding after its input stops, so offline
     * export can reserve room for it. Omitted means "no tail" — the device
     * stops when its input does.
     */
    tail?: DeviceTailDeclaration;
};
