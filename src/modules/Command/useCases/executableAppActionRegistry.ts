import { type AppActionType } from '#/utils/handlerContract';

export type ExecutableAppActionRisk = 'bounded-reversible' | 'broad-reversible' | 'authority-sensitive';

export type ExecutableAppActionTargetCapability =
    'track' | 'duplicable-track' | 'routable-source' | 'bus' | 'output' | 'device' | 'device-parameter';

export type ExecutableAppActionTargetRule = {
    argument: string;
    capability: ExecutableAppActionTargetCapability;
    dependsOn?: string;
    distinctFrom?: string;
};

type ExecutableAppActionDescriptor = {
    actionType: AppActionType;
    risk: ExecutableAppActionRisk;
    description: string;
    targetRules: readonly ExecutableAppActionTargetRule[];
    parameters: {
        properties: Record<string, unknown>;
        required: readonly string[];
    };
};

const trackTargetRules = [
    { argument: 'trackId', capability: 'track' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const sendTargetRules = [
    { argument: 'busId', capability: 'bus' },
    {
        argument: 'trackId',
        capability: 'routable-source',
        distinctFrom: 'busId',
    },
] as const satisfies readonly ExecutableAppActionTargetRule[];

export const executableAppActionDescriptors = [
    {
        actionType: 'addTrack',
        risk: 'bounded-reversible',
        description: 'Create a new track in the session.',
        targetRules: [],
        parameters: {
            properties: {
                name: { type: 'string', description: 'Display name (e.g. "Kick", "Vocals", "Synth Pad")' },
                kind: { type: 'string', enum: ['audio', 'midi', 'bus', 'folder'], description: 'Track type' },
            },
            required: ['name', 'kind'],
        },
    },
    {
        actionType: 'renameTrack',
        risk: 'bounded-reversible',
        description: 'Rename a track.',
        targetRules: trackTargetRules,
        parameters: {
            properties: { trackId: { type: 'string' }, name: { type: 'string' } },
            required: ['trackId', 'name'],
        },
    },
    {
        actionType: 'muteTrack',
        risk: 'bounded-reversible',
        description: 'Mute or unmute a track.',
        targetRules: trackTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                muted: { type: 'boolean', description: 'true=mute, false=unmute' },
            },
            required: ['trackId', 'muted'],
        },
    },
    {
        actionType: 'soloTrack',
        risk: 'bounded-reversible',
        description: 'Solo or unsolo a track (only hear this track).',
        targetRules: trackTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                soloed: { type: 'boolean', description: 'true=solo, false=unsolo' },
            },
            required: ['trackId', 'soloed'],
        },
    },
    {
        actionType: 'duplicateTrack',
        risk: 'broad-reversible',
        description: 'Duplicate a track with all clips and devices.',
        targetRules: [{ argument: 'trackId', capability: 'duplicable-track' }],
        parameters: { properties: { trackId: { type: 'string' } }, required: ['trackId'] },
    },
    {
        actionType: 'setTrackGain',
        risk: 'bounded-reversible',
        description: 'Set track volume. 0.0=silence, 0.8=default, 1.0=max.',
        targetRules: trackTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                gain: { type: 'number', description: '0.0 to 1.0' },
            },
            required: ['trackId', 'gain'],
        },
    },
    {
        actionType: 'setTrackPan',
        risk: 'bounded-reversible',
        description: 'Pan a track left/right. -50=hard left, 0=center, 50=hard right.',
        targetRules: trackTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                pan: { type: 'number', description: '-50 to 50' },
            },
            required: ['trackId', 'pan'],
        },
    },
    {
        actionType: 'setTrackColor',
        risk: 'bounded-reversible',
        description: 'Color-code a track for visual organization.',
        targetRules: trackTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                color: { type: 'string', description: 'Six-digit hexadecimal color (for example #ff5500)' },
            },
            required: ['trackId', 'color'],
        },
    },
    {
        actionType: 'reorderTrack',
        risk: 'bounded-reversible',
        description: 'Move a track to a new position in the track list.',
        targetRules: trackTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                newIndex: { type: 'number', description: '0-based index in the track list' },
            },
            required: ['trackId', 'newIndex'],
        },
    },
    {
        actionType: 'setTempo',
        risk: 'authority-sensitive',
        description: 'Set the project tempo in BPM. Range: 20–300.',
        targetRules: [],
        parameters: { properties: { bpm: { type: 'number' } }, required: ['bpm'] },
    },
    {
        actionType: 'setDeviceParameter',
        risk: 'bounded-reversible',
        description: 'Adjust a parameter on an existing device.',
        targetRules: [
            { argument: 'deviceId', capability: 'device' },
            {
                argument: 'paramId',
                capability: 'device-parameter',
                dependsOn: 'deviceId',
            },
        ],
        parameters: {
            properties: {
                deviceId: { type: 'string' },
                paramId: {
                    type: 'string',
                    description: 'Parameter name (e.g. "frequency", "ratio", "mix", "threshold")',
                },
                value: { type: 'number', description: 'Parameter value (range depends on the parameter)' },
            },
            required: ['deviceId', 'paramId', 'value'],
        },
    },
    {
        actionType: 'bypassDevice',
        risk: 'bounded-reversible',
        description: 'Bypass or re-enable an effect (keeps settings, just disables processing).',
        targetRules: [{ argument: 'deviceId', capability: 'device' }],
        parameters: {
            properties: { deviceId: { type: 'string' }, bypassed: { type: 'boolean' } },
            required: ['deviceId', 'bypassed'],
        },
    },
    {
        actionType: 'addSend',
        risk: 'authority-sensitive',
        description: "Route a copy of a track's signal to a bus (parallel processing).",
        targetRules: sendTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                busId: { type: 'string' },
                level: { type: 'number', description: 'Send level 0.0–1.0' },
            },
            required: ['trackId', 'busId', 'level'],
        },
    },
    {
        actionType: 'setSend',
        risk: 'authority-sensitive',
        description: 'Adjust the send level from a track to a bus.',
        targetRules: sendTargetRules,
        parameters: {
            properties: {
                trackId: { type: 'string' },
                busId: { type: 'string' },
                level: { type: 'number' },
            },
            required: ['trackId', 'busId', 'level'],
        },
    },
    {
        actionType: 'removeSend',
        risk: 'authority-sensitive',
        description: 'Remove a send from a track to a bus.',
        targetRules: sendTargetRules,
        parameters: {
            properties: { trackId: { type: 'string' }, busId: { type: 'string' } },
            required: ['trackId', 'busId'],
        },
    },
    {
        actionType: 'setTrackOutput',
        risk: 'authority-sensitive',
        description: "Route a track's output to a specific bus or master.",
        targetRules: [
            { argument: 'outputId', capability: 'output' },
            { argument: 'trackId', capability: 'routable-source', distinctFrom: 'outputId' },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string' },
                outputId: { type: 'string', description: 'Destination track/bus ID' },
            },
            required: ['trackId', 'outputId'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];

export const executableAppActionDescriptorByType: ReadonlyMap<string, (typeof executableAppActionDescriptors)[number]> =
    new Map(executableAppActionDescriptors.map((descriptor) => [descriptor.actionType, descriptor]));
