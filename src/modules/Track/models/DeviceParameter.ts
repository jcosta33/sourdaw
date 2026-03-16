export type DeviceParameterType = "float" | "int" | "bool" | "choice";

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

export type PluginFormat = "builtin" | "vst3" | "clap" | "au";

export type PluginDescriptor = {
    id: string;
    name: string;
    vendor: string;
    format: PluginFormat;
    category: "instrument" | "effect" | "analyzer" | "utility";
    parameters: DeviceParameter[];
    hasCustomUI: boolean;
};

export const BUILTIN_PLUGINS: PluginDescriptor[] = [
    {
        id: "builtin-eq",
        name: "EQ",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "eq-low-gain", deviceId: "builtin-eq", name: "Low Gain", type: "float", value: 0, defaultValue: 0, minValue: -24, maxValue: 24, unit: "dB", automatable: true, hasAutomation: false },
            { id: "eq-low-freq", deviceId: "builtin-eq", name: "Low Freq", type: "float", value: 100, defaultValue: 100, minValue: 20, maxValue: 500, unit: "Hz", automatable: true, hasAutomation: false },
            { id: "eq-mid-gain", deviceId: "builtin-eq", name: "Mid Gain", type: "float", value: 0, defaultValue: 0, minValue: -24, maxValue: 24, unit: "dB", automatable: true, hasAutomation: false },
            { id: "eq-mid-freq", deviceId: "builtin-eq", name: "Mid Freq", type: "float", value: 1000, defaultValue: 1000, minValue: 200, maxValue: 8000, unit: "Hz", automatable: true, hasAutomation: false },
            { id: "eq-mid-q", deviceId: "builtin-eq", name: "Mid Q", type: "float", value: 1, defaultValue: 1, minValue: 0.1, maxValue: 10, unit: "", automatable: true, hasAutomation: false },
            { id: "eq-high-gain", deviceId: "builtin-eq", name: "High Gain", type: "float", value: 0, defaultValue: 0, minValue: -24, maxValue: 24, unit: "dB", automatable: true, hasAutomation: false },
            { id: "eq-high-freq", deviceId: "builtin-eq", name: "High Freq", type: "float", value: 8000, defaultValue: 8000, minValue: 2000, maxValue: 20000, unit: "Hz", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-compressor",
        name: "Compressor",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "comp-threshold", deviceId: "builtin-compressor", name: "Threshold", type: "float", value: -20, defaultValue: -20, minValue: -60, maxValue: 0, unit: "dB", automatable: true, hasAutomation: false },
            { id: "comp-ratio", deviceId: "builtin-compressor", name: "Ratio", type: "float", value: 4, defaultValue: 4, minValue: 1, maxValue: 20, unit: ":1", automatable: true, hasAutomation: false },
            { id: "comp-attack", deviceId: "builtin-compressor", name: "Attack", type: "float", value: 10, defaultValue: 10, minValue: 0.1, maxValue: 100, unit: "ms", automatable: true, hasAutomation: false },
            { id: "comp-release", deviceId: "builtin-compressor", name: "Release", type: "float", value: 100, defaultValue: 100, minValue: 10, maxValue: 1000, unit: "ms", automatable: true, hasAutomation: false },
            { id: "comp-makeup", deviceId: "builtin-compressor", name: "Makeup", type: "float", value: 0, defaultValue: 0, minValue: 0, maxValue: 30, unit: "dB", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-reverb",
        name: "Reverb",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "rev-size", deviceId: "builtin-reverb", name: "Size", type: "float", value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
            { id: "rev-decay", deviceId: "builtin-reverb", name: "Decay", type: "float", value: 2, defaultValue: 2, minValue: 0.1, maxValue: 20, unit: "s", automatable: true, hasAutomation: false },
            { id: "rev-damping", deviceId: "builtin-reverb", name: "Damping", type: "float", value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
            { id: "rev-mix", deviceId: "builtin-reverb", name: "Dry/Wet", type: "float", value: 0.3, defaultValue: 0.3, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-delay",
        name: "Delay",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "delay-time", deviceId: "builtin-delay", name: "Time", type: "float", value: 250, defaultValue: 250, minValue: 1, maxValue: 2000, unit: "ms", automatable: true, hasAutomation: false },
            { id: "delay-feedback", deviceId: "builtin-delay", name: "Feedback", type: "float", value: 0.4, defaultValue: 0.4, minValue: 0, maxValue: 0.95, unit: "", automatable: true, hasAutomation: false },
            { id: "delay-mix", deviceId: "builtin-delay", name: "Dry/Wet", type: "float", value: 0.3, defaultValue: 0.3, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-gain",
        name: "Gain",
        vendor: "WebDAW",
        format: "builtin",
        category: "utility",
        hasCustomUI: false,
        parameters: [
            { id: "gain-level", deviceId: "builtin-gain", name: "Gain", type: "float", value: 0, defaultValue: 0, minValue: -60, maxValue: 24, unit: "dB", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-sidechain-compressor",
        name: "Sidechain Compressor",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "sc-comp-threshold", deviceId: "builtin-sidechain-compressor", name: "Threshold", type: "float", value: -20, defaultValue: -20, minValue: -60, maxValue: 0, unit: "dB", automatable: true, hasAutomation: false },
            { id: "sc-comp-ratio", deviceId: "builtin-sidechain-compressor", name: "Ratio", type: "float", value: 4, defaultValue: 4, minValue: 1, maxValue: 20, unit: ":1", automatable: true, hasAutomation: false },
            { id: "sc-comp-attack", deviceId: "builtin-sidechain-compressor", name: "Attack", type: "float", value: 10, defaultValue: 10, minValue: 1, maxValue: 100, unit: "ms", automatable: true, hasAutomation: false },
            { id: "sc-comp-release", deviceId: "builtin-sidechain-compressor", name: "Release", type: "float", value: 100, defaultValue: 100, minValue: 10, maxValue: 1000, unit: "ms", automatable: true, hasAutomation: false },
            { id: "sc-comp-makeup", deviceId: "builtin-sidechain-compressor", name: "Makeup", type: "float", value: 0, defaultValue: 0, minValue: 0, maxValue: 30, unit: "dB", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-chorus",
        name: "Chorus",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "chorus-rate", deviceId: "builtin-chorus", name: "Rate", type: "float", value: 1.5, defaultValue: 1.5, minValue: 0.1, maxValue: 10, unit: "Hz", automatable: true, hasAutomation: false },
            { id: "chorus-depth", deviceId: "builtin-chorus", name: "Depth", type: "float", value: 5, defaultValue: 5, minValue: 0, maxValue: 20, unit: "ms", automatable: true, hasAutomation: false },
            { id: "chorus-mix", deviceId: "builtin-chorus", name: "Dry/Wet", type: "float", value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-phaser",
        name: "Phaser",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "phaser-rate", deviceId: "builtin-phaser", name: "Rate", type: "float", value: 0.5, defaultValue: 0.5, minValue: 0.1, maxValue: 10, unit: "Hz", automatable: true, hasAutomation: false },
            { id: "phaser-depth", deviceId: "builtin-phaser", name: "Depth", type: "float", value: 0.7, defaultValue: 0.7, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
            { id: "phaser-feedback", deviceId: "builtin-phaser", name: "Feedback", type: "float", value: 0.3, defaultValue: 0.3, minValue: 0, maxValue: 0.9, unit: "", automatable: true, hasAutomation: false },
            { id: "phaser-stages", deviceId: "builtin-phaser", name: "Stages", type: "int", value: 4, defaultValue: 4, minValue: 2, maxValue: 12, unit: "", automatable: false, hasAutomation: false },
        ],
    },
    {
        id: "builtin-distortion",
        name: "Distortion",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "dist-drive", deviceId: "builtin-distortion", name: "Drive", type: "float", value: 20, defaultValue: 20, minValue: 0, maxValue: 100, unit: "", automatable: true, hasAutomation: false },
            { id: "dist-tone", deviceId: "builtin-distortion", name: "Tone", type: "float", value: 4000, defaultValue: 4000, minValue: 200, maxValue: 8000, unit: "Hz", automatable: true, hasAutomation: false },
            { id: "dist-mix", deviceId: "builtin-distortion", name: "Dry/Wet", type: "float", value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: "", automatable: true, hasAutomation: false },
        ],
    },
    {
        id: "builtin-limiter",
        name: "Limiter",
        vendor: "WebDAW",
        format: "builtin",
        category: "effect",
        hasCustomUI: false,
        parameters: [
            { id: "lim-threshold", deviceId: "builtin-limiter", name: "Threshold", type: "float", value: -6, defaultValue: -6, minValue: -30, maxValue: 0, unit: "dB", automatable: true, hasAutomation: false },
            { id: "lim-release", deviceId: "builtin-limiter", name: "Release", type: "float", value: 100, defaultValue: 100, minValue: 10, maxValue: 500, unit: "ms", automatable: true, hasAutomation: false },
            { id: "lim-ceiling", deviceId: "builtin-limiter", name: "Ceiling", type: "float", value: -0.3, defaultValue: -0.3, minValue: -3, maxValue: 0, unit: "dB", automatable: true, hasAutomation: false },
        ],
    },
];

export const getPluginById = (pluginId: string): PluginDescriptor | undefined => {
    return BUILTIN_PLUGINS.find((p) => p.id === pluginId);
};
