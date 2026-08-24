import { FADER_GAIN_RANGE_DESCRIPTION, FADER_MAX_GAIN_LABEL } from '#/utils/audioLevelLaw';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { getMarkerColorNames } from '#/utils/markerColorPalette';

export type ExecutableAppActionRisk =
    'bounded-reversible' | 'broad-reversible' | 'destructive-reversible' | 'authority-sensitive' | 'external-effect';

export type ExecutableAppActionTargetCapability =
    | 'track'
    | 'armable-track'
    | 'duplicable-track'
    | 'removable-track'
    | 'routable-source'
    | 'bus'
    | 'output'
    | 'device-host-track'
    | 'device'
    | 'device-parameter'
    | 'adjustment-layer'
    | 'vca-group'
    | 'vca-member-track'
    | 'automation-lane'
    | 'clip'
    | 'editable-clip'
    | 'editable-audio-clip'
    | 'editable-midi-clip';

export type ExecutableAppActionTargetRule = {
    argument: string;
    capability: ExecutableAppActionTargetCapability;
    allowBatchLocal?: boolean;
    cardinality?: 'many';
    dependsOn?: string;
    distinctFrom?: string;
    promptRole?: 'source' | 'destination' | 'container' | 'members';
    optional?: boolean;
};

export type ExecutableAppActionMutationIdentityArgument = {
    argument: string;
    cardinality?: 'many';
};

export type ExecutableAppActionMutationIdentityRule = {
    arguments: readonly ExecutableAppActionMutationIdentityArgument[];
    fallbackArguments?: readonly ExecutableAppActionMutationIdentityArgument[];
    resourceFamily?: string;
    resourceReferenceOnly?: true;
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
          defaultWhenUnmentioned?: number;
          requiredInPrompt?: boolean;
          mayOmitWhenUnmentioned?: boolean;
          match?: 'exact';
          connector?: 'from' | 'to' | 'beat';
          keywords?: readonly string[];
          scale?: 'unit-interval' | 'percentage-only' | 'automation-lane-range';
          direction?: 'pan';
          qualitativeDirection?: 'track-gain' | 'track-pan' | 'device-parameter';
          unit?: 'beat-duration' | 'stretch-ratio';
      }
    | { argument: string; kind: 'string-literal' }
    | { argument: string; kind: 'marker-name' }
    | { argument: string; kind: 'marker-reference' }
    | { argument: string; kind: 'marker-beat' }
    | { argument: string; kind: 'marker-color'; values: readonly string[] }
    | { argument: string; kind: 'section-start-beat' }
    | { argument: string; kind: 'section-end-beat' }
    | { argument: string; kind: 'section-name' }
    | { argument: string; kind: 'section-reference' }
    | { argument: string; kind: 'section-new-name' }
    | {
          argument: string;
          kind: 'enum-if-present';
          values: readonly string[];
          aliases?: Readonly<Record<string, readonly string[]>>;
          requiredInPrompt?: boolean;
          defaultWhenUnmentioned?: string;
          mayOmitWhenUnmentioned?: boolean;
      }
    | {
          argument: string;
          kind: 'text-after-keyword-if-present';
          keywords: readonly string[];
          requiredInPrompt?: boolean;
          terminators?: readonly string[];
      }
    | { argument: string; denominatorArgument: string; kind: 'time-signature' };

const MARKER_COLOR_NAMES = getMarkerColorNames();

export type ExecutableAppActionDirectionalIntent = {
    carrierPhrases: readonly string[];
    truePhrases: readonly string[];
    falsePhrases: readonly string[];
};

type ExecutableAppActionDescriptor = {
    actionType: AppActionType;
    operationVersion?: number;
    risk: ExecutableAppActionRisk;
    description: string;
    intentPhrases: readonly string[];
    selectionPhrases?: readonly string[];
    directionalIntent?: ExecutableAppActionDirectionalIntent;
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

const existingTrackTargetRules = [
    { argument: 'trackId', capability: 'track', allowBatchLocal: false },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const clipTargetRules = [
    { argument: 'clipId', capability: 'clip' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const editableClipTargetRules = [
    { argument: 'clipId', capability: 'editable-clip' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const editableAudioClipTargetRules = [
    { argument: 'clipId', capability: 'editable-audio-clip' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const editableMidiClipTargetRules = [
    { argument: 'clipId', capability: 'editable-midi-clip' },
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

const sidechainTargetRules = [
    { argument: 'targetTrackId', capability: 'routable-source', promptRole: 'destination' },
    {
        argument: 'sourceTrackId',
        capability: 'routable-source',
        distinctFrom: 'targetTrackId',
        promptRole: 'source',
    },
] as const satisfies readonly ExecutableAppActionTargetRule[];

export const executableAppActionDescriptors = [
    {
        actionType: 'importStemSet',
        risk: 'broad-reversible',
        description:
            'Classify one exact application-selected stem set for application-owned tempo alignment, naming, grouping, and starting mix.',
        intentPhrases: ['import stems and create a starting mix'],
        targetRules: [],
        valueRules: [],
        parameters: {
            properties: {
                selectionId: { type: 'string', description: 'Exact application-owned selected-file set ID' },
                groupName: { type: 'string', minLength: 1, maxLength: 80 },
                stems: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 32,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            stemId: { type: 'string' },
                            role: {
                                type: 'string',
                                enum: [
                                    'kick',
                                    'snare',
                                    'hi-hat',
                                    'tom',
                                    'percussion',
                                    'bass',
                                    'guitar-left',
                                    'guitar-right',
                                    'keys',
                                    'synth',
                                    'lead-vocal',
                                    'backing-vocal',
                                    'fx',
                                    'other',
                                ],
                            },
                        },
                        required: ['stemId', 'role'],
                    },
                },
            },
            required: ['selectionId', 'groupName', 'stems'],
        },
    },
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
            properties: {
                name: { type: 'string', description: 'Display name for the new bus track' },
                binding: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9-]{0,63}$',
                    description:
                        'Optional plan-local name. Later calls may target this newly created bus as $<binding>.',
                },
            },
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
        actionType: 'addClip',
        risk: 'bounded-reversible',
        description: 'Create one empty MIDI clip on an existing MIDI track over an explicit beat range.',
        intentPhrases: ['add midi clip', 'add a midi clip', 'create midi clip', 'create a midi clip'],
        targetRules: [{ argument: 'trackId', capability: 'track', promptRole: 'container' }],
        valueRules: [
            { argument: 'startBeat', kind: 'number-if-present', requiredInPrompt: true, connector: 'from' },
            { argument: 'endBeat', kind: 'number-if-present', requiredInPrompt: true, connector: 'to' },
            {
                argument: 'name',
                kind: 'text-after-keyword-if-present',
                keywords: ['named', 'called'],
                requiredInPrompt: true,
                terminators: ['on', 'to', 'into', 'from'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing MIDI track ID' },
                startBeat: { type: 'number', minimum: 0, description: 'Non-negative absolute start beat' },
                endBeat: { type: 'number', minimum: 0, description: 'Absolute end beat, strictly after startBeat' },
                name: { type: 'string', description: 'Explicit clip name' },
            },
            required: ['trackId', 'startBeat', 'endBeat', 'name'],
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
        actionType: 'moveClip',
        risk: 'bounded-reversible',
        description: 'Move one unlocked clip to an absolute beat on an existing clip-host track.',
        intentPhrases: [
            'move clip',
            'move the clip',
            'move selected clip',
            'move the selected clip',
            'move current clip',
            'move the current clip',
            'move this clip',
        ],
        targetRules: [
            { argument: 'clipId', capability: 'editable-clip', promptRole: 'source' },
            { argument: 'trackId', capability: 'track', allowBatchLocal: false, promptRole: 'destination' },
        ],
        valueRules: [
            {
                argument: 'startBeat',
                kind: 'number-if-present',
                requiredInPrompt: true,
                connector: 'beat',
                match: 'exact',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked clip ID' },
                trackId: { type: 'string', description: 'Existing destination track ID that accepts clips' },
                startBeat: { type: 'number', minimum: 0, description: 'Non-negative absolute destination beat' },
            },
            required: ['clipId', 'trackId', 'startBeat'],
        },
    },
    {
        actionType: 'splitClip',
        risk: 'bounded-reversible',
        description:
            "Split one unlocked clip at an explicit absolute beat inside the clip. Audio clips split at the nearest zero crossing when the clip's audio buffer is available; otherwise they split at the requested beat.",
        intentPhrases: [
            'split clip',
            'split the clip',
            'split selected clip',
            'split the selected clip',
            'split current clip',
            'split the current clip',
            'split this clip',
            'cut clip',
            'cut the clip',
        ],
        targetRules: editableClipTargetRules,
        valueRules: [
            {
                argument: 'beat',
                kind: 'number-if-present',
                requiredInPrompt: true,
                connector: 'beat',
                match: 'exact',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked clip ID' },
                beat: {
                    type: 'number',
                    minimum: 0,
                    description:
                        'Absolute beat strictly inside the clip; audio uses the nearest zero crossing when the audio buffer is available, otherwise the requested beat',
                },
            },
            required: ['clipId', 'beat'],
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
        actionType: 'muteClip',
        risk: 'bounded-reversible',
        description: 'Mute or unmute an existing clip.',
        intentPhrases: ['mute clip', 'mute the clip', 'unmute clip', 'unmute the clip'],
        targetRules: editableClipTargetRules,
        valueRules: [
            {
                argument: 'muted',
                kind: 'boolean-intent',
                truePhrases: ['mute clip', 'mute the clip'],
                falsePhrases: ['unmute clip', 'unmute the clip'],
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked clip ID' },
                muted: { type: 'boolean', description: 'true=mute, false=unmute' },
            },
            required: ['clipId', 'muted'],
        },
    },
    {
        actionType: 'setClipColor',
        risk: 'bounded-reversible',
        description: 'Color-code an existing clip for visual organization.',
        intentPhrases: ['set clip color', 'set clip colour', 'color clip', 'colour clip'],
        targetRules: editableClipTargetRules,
        valueRules: [{ argument: 'color', kind: 'string-literal' }],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked clip ID' },
                color: { type: 'string', description: 'Six-digit hexadecimal color (for example #ff5500)' },
            },
            required: ['clipId', 'color'],
        },
    },
    {
        actionType: 'setClipFade',
        risk: 'bounded-reversible',
        description: 'Set explicit fade-in and fade-out durations on an existing clip.',
        intentPhrases: ['set clip fade', 'set clip fades'],
        targetRules: editableClipTargetRules,
        valueRules: [
            {
                argument: 'fadeInBeats',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                connector: 'from',
                keywords: ['fade in', 'fade-in'],
            },
            {
                argument: 'fadeOutBeats',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                connector: 'to',
                keywords: ['fade out', 'fade-out'],
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked clip ID' },
                fadeInBeats: {
                    type: 'number',
                    minimum: 0,
                    description: 'Non-negative fade-in duration no longer than half the clip',
                },
                fadeOutBeats: {
                    type: 'number',
                    minimum: 0,
                    description: 'Non-negative fade-out duration no longer than half the clip',
                },
            },
            required: ['clipId', 'fadeInBeats', 'fadeOutBeats'],
        },
    },
    {
        actionType: 'glueClips',
        risk: 'destructive-reversible',
        description: 'Replace exactly two adjacent plain MIDI clips with one reversible glued MIDI clip.',
        intentPhrases: [
            'glue clips',
            'glue the clips',
            'glue midi clips',
            'glue',
            'join clips',
            'join the clips',
            'join',
        ],
        targetRules: [
            {
                argument: 'clipIds',
                capability: 'editable-clip',
                cardinality: 'many',
            },
        ],
        parameters: {
            properties: {
                clipIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 2,
                    uniqueItems: true,
                    description: 'Exactly two distinct adjacent plain MIDI clip IDs on the same MIDI track',
                },
            },
            required: ['clipIds'],
        },
    },
    {
        actionType: 'crossfadeClips',
        risk: 'broad-reversible',
        description: 'Create a crossfade between two distinct unlocked clips.',
        intentPhrases: ['crossfade clips', 'crossfade clip', 'crossfade'],
        targetRules: [
            { argument: 'clipAId', capability: 'editable-clip', promptRole: 'source' },
            {
                argument: 'clipBId',
                capability: 'editable-clip',
                distinctFrom: 'clipAId',
                promptRole: 'destination',
            },
        ],
        valueRules: [
            {
                argument: 'durationBeats',
                kind: 'number-if-present',
                defaultWhenUnmentioned: 0.5,
                mayOmitWhenUnmentioned: true,
                match: 'exact',
            },
        ],
        parameters: {
            properties: {
                clipAId: { type: 'string', description: 'Existing unlocked source clip ID' },
                clipBId: { type: 'string', description: 'Existing unlocked destination clip ID' },
                durationBeats: {
                    type: 'number',
                    minimum: 0,
                    description: 'Optional non-negative crossfade duration in beats; defaults to 0.5',
                },
            },
            required: ['clipAId', 'clipBId'],
        },
    },
    {
        actionType: 'lockClip',
        risk: 'bounded-reversible',
        description: 'Lock or unlock an existing clip.',
        intentPhrases: ['lock clip', 'lock the clip', 'unlock clip', 'unlock the clip'],
        targetRules: clipTargetRules,
        valueRules: [
            {
                argument: 'locked',
                kind: 'boolean-intent',
                truePhrases: ['lock clip', 'lock the clip'],
                falsePhrases: ['unlock clip', 'unlock the clip'],
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing clip ID' },
                locked: { type: 'boolean', description: 'true=lock, false=unlock' },
            },
            required: ['clipId', 'locked'],
        },
    },
    {
        actionType: 'setClipLoop',
        risk: 'bounded-reversible',
        description: 'Enable or disable looping on an existing clip.',
        intentPhrases: ['enable clip loop', 'disable clip loop'],
        targetRules: editableClipTargetRules,
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable clip loop'],
                falsePhrases: ['disable clip loop'],
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked clip ID' },
                enabled: { type: 'boolean', description: 'true=enable looping, false=disable looping' },
            },
            required: ['clipId', 'enabled'],
        },
    },
    {
        actionType: 'setClipLoopLength',
        risk: 'bounded-reversible',
        description:
            'Set the explicit loop length in beats on one existing unlocked audio or MIDI clip without enabling looping or changing clip geometry.',
        intentPhrases: [
            'set clip loop length',
            'set the clip loop length',
            'set selected clip loop length',
            'change clip loop length',
            'change the clip loop length',
            'clip loop length',
        ],
        targetRules: editableClipTargetRules,
        valueRules: [
            {
                argument: 'loopLength',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                unit: 'beat-duration',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked audio or MIDI clip ID' },
                loopLength: {
                    type: 'number',
                    minimum: 1 / 480,
                    description: 'Explicit loop length in beats, at least one project tick',
                },
            },
            required: ['clipId', 'loopLength'],
        },
    },
    {
        actionType: 'normalizeClip',
        risk: 'destructive-reversible',
        description: 'Non-destructively normalize one unlocked audio clip.',
        intentPhrases: ['normalize clip', 'normalise clip', 'normalize the clip', 'normalise the clip'],
        targetRules: editableAudioClipTargetRules,
        valueRules: [
            {
                argument: 'mode',
                kind: 'enum-if-present',
                values: ['peak', 'rms', 'lufs'],
                defaultWhenUnmentioned: 'peak',
                mayOmitWhenUnmentioned: true,
            },
            {
                argument: 'targetDb',
                kind: 'number-if-present',
                defaultWhenUnmentioned: -14,
                mayOmitWhenUnmentioned: true,
                match: 'exact',
                connector: 'to',
                keywords: ['target', 'at'],
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked audio clip ID' },
                mode: {
                    type: 'string',
                    enum: ['peak', 'rms', 'lufs'],
                    description: 'Normalization measurement; defaults to peak',
                },
                targetDb: {
                    type: 'number',
                    minimum: -60,
                    maximum: 0,
                    description: 'Optional RMS or LUFS target from -60 through 0 dB; defaults to -14',
                },
            },
            required: ['clipId'],
        },
    },
    {
        actionType: 'setClipStretchMode',
        risk: 'broad-reversible',
        description: 'Set the playback stretch mode of one unlocked audio clip.',
        intentPhrases: [
            'set clip stretch mode',
            'set the clip stretch mode',
            'set clip to repitch',
            'set the clip to repitch',
            'set clip to timestretch',
            'set the clip to timestretch',
            'set clip stretch off',
            'set the clip stretch off',
        ],
        targetRules: editableAudioClipTargetRules,
        valueRules: [
            {
                argument: 'mode',
                kind: 'enum-if-present',
                values: ['off', 'repitch', 'timestretch'],
                aliases: {
                    repitch: ['re-pitch', 're pitch'],
                    timestretch: ['time-stretch', 'time stretch'],
                },
                requiredInPrompt: true,
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked audio clip ID' },
                mode: {
                    type: 'string',
                    enum: ['off', 'repitch', 'timestretch'],
                    description: 'Playback stretch mode',
                },
            },
            required: ['clipId', 'mode'],
        },
    },
    {
        actionType: 'setClipStretchRatio',
        risk: 'broad-reversible',
        description: 'Set the non-destructive time-stretch ratio of one unlocked audio clip.',
        intentPhrases: [
            'set clip stretch ratio',
            'set the clip stretch ratio',
            'time stretch clip',
            'time stretch the clip',
            'stretch clip',
        ],
        targetRules: editableAudioClipTargetRules,
        valueRules: [
            {
                argument: 'ratio',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                unit: 'stretch-ratio',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked audio clip ID' },
                ratio: {
                    type: 'number',
                    minimum: 0.25,
                    maximum: 4,
                    description: 'Time-stretch ratio from 0.25 through 4',
                },
            },
            required: ['clipId', 'ratio'],
        },
    },
    {
        actionType: 'fitClipToBeats',
        risk: 'broad-reversible',
        description: 'Fit one unlocked audio clip to an explicit duration in beats.',
        intentPhrases: [
            'fit clip to',
            'fit the clip to',
            'fit clip to beats',
            'fit the clip to beats',
            'fit clip duration',
            'fit the clip duration',
        ],
        targetRules: editableAudioClipTargetRules,
        valueRules: [
            {
                argument: 'targetBeats',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                unit: 'beat-duration',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked audio clip ID' },
                targetBeats: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    description: 'Target clip duration in beats; must be greater than 0',
                },
            },
            required: ['clipId', 'targetBeats'],
        },
    },
    {
        actionType: 'quantizeNotes',
        risk: 'destructive-reversible',
        description: 'Snap every note in one MIDI clip to an explicit beat grid.',
        intentPhrases: ['quantize notes', 'quantize midi', 'snap midi notes'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [{ argument: 'gridSize', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                gridSize: { type: 'number', description: 'Beat grid greater than 0 and at most 64' },
            },
            required: ['clipId', 'gridSize'],
        },
    },
    {
        actionType: 'removeShortMidiOverlaps',
        risk: 'broad-reversible',
        description:
            'Remove only same-pitch/channel MIDI note overlaps strictly below an explicit millisecond threshold in one selected clip.',
        intentPhrases: ['shorten overlaps', 'remove short midi overlaps', 'shorten midi overlaps'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [
            {
                argument: 'maximumOverlapMs',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Application-admitted selected MIDI clip ID' },
                maximumOverlapMs: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 1_000,
                    description: 'Strict millisecond overlap ceiling; equality is preserved',
                },
            },
            required: ['clipId', 'maximumOverlapMs'],
        },
    },
    {
        actionType: 'arpeggiate',
        risk: 'broad-reversible',
        description:
            'Add one application-projected offbeat arpeggio to an exact selected chord clip while preserving its source notes and chord boundaries.',
        intentPhrases: ['add a syncopated arpeggio'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Application-admitted selected MIDI chord clip ID' },
                pattern: { type: 'string', enum: ['up'] },
                rate: { type: 'number', enum: [8], description: 'Exact eighth-note rate' },
                octaves: { type: 'number', enum: [1], description: 'Preserve the absolute source voicing' },
                gate: { type: 'number', enum: [50], description: 'Half-step gate percentage' },
            },
            required: ['clipId', 'pattern', 'rate', 'octaves', 'gate'],
        },
    },
    {
        actionType: 'createDrumPreviewBranches',
        risk: 'broad-reversible',
        description:
            'Create exactly three app-owned preview branches for one admitted eight-bar drum section while preserving Kick and varying only Snare and Hi-Hat programming.',
        intentPhrases: ['create three drum arrangement candidates', 'create drum preview branches'],
        targetRules: [],
        valueRules: [],
        parameters: {
            properties: {
                sectionId: { type: 'string', description: 'Exact application-admitted eight-bar section ID' },
                candidateCount: { type: 'number', enum: [3], description: 'Exactly three candidates' },
                varyingRoles: {
                    type: 'array',
                    items: { type: 'string', enum: ['snare', 'hi-hat'] },
                    minItems: 2,
                    maxItems: 2,
                    uniqueItems: true,
                    description: 'Exact mutable drum roles, ordered Snare then Hi-Hat',
                },
            },
            required: ['sectionId', 'candidateCount', 'varyingRoles'],
        },
    },
    {
        actionType: 'copyMidiArticulations',
        risk: 'broad-reversible',
        description: 'Copy only per-note articulation between one exact pair of structurally matched MIDI clips.',
        intentPhrases: ['copy articulation', 'copy midi articulation', 'transfer articulation'],
        targetRules: [
            {
                argument: 'sourceClipId',
                capability: 'editable-midi-clip',
                promptRole: 'source',
            },
            {
                argument: 'targetClipId',
                capability: 'editable-midi-clip',
                promptRole: 'destination',
                distinctFrom: 'sourceClipId',
            },
        ],
        valueRules: [],
        parameters: {
            properties: {
                sourceClipId: { type: 'string', description: 'Application-admitted source MIDI clip ID' },
                targetClipId: { type: 'string', description: 'Application-admitted target MIDI clip ID' },
            },
            required: ['sourceClipId', 'targetClipId'],
        },
    },
    {
        actionType: 'transposeNotes',
        risk: 'broad-reversible',
        description: 'Transpose every note in one MIDI clip by an explicit semitone delta.',
        intentPhrases: ['transpose notes', 'transpose midi', 'shift midi notes', 'shift notes'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [{ argument: 'semitones', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                semitones: { type: 'integer', description: 'Non-zero semitone delta from -127 through 127' },
            },
            required: ['clipId', 'semitones'],
        },
    },
    {
        actionType: 'invertNotes',
        risk: 'broad-reversible',
        description: 'Invert every pitch in one MIDI clip around its current pitch range.',
        intentPhrases: [
            'invert midi notes',
            'invert the midi notes',
            'invert notes',
            'invert the notes',
            'mirror midi pitches',
        ],
        targetRules: editableMidiClipTargetRules,
        valueRules: [],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            },
            required: ['clipId'],
        },
    },
    {
        actionType: 'retrogradeNotes',
        risk: 'broad-reversible',
        description: 'Reverse every note in one MIDI clip across its current time range.',
        intentPhrases: [
            'retrograde midi notes',
            'retrograde the midi notes',
            'retrograde notes',
            'retrograde the notes',
            'reverse midi notes',
        ],
        targetRules: editableMidiClipTargetRules,
        valueRules: [],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            },
            required: ['clipId'],
        },
    },
    {
        actionType: 'quantizeNoteLengths',
        risk: 'destructive-reversible',
        description: 'Snap every note duration in one MIDI clip to an explicit beat grid.',
        intentPhrases: ['quantize note lengths', 'quantize midi note lengths', 'snap midi note lengths'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [{ argument: 'gridSize', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                gridSize: {
                    type: 'number',
                    minimum: 0.03125,
                    maximum: 64,
                    description: 'Beat grid from 0.03125 through 64',
                },
            },
            required: ['clipId', 'gridSize'],
        },
    },
    {
        actionType: 'scaleAllVelocities',
        risk: 'broad-reversible',
        description: 'Scale every note velocity in one MIDI clip by an explicit factor.',
        intentPhrases: ['scale midi velocities', 'scale note velocities', 'multiply midi velocities'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [
            {
                argument: 'factor',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                scale: 'percentage-only',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                factor: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 16,
                    description: 'Velocity factor greater than 0 and at most 16, excluding 1',
                },
            },
            required: ['clipId', 'factor'],
        },
    },
    {
        actionType: 'setAllVelocities',
        risk: 'destructive-reversible',
        description: 'Set every note velocity in one MIDI clip to an explicit MIDI value.',
        intentPhrases: ['set midi velocities', 'set note velocities', 'set all velocities'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [{ argument: 'velocity', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                velocity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 127,
                    description: 'MIDI velocity from 1 through 127',
                },
            },
            required: ['clipId', 'velocity'],
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
        actionType: 'setSoloSafe',
        risk: 'bounded-reversible',
        description: 'Enable or disable solo-safe protection for a track.',
        intentPhrases: ['enable solo safe', 'disable solo safe', 'make solo safe', 'remove solo safe'],
        targetRules: existingTrackTargetRules,
        valueRules: [
            {
                argument: 'soloSafe',
                kind: 'boolean-intent',
                truePhrases: ['enable solo safe', 'make solo safe'],
                falsePhrases: ['disable solo safe', 'remove solo safe'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string' },
                soloSafe: { type: 'boolean', description: 'true=enable solo safe, false=disable solo safe' },
            },
            required: ['trackId', 'soloSafe'],
        },
    },
    {
        actionType: 'clearSolos',
        risk: 'broad-reversible',
        description: 'Unsolo every currently soloed track.',
        intentPhrases: ['clear all solos', 'unsolo all tracks', 'unsolo everything'],
        targetRules: [],
        parameters: { properties: {}, required: [] },
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
        description: `Set track volume. 0.0=silence, 0.8=default, 1.0=unity, ${FADER_MAX_GAIN_LABEL}=max.`,
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
                gain: { type: 'number', description: FADER_GAIN_RANGE_DESCRIPTION },
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
        description:
            'Set the tempo in BPM. Range: 20–300. With a tempo map, edits the tempo event governing the playhead.',
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
        actionType: 'setPlayback',
        risk: 'authority-sensitive',
        description: 'Set transport playback to playing or paused.',
        intentPhrases: ['play', 'start playback', 'resume playback', 'pause', 'pause playback'],
        targetRules: [],
        valueRules: [
            {
                argument: 'playing',
                kind: 'boolean-intent',
                truePhrases: ['play', 'start playback', 'resume playback'],
                falsePhrases: ['pause', 'pause playback'],
            },
        ],
        parameters: {
            properties: {
                playing: { type: 'boolean', description: 'true=start or resume playback, false=pause playback' },
            },
            required: ['playing'],
        },
    },
    {
        actionType: 'stopPlayback',
        risk: 'authority-sensitive',
        description: 'Stop playback and return the playhead to the start.',
        intentPhrases: ['stop', 'stop playback', 'halt', 'halt playback'],
        targetRules: [],
        parameters: { properties: {}, required: [] },
    },
    {
        actionType: 'seekPlayhead',
        risk: 'authority-sensitive',
        description: 'Move the playhead to a specific nonnegative beat position.',
        intentPhrases: ['seek playhead', 'seek the playhead', 'move playhead', 'move the playhead'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'number-if-present', connector: 'beat', match: 'exact', requiredInPrompt: true },
        ],
        parameters: {
            properties: {
                beat: { type: 'number', minimum: 0, description: 'Beat position (bar 1 = beat 0)' },
            },
            required: ['beat'],
        },
    },
    {
        actionType: 'addMarker',
        risk: 'bounded-reversible',
        description: 'Add a named arrangement marker at a specific nonnegative beat.',
        intentPhrases: [
            'add marker',
            'add a marker',
            'create marker',
            'create a marker',
            'place marker',
            'place a marker',
        ],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'marker-beat' },
            { argument: 'name', kind: 'marker-name' },
        ],
        parameters: {
            properties: {
                beat: { type: 'number', minimum: 0, description: 'Marker beat position (bar 1 = beat 0)' },
                name: { type: 'string', description: 'Explicit marker label' },
            },
            required: ['beat', 'name'],
        },
    },
    {
        actionType: 'removeMarker',
        risk: 'destructive-reversible',
        description: 'Delete one existing arrangement marker identified by its exact beat and label.',
        intentPhrases: ['remove marker', 'remove the marker', 'delete marker', 'delete the marker'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'marker-beat' },
            { argument: 'name', kind: 'marker-reference' },
        ],
        parameters: {
            properties: {
                beat: { type: 'number', minimum: 0, description: 'Exact beat of the existing marker' },
                name: { type: 'string', description: 'Exact visible marker label' },
            },
            required: ['beat', 'name'],
        },
    },
    {
        actionType: 'setMarkerColor',
        risk: 'bounded-reversible',
        description: 'Set one existing arrangement marker to a named palette color.',
        intentPhrases: ['set marker color', 'set the marker color', 'change marker color', 'recolor marker'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'marker-beat' },
            { argument: 'name', kind: 'marker-reference' },
            { argument: 'color', kind: 'marker-color', values: MARKER_COLOR_NAMES },
        ],
        parameters: {
            properties: {
                beat: { type: 'number', minimum: 0, description: 'Exact beat of the existing marker' },
                name: { type: 'string', description: 'Exact visible marker label' },
                color: { type: 'string', enum: MARKER_COLOR_NAMES, description: 'Named marker palette color' },
            },
            required: ['beat', 'name', 'color'],
        },
    },
    {
        actionType: 'addSection',
        risk: 'bounded-reversible',
        description: 'Add a named arrangement section spanning one explicit beat range.',
        intentPhrases: ['add section', 'add a section', 'create section', 'create a section'],
        targetRules: [],
        valueRules: [
            { argument: 'startBeat', kind: 'section-start-beat' },
            { argument: 'endBeat', kind: 'section-end-beat' },
            { argument: 'name', kind: 'section-name' },
        ],
        parameters: {
            properties: {
                startBeat: { type: 'number', minimum: 0, description: 'Section start beat' },
                endBeat: { type: 'number', minimum: 0, description: 'Section end beat, strictly after startBeat' },
                name: { type: 'string', description: 'Explicit section label' },
            },
            required: ['startBeat', 'endBeat', 'name'],
        },
    },
    {
        actionType: 'removeSection',
        risk: 'destructive-reversible',
        description: 'Delete one existing arrangement section identified by its exact range and label.',
        intentPhrases: ['remove section', 'remove the section', 'delete section', 'delete the section'],
        targetRules: [],
        valueRules: [
            { argument: 'startBeat', kind: 'section-start-beat' },
            { argument: 'endBeat', kind: 'section-end-beat' },
            { argument: 'name', kind: 'section-reference' },
        ],
        parameters: {
            properties: {
                startBeat: { type: 'number', minimum: 0, description: 'Exact section start beat' },
                endBeat: { type: 'number', minimum: 0, description: 'Exact section end beat' },
                name: { type: 'string', description: 'Exact visible section label' },
            },
            required: ['startBeat', 'endBeat', 'name'],
        },
    },
    {
        actionType: 'renameSection',
        risk: 'bounded-reversible',
        description: 'Rename one existing arrangement section identified by its exact range and current label.',
        intentPhrases: ['rename section', 'rename the section'],
        targetRules: [],
        valueRules: [
            { argument: 'startBeat', kind: 'section-start-beat' },
            { argument: 'endBeat', kind: 'section-end-beat' },
            { argument: 'name', kind: 'section-reference' },
            { argument: 'newName', kind: 'section-new-name' },
        ],
        parameters: {
            properties: {
                startBeat: { type: 'number', minimum: 0, description: 'Exact section start beat' },
                endBeat: { type: 'number', minimum: 0, description: 'Exact section end beat' },
                name: { type: 'string', description: 'Exact current section label' },
                newName: { type: 'string', description: 'Explicit replacement section label' },
            },
            required: ['startBeat', 'endBeat', 'name', 'newName'],
        },
    },
    {
        actionType: 'setLoopEnabled',
        risk: 'bounded-reversible',
        description: 'Enable or disable the project loop.',
        intentPhrases: [
            'enable loop',
            'enable the loop',
            'enable looping',
            'disable loop',
            'disable the loop',
            'disable looping',
            'turn loop on',
            'turn loop off',
        ],
        targetRules: [],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable loop', 'enable the loop', 'enable looping', 'turn loop on'],
                falsePhrases: ['disable loop', 'disable the loop', 'disable looping', 'turn loop off'],
            },
        ],
        parameters: {
            properties: { enabled: { type: 'boolean', description: 'true=enable looping, false=disable looping' } },
            required: ['enabled'],
        },
    },
    {
        actionType: 'setLoopRegion',
        risk: 'bounded-reversible',
        description: 'Set project loop bounds without changing whether looping is enabled.',
        intentPhrases: ['set loop region', 'set the loop region', 'set loop', 'set the loop', 'change loop region'],
        targetRules: [],
        valueRules: [
            { argument: 'startBeat', kind: 'number-if-present', requiredInPrompt: true, connector: 'from' },
            { argument: 'endBeat', kind: 'number-if-present', requiredInPrompt: true, connector: 'to' },
        ],
        parameters: {
            properties: {
                startBeat: { type: 'number', description: 'Non-negative loop start beat' },
                endBeat: { type: 'number', description: 'Loop end beat, strictly after startBeat' },
            },
            required: ['startBeat', 'endBeat'],
        },
    },
    {
        actionType: 'setPunchIn',
        risk: 'authority-sensitive',
        description:
            'Set the punch-in endpoint at one explicit beat without changing whether punch recording is enabled.',
        intentPhrases: ['set punch in', 'set punch-in', 'move punch in', 'move punch-in'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'number-if-present', requiredInPrompt: true, match: 'exact', connector: 'beat' },
        ],
        parameters: {
            properties: {
                beat: {
                    type: 'number',
                    minimum: 0,
                    exclusiveMaximum: Number.MAX_VALUE,
                    description: 'Punch-in beat; may move punch-out later to preserve a valid region',
                },
            },
            required: ['beat'],
        },
    },
    {
        actionType: 'setPunchOut',
        risk: 'authority-sensitive',
        description:
            'Set the punch-out endpoint at one explicit beat without changing whether punch recording is enabled.',
        intentPhrases: ['set punch out', 'set punch-out', 'move punch out', 'move punch-out'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'number-if-present', requiredInPrompt: true, match: 'exact', connector: 'beat' },
        ],
        parameters: {
            properties: {
                beat: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: Number.MAX_VALUE,
                    description: 'Punch-out beat; may move punch-in earlier to preserve a valid region',
                },
            },
            required: ['beat'],
        },
    },
    {
        actionType: 'setPunchEnabled',
        risk: 'authority-sensitive',
        description:
            'Enable or disable Transport Punch In/Out until changed without changing the punch region or background capture.',
        intentPhrases: [
            'enable punch in/out',
            'disable punch in/out',
            'turn punch in/out on',
            'turn punch in/out off',
            'enable punch mode',
            'disable punch mode',
            'turn punch mode on',
            'turn punch mode off',
        ],
        targetRules: [],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable punch in/out', 'turn punch in/out on', 'enable punch mode', 'turn punch mode on'],
                falsePhrases: [
                    'disable punch in/out',
                    'turn punch in/out off',
                    'disable punch mode',
                    'turn punch mode off',
                ],
            },
        ],
        parameters: {
            properties: {
                enabled: {
                    type: 'boolean',
                    description: 'true=enable Transport Punch In/Out, false=disable; punch endpoints remain unchanged',
                },
            },
            required: ['enabled'],
        },
    },
    {
        actionType: 'setMetronomeEnabled',
        risk: 'bounded-reversible',
        description: 'Enable or disable the metronome.',
        intentPhrases: ['enable metronome', 'enable the metronome', 'disable metronome', 'disable the metronome'],
        targetRules: [],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable metronome', 'enable the metronome'],
                falsePhrases: ['disable metronome', 'disable the metronome'],
            },
        ],
        parameters: {
            properties: { enabled: { type: 'boolean', description: 'true=enable, false=disable' } },
            required: ['enabled'],
        },
    },
    {
        actionType: 'setMetronomeVolume',
        risk: 'bounded-reversible',
        description: 'Set metronome volume from 0.0 through 1.0.',
        intentPhrases: ['set metronome volume', 'set the metronome volume', 'change metronome volume'],
        targetRules: [],
        valueRules: [
            { argument: 'volume', kind: 'number-if-present', requiredInPrompt: true, scale: 'percentage-only' },
        ],
        parameters: {
            properties: { volume: { type: 'number', description: '0.0 to 1.0' } },
            required: ['volume'],
        },
    },
    {
        actionType: 'setMasterGain',
        risk: 'authority-sensitive',
        description: `Set master output gain from 0.0 through about ${FADER_MAX_GAIN_LABEL} (1.0 = unity, 0.8 = default).`,
        intentPhrases: [
            'set master gain',
            'set the master gain',
            'change master gain',
            'set master volume',
            'set the master volume',
            'change master volume',
        ],
        targetRules: [],
        valueRules: [{ argument: 'gain', kind: 'number-if-present', requiredInPrompt: true, scale: 'percentage-only' }],
        parameters: {
            properties: { gain: { type: 'number', description: FADER_GAIN_RANGE_DESCRIPTION } },
            required: ['gain'],
        },
    },
    {
        actionType: 'setVcaGain',
        risk: 'authority-sensitive',
        description: 'Set an existing VCA group gain from 0.0 through 2.0.',
        intentPhrases: [
            'set vca gain',
            'set the vca gain',
            'change vca gain',
            'set vca volume',
            'set the vca volume',
            'change vca volume',
        ],
        targetRules: [{ argument: 'vcaGroupId', capability: 'vca-group' }],
        valueRules: [{ argument: 'gain', kind: 'number-if-present', requiredInPrompt: true, scale: 'percentage-only' }],
        parameters: {
            properties: {
                vcaGroupId: { type: 'string', description: 'Existing VCA group ID' },
                gain: { type: 'number', description: '0.0 to 2.0' },
            },
            required: ['vcaGroupId', 'gain'],
        },
    },
    {
        actionType: 'createVcaGroup',
        risk: 'authority-sensitive',
        description: 'Create a named VCA group from one or more existing tracks.',
        intentPhrases: ['create vca group', 'add vca group'],
        targetRules: [
            {
                argument: 'trackIds',
                capability: 'vca-member-track',
                cardinality: 'many',
                promptRole: 'members',
            },
        ],
        valueRules: [
            {
                argument: 'name',
                kind: 'text-after-keyword-if-present',
                keywords: ['named', 'called'],
                requiredInPrompt: true,
            },
        ],
        parameters: {
            properties: {
                name: { type: 'string', description: 'Explicit new VCA group name' },
                trackIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Existing non-master track IDs to place in the VCA group',
                },
            },
            required: ['name', 'trackIds'],
        },
    },
    {
        actionType: 'assignToVca',
        risk: 'authority-sensitive',
        description: 'Assign one existing non-master track to an existing VCA group.',
        intentPhrases: ['assign'],
        targetRules: [
            { argument: 'vcaGroupId', capability: 'vca-group', allowBatchLocal: false, promptRole: 'destination' },
            { argument: 'trackId', capability: 'vca-member-track', allowBatchLocal: false, promptRole: 'source' },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing non-master track ID' },
                vcaGroupId: { type: 'string', description: 'Existing VCA group ID' },
            },
            required: ['trackId', 'vcaGroupId'],
        },
    },
    {
        actionType: 'removeFromVca',
        risk: 'authority-sensitive',
        description: 'Remove one existing non-master track from its current VCA group.',
        intentPhrases: ['unassign'],
        targetRules: [{ argument: 'trackId', capability: 'vca-member-track', allowBatchLocal: false }],
        parameters: {
            properties: { trackId: { type: 'string', description: 'Existing assigned non-master track ID' } },
            required: ['trackId'],
        },
    },

    {
        actionType: 'addDevice',
        risk: 'bounded-reversible',
        description: 'Insert a platform-available built-in device into a track device chain.',
        intentPhrases: ['add device', 'insert device', 'add plugin', 'insert plugin', 'add'],
        targetRules: [
            { argument: 'trackId', capability: 'device-host-track' },
            { argument: 'afterDeviceId', capability: 'device', dependsOn: 'trackId', optional: true },
        ],
        valueRules: [{ argument: 'deviceType', kind: 'string-literal' }],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID that accepts devices' },
                deviceType: { type: 'string', description: 'Available built-in device ID or unique display name' },
                afterDeviceId: { type: 'string', description: 'Existing device ID after which to insert' },
            },
            required: ['trackId', 'deviceType'],
        },
    },
    {
        actionType: 'removeDevice',
        risk: 'destructive-reversible',
        description: 'Remove an existing device from its track device chain.',
        intentPhrases: ['remove device', 'delete device', 'remove plugin', 'delete plugin', 'remove', 'delete'],
        targetRules: [{ argument: 'deviceId', capability: 'device' }],
        parameters: {
            properties: { deviceId: { type: 'string', description: 'Existing device ID' } },
            required: ['deviceId'],
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
        selectionPhrases: [
            'turn',
            'switch',
            'effect',
            'plugin',
            'reverb',
            'delay',
            'compressor',
            'equalizer',
            'distortion',
            'chorus',
        ],
        directionalIntent: {
            carrierPhrases: ['turn', 'switch'],
            truePhrases: ['off'],
            falsePhrases: ['on'],
        },
        targetRules: [{ argument: 'deviceId', capability: 'device' }],
        valueRules: [
            {
                argument: 'bypassed',
                kind: 'boolean-intent',
                truePhrases: ['bypass', 'disable', 'turn off', 'switch off'],
                falsePhrases: ['enable', 're-enable', 'turn on', 'switch on'],
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
                preFader: { type: 'boolean', description: 'False for a post-fader send; true for pre-fader' },
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
    {
        actionType: 'addSidechainRoute',
        risk: 'authority-sensitive',
        description:
            'Route one source track into a supported sidechain compressor on a distinct target track; use targetDeviceId when an app-owned capability enumerates an exact device.',
        intentPhrases: ['add sidechain', 'create sidechain', 'route sidechain', 'sidechain'],
        targetRules: sidechainTargetRules,
        parameters: {
            properties: {
                sourceTrackId: { type: 'string', description: 'Existing routable trigger track ID' },
                targetTrackId: { type: 'string', description: 'Distinct routable destination track ID' },
                targetDeviceId: { type: 'string', description: 'Exact app-scoped sidechain-capable device ID' },
            },
            required: ['sourceTrackId', 'targetTrackId'],
        },
    },
    {
        actionType: 'removeSidechainRoute',
        risk: 'authority-sensitive',
        description: 'Remove the single existing sidechain route between two distinct tracks.',
        intentPhrases: ['remove sidechain', 'delete sidechain', 'disconnect sidechain'],
        targetRules: sidechainTargetRules,
        parameters: {
            properties: {
                sourceTrackId: { type: 'string', description: 'Existing routable trigger track ID' },
                targetTrackId: { type: 'string', description: 'Distinct routable destination track ID' },
            },
            required: ['sourceTrackId', 'targetTrackId'],
        },
    },
    {
        actionType: 'addAdjustmentRegion',
        risk: 'bounded-reversible',
        description:
            'Add one app-grounded section region to an existing adjustment layer without changing its processing settings.',
        intentPhrases: ['copy the bass processing', 'copy bass processing'],
        targetRules: [{ argument: 'layerId', capability: 'adjustment-layer' }],
        valueRules: [],
        parameters: {
            properties: {
                layerId: { type: 'string', description: 'Exact app-grounded adjustment-layer ID' },
                startBeat: { type: 'number', minimum: 0 },
                endBeat: { type: 'number', exclusiveMinimum: 0 },
                blend: { type: 'number', minimum: 0, maximum: 1 },
                fadeInBeats: { type: 'number', minimum: 0 },
                fadeOutBeats: { type: 'number', minimum: 0 },
            },
            required: ['layerId', 'startBeat', 'endBeat', 'blend', 'fadeInBeats', 'fadeOutBeats'],
        },
    },
    {
        actionType: 'automateSendRange',
        risk: 'authority-sensitive',
        description: 'Lower an exact set of existing sends by a relative dB amount inside one named section.',
        intentPhrases: ['lower every vocal send', 'lower vocal sends', 'lower send', 'automate send'],
        targetRules: [
            {
                argument: 'trackIds',
                capability: 'routable-source',
                cardinality: 'many',
                dependsOn: 'busId',
                promptRole: 'source',
            },
            { argument: 'busId', capability: 'bus', promptRole: 'destination' },
        ],
        valueRules: [
            { argument: 'sectionName', kind: 'section-reference' },
            {
                argument: 'reductionDb',
                kind: 'number-if-present',
                requiredInPrompt: true,
            },
        ],
        parameters: {
            properties: {
                trackIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Every exact existing source track named by the request',
                },
                busId: { type: 'string', description: 'Existing destination bus ID' },
                sectionName: { type: 'string', description: 'Existing arrangement section name' },
                reductionDb: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 60,
                    description: 'Positive number of decibels to lower the sends inside the section',
                },
            },
            required: ['trackIds', 'busId', 'sectionName', 'reductionDb'],
        },
    },
    {
        actionType: 'automateTrackGainRange',
        risk: 'authority-sensitive',
        description:
            'Lift an app-grounded set of impact buses by a bounded relative dB amount inside one arrangement section.',
        intentPhrases: ['make the second chorus hit harder', 'second chorus hit harder'],
        targetRules: [
            {
                argument: 'trackIds',
                capability: 'routable-source',
                cardinality: 'many',
                promptRole: 'members',
            },
        ],
        valueRules: [],
        parameters: {
            properties: {
                trackIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Exact app-grounded impact-bus IDs',
                },
                sectionName: { type: 'string', description: 'Existing target chorus name' },
                gainDb: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 6,
                    description: 'Bounded decibel lift selected by the planning policy',
                },
            },
            required: ['trackIds', 'sectionName', 'gainDb'],
        },
    },
    {
        actionType: 'automateSendRanges',
        risk: 'authority-sensitive',
        description:
            'Ramp an exact set of sends to one bounded absolute dB level across the tail of exact arrangement sections.',
        intentPhrases: ['automate them to', 'final four bars of every chorus'],
        targetRules: [
            {
                argument: 'trackIds',
                capability: 'routable-source',
                cardinality: 'many',
                dependsOn: 'busId',
                promptRole: 'source',
            },
            { argument: 'busId', capability: 'bus', promptRole: 'destination' },
        ],
        valueRules: [],
        parameters: {
            properties: {
                trackIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Exact app-grounded source track IDs',
                },
                busId: { type: 'string', description: 'Earlier batch-local destination bus binding' },
                sectionIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Every exact app-grounded chorus section ID',
                },
                tailBars: { type: 'number', minimum: 1, maximum: 16 },
                targetLevelDb: { type: 'number', minimum: -60, maximum: 0 },
            },
            required: ['trackIds', 'busId', 'sectionIds', 'tailBars', 'targetLevelDb'],
        },
    },
    {
        actionType: 'renderProjectSections',
        risk: 'external-effect',
        description: 'Render exact arrangement sections to owner-local audio objects after project commit.',
        intentPhrases: ['render each chorus', 'render chorus', 'render section'],
        targetRules: [],
        valueRules: [],
        parameters: {
            properties: {
                sectionIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Every exact app-grounded arrangement section ID to render',
                },
            },
            required: ['sectionIds'],
        },
    },
    {
        actionType: 'addAutomationLane',
        risk: 'bounded-reversible',
        description: 'Create a gain or pan automation lane on an existing track.',
        intentPhrases: [
            'add automation lane',
            'create automation lane',
            'automate track gain',
            'automate track volume',
            'automate track pan',
            'automate track panning',
        ],
        targetRules: trackTargetRules,
        valueRules: [{ argument: 'parameterId', kind: 'string-literal' }],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID' },
                parameterId: {
                    type: 'string',
                    enum: ['gain', 'pan'],
                    description: 'Track parameter to automate',
                },
            },
            required: ['trackId', 'parameterId'],
        },
    },
    {
        actionType: 'addAutomationPoint',
        risk: 'bounded-reversible',
        description: 'Add a value at an explicit beat on an existing track automation lane.',
        intentPhrases: ['add automation point', 'create automation point', 'set automation point'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [
            { argument: 'beat', kind: 'number-if-present', requiredInPrompt: true, connector: 'beat' },
            { argument: 'value', kind: 'number-if-present', requiredInPrompt: true, scale: 'automation-lane-range' },
            {
                argument: 'curve',
                kind: 'enum-if-present',
                values: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'],
            },
        ],
        parameters: {
            properties: {
                laneId: { type: 'string', description: 'Existing track automation lane ID' },
                beat: { type: 'number', description: 'Non-negative project beat' },
                value: {
                    type: 'number',
                    description: 'Value within the selected lane minValue and maxValue bounds',
                },
                curve: {
                    type: 'string',
                    enum: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'],
                    description: 'Interpolation from this point to the next',
                },
            },
            required: ['laneId', 'beat', 'value'],
        },
    },
    {
        actionType: 'setAutomationLaneEnabled',
        risk: 'bounded-reversible',
        description: 'Enable or disable an existing track automation lane.',
        intentPhrases: [
            'enable automation lane',
            'enable automation',
            'disable automation lane',
            'disable automation',
            'turn automation on',
            'turn automation off',
        ],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable automation lane', 'enable automation', 'turn automation on'],
                falsePhrases: ['disable automation lane', 'disable automation', 'turn automation off'],
            },
        ],
        parameters: {
            properties: {
                laneId: { type: 'string', description: 'Existing track automation lane ID' },
                enabled: { type: 'boolean', description: 'true=enable, false=disable' },
            },
            required: ['laneId', 'enabled'],
        },
    },
    {
        actionType: 'setAutomationMode',
        risk: 'authority-sensitive',
        description: "Set an existing track's automation mode.",
        intentPhrases: [
            'set automation mode',
            'automation mode',
            'set to read',
            'set to write',
            'set to touch',
            'set to latch',
            'set to off',
            'turn automation mode off',
        ],
        targetRules: trackTargetRules,
        valueRules: [
            {
                argument: 'mode',
                kind: 'enum-if-present',
                values: ['read', 'write', 'touch', 'latch', 'off'],
                requiredInPrompt: true,
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID' },
                mode: { type: 'string', enum: ['read', 'write', 'touch', 'latch', 'off'] },
            },
            required: ['trackId', 'mode'],
        },
    },
    {
        actionType: 'scaleAutomation',
        risk: 'broad-reversible',
        description: 'Scale values on one existing track automation lane.',
        intentPhrases: ['scale automation', 'multiply automation values', 'amplify automation'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'factor', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: {
                laneId: { type: 'string', description: 'Existing track automation lane ID' },
                factor: { type: 'number', description: 'Greater than 0 and at most 16' },
            },
            required: ['laneId', 'factor'],
        },
    },
    {
        actionType: 'stretchAutomation',
        risk: 'broad-reversible',
        description: 'Stretch timing on one existing track automation lane.',
        intentPhrases: ['stretch automation', 'compress automation timing', 'expand automation timing'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'factor', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: {
                laneId: { type: 'string', description: 'Existing track automation lane ID' },
                factor: { type: 'number', description: 'Greater than 0 and at most 16' },
            },
            required: ['laneId', 'factor'],
        },
    },
    {
        actionType: 'invertAutomation',
        risk: 'broad-reversible',
        description: 'Invert values across one existing track automation lane range.',
        intentPhrases: ['invert automation', 'flip automation values'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        parameters: {
            properties: { laneId: { type: 'string', description: 'Existing track automation lane ID' } },
            required: ['laneId'],
        },
    },
    {
        actionType: 'reverseAutomation',
        risk: 'broad-reversible',
        description: 'Reverse the timing of one existing track automation lane.',
        intentPhrases: ['reverse automation', 'reverse automation timing'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        parameters: {
            properties: { laneId: { type: 'string', description: 'Existing track automation lane ID' } },
            required: ['laneId'],
        },
    },
    {
        actionType: 'thinAutomation',
        risk: 'destructive-reversible',
        description: 'Reduce redundant points on one existing track automation lane.',
        intentPhrases: ['thin automation', 'simplify automation', 'reduce automation points'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'tolerance', kind: 'number-if-present', mayOmitWhenUnmentioned: true }],
        parameters: {
            properties: {
                laneId: { type: 'string', description: 'Existing track automation lane ID' },
                tolerance: { type: 'number', description: 'Optional positive tolerance within the lane value span' },
            },
            required: ['laneId'],
        },
    },
    {
        actionType: 'quantizeAutomation',
        risk: 'destructive-reversible',
        description: 'Snap point timing on one existing track automation lane to a beat grid.',
        intentPhrases: ['quantize automation', 'snap automation', 'quantize automation timing'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'gridSize', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: {
                laneId: { type: 'string', description: 'Existing track automation lane ID' },
                gridSize: { type: 'number', description: 'Beat grid greater than 0 and at most 64' },
            },
            required: ['laneId', 'gridSize'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];

type Simplify<Value> = { [Key in keyof Value]: Value[Key] };

type RequiredSchemaKey<Schema extends { properties: Record<string, unknown> }> = Extract<
    Schema extends { required: readonly (infer Required)[] } ? Required : never,
    keyof Schema['properties']
>;

type OptionalSchemaKey<Schema extends { properties: Record<string, unknown> }> = Exclude<
    keyof Schema['properties'],
    RequiredSchemaKey<Schema>
>;

type InferJsonSchemaObject<Schema extends { properties: Record<string, unknown> }> = Simplify<
    { [Key in RequiredSchemaKey<Schema>]-?: InferJsonSchema<Schema['properties'][Key]> } & {
        [Key in OptionalSchemaKey<Schema>]?: InferJsonSchema<Schema['properties'][Key]>;
    }
>;

type InferJsonSchema<Schema> = Schema extends { enum: readonly (infer Value)[] }
    ? Value
    : Schema extends { type: 'string' }
      ? string
      : Schema extends { type: 'number' | 'integer' }
        ? number
        : Schema extends { type: 'boolean' }
          ? boolean
          : Schema extends { type: 'array'; items: infer Item }
            ? InferJsonSchema<Item>[]
            : Schema extends { type: 'object'; properties: infer Properties extends Record<string, unknown> }
              ? InferJsonSchemaObject<Schema & { properties: Properties }>
              : never;

type DescriptorAction<Descriptor> = Descriptor extends {
    actionType: infer ActionType extends AppActionType;
    parameters: infer Parameters extends { properties: Record<string, unknown> };
}
    ? { type: ActionType; payload: InferJsonSchemaObject<Parameters> }
    : never;

export type ExecutableAppActionType = (typeof executableAppActionDescriptors)[number]['actionType'];
export type ExecutableProviderAction = DescriptorAction<(typeof executableAppActionDescriptors)[number]>;
export type ExecutableAppAction = Extract<AppAction, { type: ExecutableAppActionType }>;

const NO_MUTATION_IDENTITY = [] as const;
const SINGLETON_MUTATION_IDENTITY = [{ arguments: [] }] as const;
const TRACK_MUTATION_IDENTITY = [{ arguments: [{ argument: 'trackId' }], resourceFamily: 'track' }] as const;
const TRACK_RESOURCE_REFERENCE_IDENTITY = [
    { arguments: [{ argument: 'trackId' }], resourceFamily: 'track', resourceReferenceOnly: true },
] as const;
const CLIP_MUTATION_IDENTITY = [{ arguments: [{ argument: 'clipId' }], resourceFamily: 'clip' }] as const;
const MANY_CLIPS_MUTATION_IDENTITY = [{ arguments: [{ argument: 'clipIds', cardinality: 'many' }] }] as const;
const DEVICE_MUTATION_IDENTITY = [{ arguments: [{ argument: 'deviceId' }], resourceFamily: 'device' }] as const;
const DEVICE_PARAMETER_MUTATION_IDENTITY = [
    { arguments: [{ argument: 'deviceId' }, { argument: 'paramId' }] },
] as const;
const SEND_MUTATION_IDENTITY = [
    { arguments: [{ argument: 'trackId' }, { argument: 'busId' }], resourceFamily: 'send' },
] as const;
const TRACK_OUTPUT_MUTATION_IDENTITY = [
    ...TRACK_MUTATION_IDENTITY,
    {
        arguments: [{ argument: 'outputId' }],
        resourceFamily: 'track',
        resourceReferenceOnly: true,
    },
] as const;
const AUTOMATED_SEND_MUTATION_IDENTITY = [
    {
        arguments: [{ argument: 'trackIds', cardinality: 'many' }, { argument: 'busId' }],
    },
] as const;
const AUTOMATED_TRACK_MUTATION_IDENTITY = [{ arguments: [{ argument: 'trackIds', cardinality: 'many' }] }] as const;
const AUTOMATION_LANE_MUTATION_IDENTITY = [{ arguments: [{ argument: 'laneId' }] }] as const;
const AUTOMATION_LANE_CREATION_IDENTITY = [
    { arguments: [{ argument: 'trackId' }, { argument: 'parameterId' }] },
] as const;
const MARKER_REFERENCE_MUTATION_IDENTITY = [
    { arguments: [{ argument: 'beat' }, { argument: 'name' }], resourceFamily: 'marker' },
] as const;
const SECTION_REFERENCE_MUTATION_IDENTITY = [
    {
        arguments: [{ argument: 'startBeat' }, { argument: 'endBeat' }, { argument: 'name' }],
        resourceFamily: 'section',
    },
] as const;
const SIDECHAIN_ROUTE_RESOURCE_REFERENCE_IDENTITY = [
    {
        arguments: [{ argument: 'sourceTrackId' }, { argument: 'targetTrackId' }],
        resourceFamily: 'sidechain-route',
        resourceReferenceOnly: true,
    },
] as const;
const ADD_SIDECHAIN_ROUTE_MUTATION_IDENTITY = [
    {
        arguments: [{ argument: 'sourceTrackId' }, { argument: 'targetDeviceId' }],
        fallbackArguments: [{ argument: 'sourceTrackId' }, { argument: 'targetTrackId' }],
    },
    ...SIDECHAIN_ROUTE_RESOURCE_REFERENCE_IDENTITY,
] as const;

export const executableAppActionMutationIdentityRulesByType = {
    importStemSet: NO_MUTATION_IDENTITY,
    addTrack: NO_MUTATION_IDENTITY,
    createBus: NO_MUTATION_IDENTITY,
    removeTrack: TRACK_MUTATION_IDENTITY,
    addClip: TRACK_RESOURCE_REFERENCE_IDENTITY,
    duplicateClip: CLIP_MUTATION_IDENTITY,
    duplicateClipToNextBar: CLIP_MUTATION_IDENTITY,
    removeClip: CLIP_MUTATION_IDENTITY,
    moveClip: CLIP_MUTATION_IDENTITY,
    splitClip: CLIP_MUTATION_IDENTITY,
    renameClip: CLIP_MUTATION_IDENTITY,
    trimClipStart: CLIP_MUTATION_IDENTITY,
    trimClipEnd: CLIP_MUTATION_IDENTITY,
    nudgeClip: CLIP_MUTATION_IDENTITY,
    setClipGain: CLIP_MUTATION_IDENTITY,
    muteClip: CLIP_MUTATION_IDENTITY,
    setClipColor: CLIP_MUTATION_IDENTITY,
    setClipFade: CLIP_MUTATION_IDENTITY,
    glueClips: MANY_CLIPS_MUTATION_IDENTITY,
    crossfadeClips: [{ arguments: [{ argument: 'clipAId' }] }, { arguments: [{ argument: 'clipBId' }] }],
    lockClip: CLIP_MUTATION_IDENTITY,
    setClipLoop: CLIP_MUTATION_IDENTITY,
    setClipLoopLength: CLIP_MUTATION_IDENTITY,
    normalizeClip: CLIP_MUTATION_IDENTITY,
    setClipStretchMode: CLIP_MUTATION_IDENTITY,
    setClipStretchRatio: CLIP_MUTATION_IDENTITY,
    fitClipToBeats: CLIP_MUTATION_IDENTITY,
    quantizeNotes: CLIP_MUTATION_IDENTITY,
    removeShortMidiOverlaps: CLIP_MUTATION_IDENTITY,
    arpeggiate: CLIP_MUTATION_IDENTITY,
    createDrumPreviewBranches: NO_MUTATION_IDENTITY,
    copyMidiArticulations: [{ arguments: [{ argument: 'targetClipId' }] }],
    transposeNotes: CLIP_MUTATION_IDENTITY,
    invertNotes: CLIP_MUTATION_IDENTITY,
    retrogradeNotes: CLIP_MUTATION_IDENTITY,
    quantizeNoteLengths: CLIP_MUTATION_IDENTITY,
    scaleAllVelocities: CLIP_MUTATION_IDENTITY,
    setAllVelocities: CLIP_MUTATION_IDENTITY,
    renameTrack: TRACK_MUTATION_IDENTITY,
    muteTrack: TRACK_MUTATION_IDENTITY,
    soloTrack: TRACK_MUTATION_IDENTITY,
    setSoloSafe: TRACK_MUTATION_IDENTITY,
    clearSolos: SINGLETON_MUTATION_IDENTITY,
    armTrack: TRACK_MUTATION_IDENTITY,
    duplicateTrack: TRACK_MUTATION_IDENTITY,
    setTrackGain: TRACK_MUTATION_IDENTITY,
    setTrackPan: TRACK_MUTATION_IDENTITY,
    setTrackColor: TRACK_MUTATION_IDENTITY,
    reorderTrack: TRACK_MUTATION_IDENTITY,
    setTempo: SINGLETON_MUTATION_IDENTITY,
    setTimeSignature: SINGLETON_MUTATION_IDENTITY,
    setPlayback: SINGLETON_MUTATION_IDENTITY,
    stopPlayback: SINGLETON_MUTATION_IDENTITY,
    seekPlayhead: SINGLETON_MUTATION_IDENTITY,
    addMarker: NO_MUTATION_IDENTITY,
    removeMarker: MARKER_REFERENCE_MUTATION_IDENTITY,
    setMarkerColor: MARKER_REFERENCE_MUTATION_IDENTITY,
    addSection: NO_MUTATION_IDENTITY,
    removeSection: SECTION_REFERENCE_MUTATION_IDENTITY,
    renameSection: SECTION_REFERENCE_MUTATION_IDENTITY,
    setLoopEnabled: SINGLETON_MUTATION_IDENTITY,
    setLoopRegion: SINGLETON_MUTATION_IDENTITY,
    setPunchIn: SINGLETON_MUTATION_IDENTITY,
    setPunchOut: SINGLETON_MUTATION_IDENTITY,
    setPunchEnabled: SINGLETON_MUTATION_IDENTITY,
    setMetronomeEnabled: SINGLETON_MUTATION_IDENTITY,
    setMetronomeVolume: SINGLETON_MUTATION_IDENTITY,
    setMasterGain: SINGLETON_MUTATION_IDENTITY,
    setVcaGain: [{ arguments: [{ argument: 'vcaGroupId' }] }],
    createVcaGroup: [{ arguments: [{ argument: 'trackIds', cardinality: 'many' }] }],
    assignToVca: TRACK_MUTATION_IDENTITY,
    removeFromVca: TRACK_MUTATION_IDENTITY,
    addDevice: TRACK_RESOURCE_REFERENCE_IDENTITY,
    removeDevice: DEVICE_MUTATION_IDENTITY,
    setDeviceParameter: DEVICE_PARAMETER_MUTATION_IDENTITY,
    bypassDevice: DEVICE_MUTATION_IDENTITY,
    addSend: SEND_MUTATION_IDENTITY,
    setSend: SEND_MUTATION_IDENTITY,
    removeSend: SEND_MUTATION_IDENTITY,
    setTrackOutput: TRACK_OUTPUT_MUTATION_IDENTITY,
    addSidechainRoute: ADD_SIDECHAIN_ROUTE_MUTATION_IDENTITY,
    removeSidechainRoute: SIDECHAIN_ROUTE_RESOURCE_REFERENCE_IDENTITY,
    addAdjustmentRegion: NO_MUTATION_IDENTITY,
    automateSendRange: AUTOMATED_SEND_MUTATION_IDENTITY,
    automateTrackGainRange: AUTOMATED_TRACK_MUTATION_IDENTITY,
    automateSendRanges: AUTOMATED_SEND_MUTATION_IDENTITY,
    renderProjectSections: NO_MUTATION_IDENTITY,
    addAutomationLane: AUTOMATION_LANE_CREATION_IDENTITY,
    addAutomationPoint: NO_MUTATION_IDENTITY,
    setAutomationLaneEnabled: AUTOMATION_LANE_MUTATION_IDENTITY,
    setAutomationMode: TRACK_MUTATION_IDENTITY,
    scaleAutomation: AUTOMATION_LANE_MUTATION_IDENTITY,
    stretchAutomation: AUTOMATION_LANE_MUTATION_IDENTITY,
    invertAutomation: AUTOMATION_LANE_MUTATION_IDENTITY,
    reverseAutomation: AUTOMATION_LANE_MUTATION_IDENTITY,
    thinAutomation: AUTOMATION_LANE_MUTATION_IDENTITY,
    quantizeAutomation: AUTOMATION_LANE_MUTATION_IDENTITY,
} as const satisfies Record<ExecutableAppActionType, readonly ExecutableAppActionMutationIdentityRule[]>;

export const executableAppActionMutationIdempotenceByType = {
    importStemSet: false,
    addTrack: false,
    createBus: false,
    removeTrack: false,
    addClip: false,
    duplicateClip: false,
    duplicateClipToNextBar: false,
    removeClip: false,
    moveClip: false,
    splitClip: false,
    renameClip: false,
    trimClipStart: false,
    trimClipEnd: false,
    nudgeClip: false,
    setClipGain: true,
    muteClip: true,
    setClipColor: true,
    setClipFade: true,
    glueClips: false,
    crossfadeClips: false,
    lockClip: true,
    setClipLoop: true,
    setClipLoopLength: true,
    normalizeClip: false,
    setClipStretchMode: true,
    setClipStretchRatio: true,
    fitClipToBeats: false,
    quantizeNotes: false,
    removeShortMidiOverlaps: false,
    arpeggiate: false,
    createDrumPreviewBranches: false,
    copyMidiArticulations: false,
    transposeNotes: false,
    invertNotes: false,
    retrogradeNotes: false,
    quantizeNoteLengths: false,
    scaleAllVelocities: false,
    setAllVelocities: true,
    renameTrack: false,
    muteTrack: true,
    soloTrack: true,
    setSoloSafe: true,
    clearSolos: false,
    armTrack: true,
    duplicateTrack: false,
    setTrackGain: true,
    setTrackPan: true,
    setTrackColor: true,
    reorderTrack: false,
    setTempo: true,
    setTimeSignature: true,
    setPlayback: true,
    stopPlayback: false,
    seekPlayhead: false,
    addMarker: false,
    removeMarker: false,
    setMarkerColor: true,
    addSection: false,
    removeSection: false,
    renameSection: false,
    setLoopEnabled: true,
    setLoopRegion: true,
    setPunchIn: true,
    setPunchOut: true,
    setPunchEnabled: true,
    setMetronomeEnabled: true,
    setMetronomeVolume: true,
    setMasterGain: true,
    setVcaGain: true,
    createVcaGroup: false,
    assignToVca: false,
    removeFromVca: false,
    addDevice: false,
    removeDevice: false,
    setDeviceParameter: true,
    bypassDevice: true,
    addSend: false,
    setSend: true,
    removeSend: false,
    setTrackOutput: true,
    addSidechainRoute: false,
    removeSidechainRoute: false,
    addAdjustmentRegion: false,
    automateSendRange: false,
    automateTrackGainRange: false,
    automateSendRanges: false,
    renderProjectSections: false,
    addAutomationLane: false,
    addAutomationPoint: false,
    setAutomationLaneEnabled: true,
    setAutomationMode: true,
    scaleAutomation: false,
    stretchAutomation: false,
    invertAutomation: false,
    reverseAutomation: false,
    thinAutomation: false,
    quantizeAutomation: false,
} as const satisfies Record<ExecutableAppActionType, boolean>;

export const executableAppActionDescriptorByType: ReadonlyMap<string, (typeof executableAppActionDescriptors)[number]> =
    new Map(executableAppActionDescriptors.map((descriptor) => [descriptor.actionType, descriptor]));

export function isExecutableAppActionType(actionType: string): actionType is ExecutableAppActionType {
    return executableAppActionDescriptorByType.has(actionType);
}
