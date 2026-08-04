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
    | 'device-host-track'
    | 'device'
    | 'device-parameter'
    | 'vca-group'
    | 'vca-member-track'
    | 'automation-lane'
    | 'clip'
    | 'editable-clip'
    | 'editable-midi-clip';

export type ExecutableAppActionTargetRule = {
    argument: string;
    capability: ExecutableAppActionTargetCapability;
    allowBatchLocal?: boolean;
    cardinality?: 'many';
    dependsOn?: string;
    distinctFrom?: string;
    promptRole?: 'source' | 'destination' | 'members';
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
      }
    | { argument: string; kind: 'string-literal' }
    | { argument: string; kind: 'enum-if-present'; values: readonly string[]; requiredInPrompt?: boolean }
    | {
          argument: string;
          kind: 'text-after-keyword-if-present';
          keywords: readonly string[];
          requiredInPrompt?: boolean;
      }
    | { argument: string; denominatorArgument: string; kind: 'time-signature' };

export type ExecutableAppActionDirectionalIntent = {
    carrierPhrases: readonly string[];
    truePhrases: readonly string[];
    falsePhrases: readonly string[];
};

type ExecutableAppActionDescriptor = {
    actionType: AppActionType;
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
        description: 'Set master output gain from 0.0 through 1.0.',
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
            properties: { gain: { type: 'number', description: '0.0 to 1.0' } },
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
        description: 'Insert a platform-available built-in device at the end of a track device chain.',
        intentPhrases: ['add device', 'insert device', 'add plugin', 'insert plugin', 'add'],
        targetRules: [{ argument: 'trackId', capability: 'device-host-track' }],
        valueRules: [{ argument: 'deviceType', kind: 'string-literal' }],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID that accepts devices' },
                deviceType: { type: 'string', description: 'Available built-in device ID or unique display name' },
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
            'Route one source track into the single supported sidechain compressor on a distinct target track.',
        intentPhrases: ['add sidechain', 'create sidechain', 'route sidechain', 'sidechain'],
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

export const executableAppActionDescriptorByType: ReadonlyMap<string, (typeof executableAppActionDescriptors)[number]> =
    new Map(executableAppActionDescriptors.map((descriptor) => [descriptor.actionType, descriptor]));
