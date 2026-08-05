/**
 * Workspace-local view shape of Arrangement's PluginDescriptor / DeviceParameter
 * (AGENTS.md §95 — model isolation). These are NOT re-exports; Workspace owns
 * its own types here containing the fields its views render.
 */

export type DeviceParameterTypeView = 'float' | 'int' | 'bool' | 'choice';

export type DeviceParameterView = {
    id: string;
    deviceId: string;
    name: string;
    type: DeviceParameterTypeView;
    value: number;
    defaultValue: number;
    minValue: number;
    maxValue: number;
    /**
     * The settings the engine distinguishes, when they are not every integer in
     * the range. Present means the control offers exactly these and nothing
     * between them.
     */
    legalValues?: readonly number[];
    unit: string;
    scaling?: 'log' | 'linear';
    choices?: string[];
    automatable: boolean;
    hasAutomation: boolean;
};

export type PluginDescriptorView = {
    id: string;
    name: string;
    vendor: string;
    format: 'builtin' | 'vst3' | 'clap' | 'au';
    category: 'instrument' | 'effect' | 'analyzer' | 'utility';
    parameters: DeviceParameterView[];
    hasCustomUI: boolean;
    platform?: 'web' | 'native' | 'both';
};
