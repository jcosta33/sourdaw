/**
 * Device parameter and plugin descriptor type definitions.
 *
 * Pure types only — no catalog data, no helpers. The aggregated catalog
 * (`BUILTIN_PLUGINS`), variant builders, and query helpers live in
 * `DeviceParameter.ts`. Per-family descriptor data lives in
 * `./PluginDescriptors/*.ts`; those files import this module rather than
 * the aggregator to avoid circular dependencies.
 */

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
};
