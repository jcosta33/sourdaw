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
     * convenient span for a knob — those are now two different questions, and
     * `uiMinValue` answers the second one.
     *
     * Before the law bound at the write, tightening this pair was free: it
     * changed the parameter picker and the knob and nothing else. It is not
     * free now. Narrowing it silently rewrites every value outside the new
     * range, including ones already shipped in demo projects, factory presets
     * and saved user projects.
     */
    minValue: number;
    maxValue: number;
    /**
     * The floor the panel control offers, when that is tighter than the
     * engine's.
     *
     * Some declared floors were authored for a slider — a rate knob that
     * bottoms out at a usable value rather than at a stopped LFO. That is a
     * reasonable default for dragging a knob and a wrong answer for what the
     * engine accepts, and while `minValue` was advisory the one field could be
     * both. Now that it binds at the write, a floor that exists for the knob's
     * benefit has to say so here instead, or it clips real content.
     *
     * Omitted means the control uses `minValue`, which is the common case.
     */
    uiMinValue?: number;
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
