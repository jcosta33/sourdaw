import { describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { getExecutableAppActionGroundingRules } from '../getExecutableAppActionGroundingRules';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';

type ExpectedCommandArgs = [string, string, Record<string, unknown>, string[], string, boolean];

function expectedCommand(...args: ExpectedCommandArgs) {
    const [name, description, properties, required, risk, requiresConfirmation] = args;
    return [name, description, properties, required, false, 'explicit', risk, requiresConfirmation] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EXPECTED_COMMANDS = [
    expectedCommand(
        'addTrack',
        'Create a new track in the session.',
        {
            name: { type: 'string', description: 'Display name (e.g. "Kick", "Vocals", "Synth Pad")' },
            kind: { type: 'string', enum: ['audio', 'midi', 'folder'], description: 'Track type' },
        },
        ['name', 'kind'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'createBus',
        'Create a new bus track in the session.',
        {
            name: { type: 'string', description: 'Display name for the new bus track' },
            binding: {
                type: 'string',
                pattern: '^[a-z][a-z0-9-]{0,63}$',
                description: 'Optional plan-local name. Later calls may target this newly created bus as $<binding>.',
            },
        },
        ['name'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'removeTrack',
        'Delete a track and its project-owned contents.',
        { trackId: { type: 'string', description: 'Existing non-master track ID' } },
        ['trackId'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'duplicateClip',
        'Duplicate an existing clip immediately after itself.',
        { clipId: { type: 'string', description: 'Existing clip ID' } },
        ['clipId'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'duplicateClipToNextBar',
        'Duplicate an existing clip at the next bar boundary.',
        { clipId: { type: 'string', description: 'Existing clip ID' } },
        ['clipId'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'removeClip',
        'Delete a clip and its project-owned MIDI data.',
        { clipId: { type: 'string', description: 'Existing unlocked clip ID' } },
        ['clipId'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'renameClip',
        'Rename an existing clip.',
        { clipId: { type: 'string' }, name: { type: 'string' } },
        ['clipId', 'name'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'trimClipStart',
        'Trim the start of an existing clip to an absolute beat.',
        { clipId: { type: 'string' }, newStartBeat: { type: 'number', description: 'Absolute beat' } },
        ['clipId', 'newStartBeat'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'trimClipEnd',
        'Trim the end of an existing clip to an absolute beat.',
        { clipId: { type: 'string' }, newEndBeat: { type: 'number', description: 'Absolute beat' } },
        ['clipId', 'newEndBeat'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'nudgeClip',
        'Move an existing clip by an explicit number of beats.',
        {
            clipId: { type: 'string' },
            beats: { type: 'number', description: 'Signed beat delta' },
        },
        ['clipId', 'beats'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setClipGain',
        'Set an existing clip gain from 0.0 through 2.0.',
        {
            clipId: { type: 'string' },
            gain: { type: 'number', description: '0.0 to 2.0' },
        },
        ['clipId', 'gain'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'muteClip',
        'Mute or unmute an existing clip.',
        {
            clipId: { type: 'string', description: 'Existing unlocked clip ID' },
            muted: { type: 'boolean', description: 'true=mute, false=unmute' },
        },
        ['clipId', 'muted'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setClipColor',
        'Color-code an existing clip for visual organization.',
        {
            clipId: { type: 'string', description: 'Existing unlocked clip ID' },
            color: { type: 'string', description: 'Six-digit hexadecimal color (for example #ff5500)' },
        },
        ['clipId', 'color'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setClipFade',
        'Set explicit fade-in and fade-out durations on an existing clip.',
        {
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
        ['clipId', 'fadeInBeats', 'fadeOutBeats'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'crossfadeClips',
        'Create a crossfade between two distinct unlocked clips.',
        {
            clipAId: { type: 'string', description: 'Existing unlocked source clip ID' },
            clipBId: { type: 'string', description: 'Existing unlocked destination clip ID' },
            durationBeats: {
                type: 'number',
                minimum: 0,
                description: 'Optional non-negative crossfade duration in beats; defaults to 0.5',
            },
        },
        ['clipAId', 'clipBId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'lockClip',
        'Lock or unlock an existing clip.',
        {
            clipId: { type: 'string', description: 'Existing clip ID' },
            locked: { type: 'boolean', description: 'true=lock, false=unlock' },
        },
        ['clipId', 'locked'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setClipLoop',
        'Enable or disable looping on an existing clip.',
        {
            clipId: { type: 'string', description: 'Existing unlocked clip ID' },
            enabled: { type: 'boolean', description: 'true=enable looping, false=disable looping' },
        },
        ['clipId', 'enabled'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'quantizeNotes',
        'Snap every note in one MIDI clip to an explicit beat grid.',
        {
            clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            gridSize: { type: 'number', description: 'Beat grid greater than 0 and at most 64' },
        },
        ['clipId', 'gridSize'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'transposeNotes',
        'Transpose every note in one MIDI clip by an explicit semitone delta.',
        {
            clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            semitones: { type: 'integer', description: 'Non-zero semitone delta from -127 through 127' },
        },
        ['clipId', 'semitones'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'invertNotes',
        'Invert every pitch in one MIDI clip around its current pitch range.',
        { clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' } },
        ['clipId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'retrogradeNotes',
        'Reverse every note in one MIDI clip across its current time range.',
        { clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' } },
        ['clipId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'quantizeNoteLengths',
        'Snap every note duration in one MIDI clip to an explicit beat grid.',
        {
            clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            gridSize: {
                type: 'number',
                minimum: 0.03125,
                maximum: 64,
                description: 'Beat grid from 0.03125 through 64',
            },
        },
        ['clipId', 'gridSize'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'scaleAllVelocities',
        'Scale every note velocity in one MIDI clip by an explicit factor.',
        {
            clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            factor: {
                type: 'number',
                exclusiveMinimum: 0,
                maximum: 16,
                description: 'Velocity factor greater than 0 and at most 16, excluding 1',
            },
        },
        ['clipId', 'factor'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'setAllVelocities',
        'Set every note velocity in one MIDI clip to an explicit MIDI value.',
        {
            clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
            velocity: { type: 'integer', minimum: 1, maximum: 127, description: 'MIDI velocity from 1 through 127' },
        },
        ['clipId', 'velocity'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'renameTrack',
        'Rename a track.',
        { trackId: { type: 'string' }, name: { type: 'string' } },
        ['trackId', 'name'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'muteTrack',
        'Mute or unmute a track.',
        {
            trackId: { type: 'string' },
            muted: { type: 'boolean', description: 'true=mute, false=unmute' },
        },
        ['trackId', 'muted'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'soloTrack',
        'Solo or unsolo a track (only hear this track).',
        {
            trackId: { type: 'string' },
            soloed: { type: 'boolean', description: 'true=solo, false=unsolo' },
        },
        ['trackId', 'soloed'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setSoloSafe',
        'Enable or disable solo-safe protection for a track.',
        {
            trackId: { type: 'string' },
            soloSafe: { type: 'boolean', description: 'true=enable solo safe, false=disable solo safe' },
        },
        ['trackId', 'soloSafe'],
        'bounded-reversible',
        false
    ),
    expectedCommand('clearSolos', 'Unsolo every currently soloed track.', {}, [], 'broad-reversible', true),
    expectedCommand(
        'armTrack',
        'Arm or disarm a track for recording.',
        {
            trackId: { type: 'string' },
            armed: { type: 'boolean', description: 'true=arm, false=disarm' },
        },
        ['trackId', 'armed'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'duplicateTrack',
        'Duplicate a track with all clips and devices.',
        { trackId: { type: 'string' } },
        ['trackId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'setTrackGain',
        'Set track volume. 0.0=silence, 0.8=default, 1.0=max.',
        { trackId: { type: 'string' }, gain: { type: 'number', description: '0.0 to 1.0' } },
        ['trackId', 'gain'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setTrackPan',
        'Pan a track left/right. -50=hard left, 0=center, 50=hard right.',
        { trackId: { type: 'string' }, pan: { type: 'number', description: '-50 to 50' } },
        ['trackId', 'pan'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setTrackColor',
        'Color-code a track for visual organization.',
        {
            trackId: { type: 'string' },
            color: { type: 'string', description: 'Six-digit hexadecimal color (for example #ff5500)' },
        },
        ['trackId', 'color'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'reorderTrack',
        'Move a track to a new position in the track list.',
        { trackId: { type: 'string' }, newIndex: { type: 'number', description: '0-based index in the track list' } },
        ['trackId', 'newIndex'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setTempo',
        'Set the project tempo in BPM. Range: 20–300.',
        { bpm: { type: 'number' } },
        ['bpm'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setTimeSignature',
        'Set the project time signature.',
        {
            numerator: { type: 'integer', description: 'Whole-number beat count from 1 through 32' },
            denominator: { type: 'integer', enum: [2, 4, 8, 16], description: 'Beat unit' },
        },
        ['numerator', 'denominator'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setPlayback',
        'Set transport playback to playing or paused.',
        { playing: { type: 'boolean', description: 'true=start or resume playback, false=pause playback' } },
        ['playing'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'stopPlayback',
        'Stop playback and return the playhead to the start.',
        {},
        [],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'seekPlayhead',
        'Move the playhead to a specific nonnegative beat position.',
        { beat: { type: 'number', minimum: 0, description: 'Beat position (bar 1 = beat 0)' } },
        ['beat'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setLoopEnabled',
        'Enable or disable the project loop.',
        { enabled: { type: 'boolean', description: 'true=enable looping, false=disable looping' } },
        ['enabled'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setLoopRegion',
        'Set project loop bounds without changing whether looping is enabled.',
        {
            startBeat: { type: 'number', description: 'Non-negative loop start beat' },
            endBeat: { type: 'number', description: 'Loop end beat, strictly after startBeat' },
        },
        ['startBeat', 'endBeat'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setMetronomeEnabled',
        'Enable or disable the metronome.',
        { enabled: { type: 'boolean', description: 'true=enable, false=disable' } },
        ['enabled'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setMetronomeVolume',
        'Set metronome volume from 0.0 through 1.0.',
        { volume: { type: 'number', description: '0.0 to 1.0' } },
        ['volume'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setMasterGain',
        'Set master output gain from 0.0 through 1.0.',
        { gain: { type: 'number', description: '0.0 to 1.0' } },
        ['gain'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setVcaGain',
        'Set an existing VCA group gain from 0.0 through 2.0.',
        {
            vcaGroupId: { type: 'string', description: 'Existing VCA group ID' },
            gain: { type: 'number', description: '0.0 to 2.0' },
        },
        ['vcaGroupId', 'gain'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'createVcaGroup',
        'Create a named VCA group from one or more existing tracks.',
        {
            name: { type: 'string', description: 'Explicit new VCA group name' },
            trackIds: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                uniqueItems: true,
                description: 'Existing non-master track IDs to place in the VCA group',
            },
        },
        ['name', 'trackIds'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'assignToVca',
        'Assign one existing non-master track to an existing VCA group.',
        {
            trackId: { type: 'string', description: 'Existing non-master track ID' },
            vcaGroupId: { type: 'string', description: 'Existing VCA group ID' },
        },
        ['trackId', 'vcaGroupId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'removeFromVca',
        'Remove one existing non-master track from its current VCA group.',
        { trackId: { type: 'string', description: 'Existing assigned non-master track ID' } },
        ['trackId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'addDevice',
        'Insert a platform-available built-in device at the end of a track device chain.',
        {
            trackId: { type: 'string', description: 'Existing track ID that accepts devices' },
            deviceType: { type: 'string', description: 'Available built-in device ID or unique display name' },
        },
        ['trackId', 'deviceType'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'removeDevice',
        'Remove an existing device from its track device chain.',
        { deviceId: { type: 'string', description: 'Existing device ID' } },
        ['deviceId'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'setDeviceParameter',
        'Adjust a parameter on an existing device.',
        {
            deviceId: { type: 'string' },
            paramId: { type: 'string', description: 'Parameter name (e.g. "frequency", "ratio", "mix", "threshold")' },
            value: { type: 'number', description: 'Parameter value (range depends on the parameter)' },
        },
        ['deviceId', 'paramId', 'value'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'bypassDevice',
        'Bypass or re-enable an effect (keeps settings, just disables processing).',
        { deviceId: { type: 'string' }, bypassed: { type: 'boolean' } },
        ['deviceId', 'bypassed'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'addSend',
        "Route a copy of a track's signal to a bus (parallel processing).",
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
            level: { type: 'number', description: 'Send level 0.0–1.0' },
        },
        ['trackId', 'busId', 'level'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setSend',
        'Adjust the send level from a track to a bus.',
        { trackId: { type: 'string' }, busId: { type: 'string' }, level: { type: 'number' } },
        ['trackId', 'busId', 'level'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'removeSend',
        'Remove a send from a track to a bus.',
        { trackId: { type: 'string' }, busId: { type: 'string' } },
        ['trackId', 'busId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setTrackOutput',
        "Route a track's output to a specific bus or master.",
        {
            trackId: { type: 'string' },
            outputId: { type: 'string', description: 'Destination track/bus ID' },
        },
        ['trackId', 'outputId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'addSidechainRoute',
        'Route one source track into the single supported sidechain compressor on a distinct target track.',
        {
            sourceTrackId: { type: 'string', description: 'Existing routable trigger track ID' },
            targetTrackId: { type: 'string', description: 'Distinct routable destination track ID' },
        },
        ['sourceTrackId', 'targetTrackId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'removeSidechainRoute',
        'Remove the single existing sidechain route between two distinct tracks.',
        {
            sourceTrackId: { type: 'string', description: 'Existing routable trigger track ID' },
            targetTrackId: { type: 'string', description: 'Distinct routable destination track ID' },
        },
        ['sourceTrackId', 'targetTrackId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'addAutomationLane',
        'Create a gain or pan automation lane on an existing track.',
        {
            trackId: { type: 'string', description: 'Existing track ID' },
            parameterId: {
                type: 'string',
                enum: ['gain', 'pan'],
                description: 'Track parameter to automate',
            },
        },
        ['trackId', 'parameterId'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'addAutomationPoint',
        'Add a value at an explicit beat on an existing track automation lane.',
        {
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
        ['laneId', 'beat', 'value'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setAutomationLaneEnabled',
        'Enable or disable an existing track automation lane.',
        {
            laneId: { type: 'string', description: 'Existing track automation lane ID' },
            enabled: { type: 'boolean', description: 'true=enable, false=disable' },
        },
        ['laneId', 'enabled'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setAutomationMode',
        "Set an existing track's automation mode.",
        {
            trackId: { type: 'string', description: 'Existing track ID' },
            mode: { type: 'string', enum: ['read', 'write', 'touch', 'latch', 'off'] },
        },
        ['trackId', 'mode'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'scaleAutomation',
        'Scale values on one existing track automation lane.',
        {
            laneId: { type: 'string', description: 'Existing track automation lane ID' },
            factor: { type: 'number', description: 'Greater than 0 and at most 16' },
        },
        ['laneId', 'factor'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'stretchAutomation',
        'Stretch timing on one existing track automation lane.',
        {
            laneId: { type: 'string', description: 'Existing track automation lane ID' },
            factor: { type: 'number', description: 'Greater than 0 and at most 16' },
        },
        ['laneId', 'factor'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'invertAutomation',
        'Invert values across one existing track automation lane range.',
        { laneId: { type: 'string', description: 'Existing track automation lane ID' } },
        ['laneId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'reverseAutomation',
        'Reverse the timing of one existing track automation lane.',
        { laneId: { type: 'string', description: 'Existing track automation lane ID' } },
        ['laneId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'thinAutomation',
        'Reduce redundant points on one existing track automation lane.',
        {
            laneId: { type: 'string', description: 'Existing track automation lane ID' },
            tolerance: { type: 'number', description: 'Optional positive tolerance within the lane value span' },
        },
        ['laneId'],
        'destructive-reversible',
        true
    ),
    expectedCommand(
        'quantizeAutomation',
        'Snap point timing on one existing track automation lane to a beat grid.',
        {
            laneId: { type: 'string', description: 'Existing track automation lane ID' },
            gridSize: { type: 'number', description: 'Beat grid greater than 0 and at most 64' },
        },
        ['laneId', 'gridSize'],
        'destructive-reversible',
        true
    ),
];

const EXPECTED_GROUNDING = [
    {
        actionType: 'addTrack',
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
    },
    {
        actionType: 'createBus',
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
    },
    {
        actionType: 'removeTrack',
        intentPhrases: ['delete track', 'remove track', 'delete', 'remove'],
        targetRules: [{ argument: 'trackId', capability: 'removable-track' }],
        valueRules: [],
    },
    {
        actionType: 'duplicateClip',
        intentPhrases: ['duplicate clip', 'copy clip'],
        targetRules: [{ argument: 'clipId', capability: 'clip' }],
        valueRules: [],
    },
    {
        actionType: 'duplicateClipToNextBar',
        intentPhrases: ['duplicate clip to next bar', 'copy clip to next bar', 'duplicate to next bar'],
        targetRules: [{ argument: 'clipId', capability: 'clip' }],
        valueRules: [],
    },
    {
        actionType: 'removeClip',
        intentPhrases: ['delete clip', 'remove clip', 'delete', 'remove'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [],
    },
    {
        actionType: 'renameClip',
        intentPhrases: ['rename clip'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip', promptRole: 'source' }],
        valueRules: [{ argument: 'name', kind: 'text-after-connector', connector: 'to' }],
    },
    {
        actionType: 'trimClipStart',
        intentPhrases: ['trim clip start', 'trim start'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [{ argument: 'newStartBeat', kind: 'number-if-present', requiredInPrompt: true }],
    },
    {
        actionType: 'trimClipEnd',
        intentPhrases: ['trim clip end', 'trim end'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [{ argument: 'newEndBeat', kind: 'number-if-present', requiredInPrompt: true }],
    },
    {
        actionType: 'nudgeClip',
        intentPhrases: ['nudge clip', 'nudge'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [{ argument: 'beats', kind: 'number-if-present', requiredInPrompt: true }],
    },
    {
        actionType: 'setClipGain',
        intentPhrases: ['set clip gain', 'clip gain', 'set clip volume'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [{ argument: 'gain', kind: 'number-if-present', requiredInPrompt: true, scale: 'percentage-only' }],
    },
    {
        actionType: 'muteClip',
        intentPhrases: ['mute clip', 'mute the clip', 'unmute clip', 'unmute the clip'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [
            {
                argument: 'muted',
                kind: 'boolean-intent',
                truePhrases: ['mute clip', 'mute the clip'],
                falsePhrases: ['unmute clip', 'unmute the clip'],
            },
        ],
    },
    {
        actionType: 'setClipColor',
        intentPhrases: ['set clip color', 'set clip colour', 'color clip', 'colour clip'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [{ argument: 'color', kind: 'string-literal' }],
    },
    {
        actionType: 'setClipFade',
        intentPhrases: ['set clip fade', 'set clip fades'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
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
    },
    {
        actionType: 'crossfadeClips',
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
    },
    {
        actionType: 'lockClip',
        intentPhrases: ['lock clip', 'lock the clip', 'unlock clip', 'unlock the clip'],
        targetRules: [{ argument: 'clipId', capability: 'clip' }],
        valueRules: [
            {
                argument: 'locked',
                kind: 'boolean-intent',
                truePhrases: ['lock clip', 'lock the clip'],
                falsePhrases: ['unlock clip', 'unlock the clip'],
            },
        ],
    },
    {
        actionType: 'setClipLoop',
        intentPhrases: ['enable clip loop', 'disable clip loop'],
        targetRules: [{ argument: 'clipId', capability: 'editable-clip' }],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable clip loop'],
                falsePhrases: ['disable clip loop'],
            },
        ],
    },
    {
        actionType: 'quantizeNotes',
        intentPhrases: ['quantize notes', 'quantize midi', 'snap midi notes'],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [{ argument: 'gridSize', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
    },
    {
        actionType: 'transposeNotes',
        intentPhrases: ['transpose notes', 'transpose midi', 'shift midi notes', 'shift notes'],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [{ argument: 'semitones', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
    },
    {
        actionType: 'invertNotes',
        intentPhrases: [
            'invert midi notes',
            'invert the midi notes',
            'invert notes',
            'invert the notes',
            'mirror midi pitches',
        ],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [],
    },
    {
        actionType: 'retrogradeNotes',
        intentPhrases: [
            'retrograde midi notes',
            'retrograde the midi notes',
            'retrograde notes',
            'retrograde the notes',
            'reverse midi notes',
        ],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [],
    },
    {
        actionType: 'quantizeNoteLengths',
        intentPhrases: ['quantize note lengths', 'quantize midi note lengths', 'snap midi note lengths'],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [{ argument: 'gridSize', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
    },
    {
        actionType: 'scaleAllVelocities',
        intentPhrases: ['scale midi velocities', 'scale note velocities', 'multiply midi velocities'],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [
            {
                argument: 'factor',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                scale: 'percentage-only',
            },
        ],
    },
    {
        actionType: 'setAllVelocities',
        intentPhrases: ['set midi velocities', 'set note velocities', 'set all velocities'],
        targetRules: [{ argument: 'clipId', capability: 'editable-midi-clip' }],
        valueRules: [{ argument: 'velocity', kind: 'number-if-present', requiredInPrompt: true, match: 'exact' }],
    },
    {
        actionType: 'renameTrack',
        intentPhrases: ['rename'],
        targetRules: [{ argument: 'trackId', capability: 'track', promptRole: 'source' }],
        valueRules: [{ argument: 'name', kind: 'text-after-connector', connector: 'to' }],
    },
    {
        actionType: 'muteTrack',
        intentPhrases: ['mute', 'unmute'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'muted',
                kind: 'boolean-intent',
                truePhrases: ['mute'],
                falsePhrases: ['unmute'],
            },
        ],
    },
    {
        actionType: 'soloTrack',
        intentPhrases: ['solo', 'unsolo'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'soloed',
                kind: 'boolean-intent',
                truePhrases: ['solo'],
                falsePhrases: ['unsolo'],
            },
        ],
    },
    {
        actionType: 'setSoloSafe',
        intentPhrases: ['enable solo safe', 'disable solo safe', 'make solo safe', 'remove solo safe'],
        targetRules: [{ argument: 'trackId', capability: 'track', allowBatchLocal: false }],
        valueRules: [
            {
                argument: 'soloSafe',
                kind: 'boolean-intent',
                truePhrases: ['enable solo safe', 'make solo safe'],
                falsePhrases: ['disable solo safe', 'remove solo safe'],
            },
        ],
    },
    {
        actionType: 'clearSolos',
        intentPhrases: ['clear all solos', 'unsolo all tracks', 'unsolo everything'],
        targetRules: [],
        valueRules: [],
    },
    {
        actionType: 'armTrack',
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
    },
    {
        actionType: 'duplicateTrack',
        intentPhrases: ['duplicate', 'copy'],
        targetRules: [{ argument: 'trackId', capability: 'duplicable-track' }],
        valueRules: [],
    },
    {
        actionType: 'setTrackGain',
        intentPhrases: ['gain', 'volume', 'louder', 'quieter', 'raise', 'lower', 'turn up', 'turn down'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'gain',
                kind: 'number-if-present',
                scale: 'unit-interval',
                qualitativeDirection: 'track-gain',
            },
        ],
    },
    {
        actionType: 'setTrackPan',
        intentPhrases: ['pan', 'left', 'right', 'center'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            { argument: 'pan', kind: 'number-if-present', direction: 'pan', qualitativeDirection: 'track-pan' },
        ],
    },
    {
        actionType: 'setTrackColor',
        intentPhrases: ['color', 'colour'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [{ argument: 'color', kind: 'string-literal' }],
    },
    {
        actionType: 'reorderTrack',
        intentPhrases: ['reorder', 'move'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [{ argument: 'newIndex', kind: 'number-if-present' }],
    },
    {
        actionType: 'setTempo',
        intentPhrases: ['set tempo', 'change tempo', 'tempo'],
        targetRules: [],
        valueRules: [{ argument: 'bpm', kind: 'number-if-present' }],
    },
    {
        actionType: 'setTimeSignature',
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
    },
    {
        actionType: 'setPlayback',
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
    },
    {
        actionType: 'stopPlayback',
        intentPhrases: ['stop', 'stop playback', 'halt', 'halt playback'],
        targetRules: [],
        valueRules: [],
    },
    {
        actionType: 'seekPlayhead',
        intentPhrases: ['seek playhead', 'seek the playhead', 'move playhead', 'move the playhead'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'number-if-present', connector: 'beat', match: 'exact', requiredInPrompt: true },
        ],
    },
    {
        actionType: 'setLoopEnabled',
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
    },
    {
        actionType: 'setLoopRegion',
        intentPhrases: ['set loop region', 'set the loop region', 'set loop', 'set the loop', 'change loop region'],
        targetRules: [],
        valueRules: [
            { argument: 'startBeat', kind: 'number-if-present', requiredInPrompt: true, connector: 'from' },
            { argument: 'endBeat', kind: 'number-if-present', requiredInPrompt: true, connector: 'to' },
        ],
    },
    {
        actionType: 'setMetronomeEnabled',
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
    },
    {
        actionType: 'setMetronomeVolume',
        intentPhrases: ['set metronome volume', 'set the metronome volume', 'change metronome volume'],
        targetRules: [],
        valueRules: [
            { argument: 'volume', kind: 'number-if-present', requiredInPrompt: true, scale: 'percentage-only' },
        ],
    },
    {
        actionType: 'setMasterGain',
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
    },
    {
        actionType: 'setVcaGain',
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
    },
    {
        actionType: 'createVcaGroup',
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
    },
    {
        actionType: 'assignToVca',
        intentPhrases: ['assign'],
        targetRules: [
            { argument: 'vcaGroupId', capability: 'vca-group', allowBatchLocal: false, promptRole: 'destination' },
            { argument: 'trackId', capability: 'vca-member-track', allowBatchLocal: false, promptRole: 'source' },
        ],
        valueRules: [],
    },
    {
        actionType: 'removeFromVca',
        intentPhrases: ['unassign'],
        targetRules: [{ argument: 'trackId', capability: 'vca-member-track', allowBatchLocal: false }],
        valueRules: [],
    },
    {
        actionType: 'addDevice',
        intentPhrases: ['add device', 'insert device', 'add plugin', 'insert plugin', 'add'],
        targetRules: [{ argument: 'trackId', capability: 'device-host-track' }],
        valueRules: [{ argument: 'deviceType', kind: 'string-literal' }],
    },
    {
        actionType: 'removeDevice',
        intentPhrases: ['remove device', 'delete device', 'remove plugin', 'delete plugin', 'remove', 'delete'],
        targetRules: [{ argument: 'deviceId', capability: 'device' }],
        valueRules: [],
    },
    {
        actionType: 'setDeviceParameter',
        intentPhrases: ['adjust', 'set', 'change', 'increase', 'decrease'],
        targetRules: [
            { argument: 'deviceId', capability: 'device' },
            { argument: 'paramId', capability: 'device-parameter', dependsOn: 'deviceId' },
        ],
        valueRules: [{ argument: 'value', kind: 'number-if-present', qualitativeDirection: 'device-parameter' }],
    },
    {
        actionType: 'bypassDevice',
        intentPhrases: ['bypass', 'enable', 'disable', 're-enable'],
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
    },
    ...['addSend', 'setSend', 'removeSend'].map((actionType, index) => ({
        actionType,
        intentPhrases: [
            ['add send', 'create send', 'send'],
            ['adjust send', 'set send', 'change send'],
            ['remove send', 'delete send', 'disconnect send'],
        ][index],
        targetRules: [
            { argument: 'busId', capability: 'bus', promptRole: 'destination' },
            { argument: 'trackId', capability: 'routable-source', distinctFrom: 'busId', promptRole: 'source' },
        ],
        valueRules: index < 2 ? [{ argument: 'level', kind: 'number-if-present', scale: 'unit-interval' }] : [],
    })),
    {
        actionType: 'setTrackOutput',
        intentPhrases: ['route', 'set output', 'output'],
        targetRules: [
            { argument: 'outputId', capability: 'output', promptRole: 'destination' },
            { argument: 'trackId', capability: 'routable-source', distinctFrom: 'outputId', promptRole: 'source' },
        ],
        valueRules: [],
    },
    ...['addSidechainRoute', 'removeSidechainRoute'].map((actionType, index) => ({
        actionType,
        intentPhrases: [
            ['add sidechain', 'create sidechain', 'route sidechain', 'sidechain'],
            ['remove sidechain', 'delete sidechain', 'disconnect sidechain'],
        ][index],
        targetRules: [
            { argument: 'targetTrackId', capability: 'routable-source', promptRole: 'destination' },
            {
                argument: 'sourceTrackId',
                capability: 'routable-source',
                distinctFrom: 'targetTrackId',
                promptRole: 'source',
            },
        ],
        valueRules: [],
    })),
    {
        actionType: 'addAutomationLane',
        intentPhrases: [
            'add automation lane',
            'create automation lane',
            'automate track gain',
            'automate track volume',
            'automate track pan',
            'automate track panning',
        ],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [{ argument: 'parameterId', kind: 'string-literal' }],
    },
    {
        actionType: 'addAutomationPoint',
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
    },
    {
        actionType: 'setAutomationLaneEnabled',
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
    },
    {
        actionType: 'setAutomationMode',
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
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'mode',
                kind: 'enum-if-present',
                values: ['read', 'write', 'touch', 'latch', 'off'],
                requiredInPrompt: true,
            },
        ],
    },
    {
        actionType: 'scaleAutomation',
        intentPhrases: ['scale automation', 'multiply automation values', 'amplify automation'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'factor', kind: 'number-if-present', requiredInPrompt: true }],
    },
    {
        actionType: 'stretchAutomation',
        intentPhrases: ['stretch automation', 'compress automation timing', 'expand automation timing'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'factor', kind: 'number-if-present', requiredInPrompt: true }],
    },
    {
        actionType: 'invertAutomation',
        intentPhrases: ['invert automation', 'flip automation values'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [],
    },
    {
        actionType: 'reverseAutomation',
        intentPhrases: ['reverse automation', 'reverse automation timing'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [],
    },
    {
        actionType: 'thinAutomation',
        intentPhrases: ['thin automation', 'simplify automation', 'reduce automation points'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'tolerance', kind: 'number-if-present', mayOmitWhenUnmentioned: true }],
    },
    {
        actionType: 'quantizeAutomation',
        intentPhrases: ['quantize automation', 'snap automation', 'quantize automation timing'],
        targetRules: [{ argument: 'laneId', capability: 'automation-lane' }],
        valueRules: [{ argument: 'gridSize', kind: 'number-if-present', requiredInPrompt: true }],
    },
];

describe('executable command registry', () => {
    it('derives the exact duplicate-free provider tool schema and execution policy', () => {
        const schemas = getExecutableAppActionToolSchemas();
        const actual = schemas.map((schema) => {
            const policy = getAppActionExecutionPolicy(schema.function.name);
            return [
                schema.function.name,
                schema.function.description,
                schema.function.parameters.properties,
                schema.function.parameters.required,
                schema.function.parameters.additionalProperties,
                policy.classification,
                policy.risk,
                policy.requiresConfirmation,
            ];
        });

        expect(actual).toEqual(EXPECTED_COMMANDS);
    });

    it('isolates nested schema data between generated provider surfaces', () => {
        const firstProperties = getExecutableAppActionToolSchemas()[0]?.function.parameters.properties;
        if (!firstProperties) {
            throw new Error('addTrack schema is unavailable');
        }
        const originalProperties = structuredClone(firstProperties);
        const firstNameProperty: unknown = Reflect.get(firstProperties, 'name');
        if (!isRecord(firstNameProperty)) {
            throw new Error('addTrack name schema is unavailable');
        }

        firstNameProperty.description = 'mutated by provider adapter';

        expect(getExecutableAppActionToolSchemas()[0]?.function.parameters.properties).toEqual(originalProperties);
    });

    it('pins the complete intent, target, and value grounding map', () => {
        const actual = EXPECTED_COMMANDS.map((command) => getExecutableAppActionGroundingRules(command[0]));

        expect(actual).toEqual(EXPECTED_GROUNDING);
    });

    it('maps every provider-executable action to exactly one production handler with executable metadata', () => {
        const handlerMaps: readonly Record<string, unknown>[] = [
            getArrangementHandlers(),
            getAutomationHandlers(),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
        ];

        expect(
            EXPECTED_COMMANDS.map((command) => {
                const owners = handlerMaps.filter((handlerMap) => Object.hasOwn(handlerMap, command[0]));
                const handler = owners[0]?.[command[0]];
                if (typeof handler !== 'object' || handler === null) {
                    return { actionType: command[0], ownerCount: owners.length, handler: null };
                }
                return {
                    actionType: command[0],
                    ownerCount: owners.length,
                    handler: {
                        execute: typeof Reflect.get(handler, 'execute'),
                        describe: typeof Reflect.get(handler, 'describe'),
                        undoable: typeof Reflect.get(handler, 'undoable'),
                    },
                };
            })
        ).toEqual(
            EXPECTED_COMMANDS.map((command) => ({
                actionType: command[0],
                ownerCount: 1,
                handler: { execute: 'function', describe: 'function', undoable: 'boolean' },
            }))
        );
    });
});
