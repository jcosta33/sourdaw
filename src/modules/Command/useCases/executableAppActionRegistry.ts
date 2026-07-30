import { type AppActionType } from '#/utils/handlerContract';

export type ExecutableAppActionRisk =
    'bounded-reversible' | 'broad-reversible' | 'destructive-reversible' | 'authority-sensitive';

export type ExecutableAppActionTargetCapability =
    | 'track'
    | 'armable-track'
    | 'duplicable-track'
    | 'removable-track'
    | 'routable-source'
    | 'bus'
    | 'output'
    | 'device'
    | 'device-parameter'
    | 'clip'
    | 'editable-clip';

export type ExecutableAppActionTargetRule = {
    argument: string;
    capability: ExecutableAppActionTargetCapability;
    dependsOn?: string;
    distinctFrom?: string;
    promptRole?: 'source' | 'destination';
};

export type ExecutableAppActionValueRule =
    | {
          argument: string;
          kind: 'boolean-intent';
          truePhrases: readonly string[];
          falsePhrases: readonly string[];
      }
    | { argument: string; kind: 'text-after-connector'; connector: 'to' }
    | {
          argument: string;
          kind: 'number-if-present';
          requiredInPrompt?: boolean;
          scale?: 'unit-interval' | 'percentage-only';
          direction?: 'pan';
          qualitativeDirection?: 'track-gain' | 'track-pan' | 'device-parameter';
      }
    | { argument: string; kind: 'string-literal' }
    | { argument: string; kind: 'enum-if-present'; values: readonly string[] }
    | { argument: string; kind: 'text-after-keyword-if-present'; keywords: readonly string[] }
    | { argument: string; denominatorArgument: string; kind: 'time-signature' };

type ExecutableAppActionDescriptor = {
    actionType: AppActionType;
    risk: ExecutableAppActionRisk;
    description: string;
    intentPhrases: readonly string[];
    targetRules: readonly ExecutableAppActionTargetRule[];
    valueRules?: readonly ExecutableAppActionValueRule[];
    parameters: {
        properties: Record<string, unknown>;
        required: readonly string[];
    };
};

const trackTargetRules = [
    { argument: 'trackId', capability: 'track' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const clipTargetRules = [
    { argument: 'clipId', capability: 'clip' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const editableClipTargetRules = [
    { argument: 'clipId', capability: 'editable-clip' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const sendTargetRules = [
    { argument: 'busId', capability: 'bus', promptRole: 'destination' },
    {
        argument: 'trackId',
        capability: 'routable-source',
        distinctFrom: 'busId',
        promptRole: 'source',
    },
] as const satisfies readonly ExecutableAppActionTargetRule[];

export const executableAppActionDescriptors = [
    {
        actionType: 'addTrack',
        risk: 'bounded-reversible',
        description: 'Create a new track in the session.',
        intentPhrases: [
            'add track',
            'create track',
            'add new track',
            'create new track',
            'add audio track',
            'create audio track',
            'add an audio track',
            'create an audio track',
            'add midi track',
            'create midi track',
            'add a midi track',
            'create a midi track',
            'add folder track',
            'create folder track',
            'add a folder track',
            'create a folder track',
        ],
        targetRules: [],
        valueRules: [
            { argument: 'name', kind: 'text-after-keyword-if-present', keywords: ['named', 'called'] },
            { argument: 'kind', kind: 'enum-if-present', values: ['audio', 'midi', 'folder'] },
        ],
        parameters: {
            properties: {
                name: { type: 'string', description: 'Display name (e.g. "Kick", "Vocals", "Synth Pad")' },
                kind: { type: 'string', enum: ['audio', 'midi', 'folder'], description: 'Track type' },
            },
            required: ['name', 'kind'],
        },
    },
    {
        actionType: 'createBus',
        risk: 'bounded-reversible',
        description: 'Create a new bus track in the session.',
        intentPhrases: [
            'add bus',
            'create bus',
            'add a bus',
            'create a bus',
            'add bus track',
            'create bus track',
            'add a bus track',
            'create a bus track',
        ],
        targetRules: [],
        valueRules: [{ argument: 'name', kind: 'text-after-keyword-if-present', keywords: ['named', 'called'] }],
        parameters: {
            properties: { name: { type: 'string', description: 'Display name for the new bus track' } },
            required: ['name'],
        },
    },
    {
        actionType: 'removeTrack',
        risk: 'destructive-reversible',
        description: 'Delete a track and its project-owned contents.',
        intentPhrases: ['delete track', 'remove track', 'delete', 'remove'],
        targetRules: [{ argument: 'trackId', capability: 'removable-track' }],
        parameters: {
            properties: { trackId: { type: 'string', description: 'Existing non-master track ID' } },
            required: ['trackId'],
        },
    },
    {
        actionType: 'duplicateClip',
        risk: 'bounded-reversible',
        description: 'Duplicate an existing clip immediately after itself.',
        intentPhrases: ['duplicate clip', 'copy clip'],
        targetRules: clipTargetRules,
        parameters: {
            properties: { clipId: { type: 'string', description: 'Existing clip ID' } },
            required: ['clipId'],
        },
    },
    {
        actionType: 'duplicateClipToNextBar',
        risk: 'bounded-reversible',
        description: 'Duplicate an existing clip at the next bar boundary.',
        intentPhrases: ['duplicate clip to next bar', 'copy clip to next bar', 'duplicate to next bar'],
        targetRules: clipTargetRules,
        parameters: {
            properties: { clipId: { type: 'string', description: 'Existing clip ID' } },
            required: ['clipId'],
        },
    },
    {
        actionType: 'removeClip',
        risk: 'destructive-reversible',
        description: 'Delete a clip and its project-owned MIDI data.',
        intentPhrases: ['delete clip', 'remove clip', 'delete', 'remove'],
        targetRules: editableClipTargetRules,
        parameters: {
            properties: { clipId: { type: 'string', description: 'Existing unlocked clip ID' } },
            required: ['clipId'],
        },
    },
    {
        actionType: 'renameClip',
        risk: 'bounded-reversible',
        description: 'Rename an existing clip.',
        intentPhrases: ['rename clip'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip', promptRole: 'source' }],
        valueRules: [{ argument: 'name', kind: 'text-after-connector', connector: 'to' }],
        parameters: {
            properties: { clipId: { type: 'string' }, name: { type: 'string' } },
            required: ['clipId', 'name'],
        },
    },
    {
        actionType: 'trimClipStart',
        risk: 'bounded-reversible',
        description: 'Trim the start of an existing clip to an absolute beat.',
        intentPhrases: ['trim clip start', 'trim start'],
        targetRules: editableClipTargetRules,
        valueRules: [{ argument: 'newStartBeat', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: { clipId: { type: 'string' }, newStartBeat: { type: 'number', description: 'Absolute beat' } },
            required: ['clipId', 'newStartBeat'],
        },
    },
    {
        actionType: 'trimClipEnd',
        risk: 'bounded-reversible',
        description: 'Trim the end of an existing clip to an absolute beat.',
        intentPhrases: ['trim clip end', 'trim end'],
        targetRules: editableClipTargetRules,
        valueRules: [{ argument: 'newEndBeat', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: { clipId: { type: 'string' }, newEndBeat: { type: 'number', description: 'Absolute beat' } },
            required: ['clipId', 'newEndBeat'],
        },
    },
    {
        actionType: 'nudgeClip',
        risk: 'bounded-reversible',
        description: 'Move an existing clip by an explicit number of beats.',
        intentPhrases: ['nudge clip', 'nudge'],
        targetRules: editableClipTargetRules,
        valueRules: [{ argument: 'beats', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: { clipId: { type: 'string' }, beats: { type: 'number', description: 'Signed beat delta' } },
            required: ['clipId', 'beats'],
        },
    },
    {
        actionType: 'setClipGain',
        risk: 'bounded-reversible',
        description: 'Set an existing clip gain from 0.0 through 2.0.',
        intentPhrases: ['set clip gain', 'clip gain', 'set clip volume'],
        targetRules: editableClipTargetRules,
        valueRules: [{ argument: 'gain', kind: 'number-if-present', requiredInPrompt: true, scale: 'percentage-only' }],
        parameters: {
            properties: { clipId: { type: 'string' }, gain: { type: 'number', description: '0.0 to 2.0' } },
            required: ['clipId', 'gain'],
        },
    },
    {
        actionType: 'renameTrack',
        risk: 'bounded-reversible',
        description: 'Rename a track.',
        intentPhrases: ['rename'],
        targetRules: [{ argument: 'trackId', capability: 'track', promptRole: 'source' }],
        valueRules: [{ argument: 'name', kind: 'text-after-connector', connector: 'to' }],
        parameters: {
            properties: { trackId: { type: 'string' }, name: { type: 'string' } },
            required: ['trackId', 'name'],
        },
    },
    {
        actionType: 'muteTrack',
        risk: 'bounded-reversible',
        description: 'Mute or unmute a track.',
        intentPhrases: ['mute', 'unmute'],
        targetRules: trackTargetRules,
        valueRules: [
            {
                argument: 'muted',
                kind: 'boolean-intent',
                truePhrases: ['mute'],
                falsePhrases: ['unmute'],
            },
        ],
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
        intentPhrases: ['solo', 'unsolo'],
        targetRules: trackTargetRules,
        valueRules: [
            {
                argument: 'soloed',
                kind: 'boolean-intent',
                truePhrases: ['solo'],
                falsePhrases: ['unsolo'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string' },
                soloed: { type: 'boolean', description: 'true=solo, false=unsolo' },
            },
            required: ['trackId', 'soloed'],
        },
    },
    {
        actionType: 'armTrack',
        risk: 'authority-sensitive',
        description: 'Arm or disarm a track for recording.',
        intentPhrases: ['arm for recording', 'arm', 'disarm'],
        targetRules: [{ argument: 'trackId', capability: 'armable-track' }],
        valueRules: [
            {
                argument: 'armed',
                kind: 'boolean-intent',
                truePhrases: ['arm for recording', 'arm'],
                falsePhrases: ['disarm'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string' },
                armed: { type: 'boolean', description: 'true=arm, false=disarm' },
            },
            required: ['trackId', 'armed'],
        },
    },
    {
        actionType: 'duplicateTrack',
        risk: 'broad-reversible',
        description: 'Duplicate a track with all clips and devices.',
        intentPhrases: ['duplicate', 'copy'],
        targetRules: [{ argument: 'trackId', capability: 'duplicable-track' }],
        parameters: { properties: { trackId: { type: 'string' } }, required: ['trackId'] },
    },
    {
        actionType: 'setTrackGain',
        risk: 'bounded-reversible',
        description: 'Set track volume. 0.0=silence, 0.8=default, 1.0=max.',
        intentPhrases: ['gain', 'volume', 'louder', 'quieter', 'raise', 'lower', 'turn up', 'turn down'],
        targetRules: trackTargetRules,
        valueRules: [
            {
                argument: 'gain',
                kind: 'number-if-present',
                scale: 'unit-interval',
                qualitativeDirection: 'track-gain',
            },
        ],
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
        intentPhrases: ['pan', 'left', 'right', 'center'],
        targetRules: trackTargetRules,
        valueRules: [
            { argument: 'pan', kind: 'number-if-present', direction: 'pan', qualitativeDirection: 'track-pan' },
        ],
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
        intentPhrases: ['color', 'colour'],
        targetRules: trackTargetRules,
        valueRules: [{ argument: 'color', kind: 'string-literal' }],
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
        intentPhrases: ['reorder', 'move'],
        targetRules: trackTargetRules,
        valueRules: [{ argument: 'newIndex', kind: 'number-if-present' }],
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
        intentPhrases: ['set tempo', 'change tempo', 'tempo'],
        targetRules: [],
        valueRules: [{ argument: 'bpm', kind: 'number-if-present' }],
        parameters: { properties: { bpm: { type: 'number' } }, required: ['bpm'] },
    },
    {
        actionType: 'setTimeSignature',
        risk: 'authority-sensitive',
        description: 'Set the project time signature.',
        intentPhrases: [
            'set time signature',
            'set the time signature',
            'change time signature',
            'change the time signature',
            'set meter',
            'set the meter',
            'change meter',
            'change the meter',
        ],
        targetRules: [],
        valueRules: [{ argument: 'numerator', denominatorArgument: 'denominator', kind: 'time-signature' }],
        parameters: {
            properties: {
                numerator: { type: 'integer', description: 'Whole-number beat count from 1 through 32' },
                denominator: { type: 'integer', enum: [2, 4, 8, 16], description: 'Beat unit' },
            },
            required: ['numerator', 'denominator'],
        },
    },
    {
        actionType: 'setDeviceParameter',
        risk: 'bounded-reversible',
        description: 'Adjust a parameter on an existing device.',
        intentPhrases: ['adjust', 'set', 'change', 'increase', 'decrease'],
        targetRules: [
            { argument: 'deviceId', capability: 'device' },
            {
                argument: 'paramId',
                capability: 'device-parameter',
                dependsOn: 'deviceId',
            },
        ],
        valueRules: [{ argument: 'value', kind: 'number-if-present', qualitativeDirection: 'device-parameter' }],
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
        intentPhrases: ['bypass', 'enable', 'disable', 're-enable'],
        targetRules: [{ argument: 'deviceId', capability: 'device' }],
        valueRules: [
            {
                argument: 'bypassed',
                kind: 'boolean-intent',
                truePhrases: ['bypass', 'disable'],
                falsePhrases: ['enable', 're-enable'],
            },
        ],
        parameters: {
            properties: { deviceId: { type: 'string' }, bypassed: { type: 'boolean' } },
            required: ['deviceId', 'bypassed'],
        },
    },
    {
        actionType: 'addSend',
        risk: 'authority-sensitive',
        description: "Route a copy of a track's signal to a bus (parallel processing).",
        intentPhrases: ['add send', 'create send', 'send'],
        targetRules: sendTargetRules,
        valueRules: [{ argument: 'level', kind: 'number-if-present', scale: 'unit-interval' }],
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
        intentPhrases: ['adjust send', 'set send', 'change send'],
        targetRules: sendTargetRules,
        valueRules: [{ argument: 'level', kind: 'number-if-present', scale: 'unit-interval' }],
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
        intentPhrases: ['remove send', 'delete send', 'disconnect send'],
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
        intentPhrases: ['route', 'set output', 'output'],
        targetRules: [
            { argument: 'outputId', capability: 'output', promptRole: 'destination' },
            { argument: 'trackId', capability: 'routable-source', distinctFrom: 'outputId', promptRole: 'source' },
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
