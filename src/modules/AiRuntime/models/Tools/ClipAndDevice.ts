import { tool, type ToolSchema } from './Types';

const DEVICE_TYPES = [
    'EQ',
    'Compressor',
    'Reverb',
    'Delay',
    'Gain',
    'Chorus',
    'Flanger',
    'Phaser',
    'Distortion',
    'Limiter',
    'Gate',
    'BitCrusher',
    'Filter',
    'Saturator',
    'DeEsser',
];

export const clipTools: readonly ToolSchema[] = [
    tool(
        'addClip',
        'Create a new empty clip on a track.',
        {
            trackId: { type: 'string' },
            startBeat: { type: 'number', description: 'Start position in beats' },
            endBeat: { type: 'number', description: 'End position in beats' },
            name: { type: 'string', description: 'Clip display name' },
        },
        ['trackId', 'startBeat', 'endBeat', 'name']
    ),
    tool('removeClip', 'Delete a clip.', { clipId: { type: 'string' } }, ['clipId']),
    tool('duplicateClip', 'Duplicate a clip in place.', { clipId: { type: 'string' } }, ['clipId']),
    tool('duplicateClipToNextBar', 'Duplicate a clip and place it at the next bar.', { clipId: { type: 'string' } }, [
        'clipId',
    ]),
    tool(
        'duplicateClipAt',
        'Duplicate a clip onto an explicit destination track at an absolute start beat.',
        {
            clipId: { type: 'string' },
            destinationTrackId: { type: 'string', description: 'Destination track ID' },
            startBeat: { type: 'number', description: 'New start position in beats' },
        },
        ['clipId', 'destinationTrackId', 'startBeat']
    ),
    tool(
        'drawClip',
        'Create a new empty clip on a track with an explicit type.',
        {
            trackId: { type: 'string' },
            startBeat: { type: 'number', description: 'Start position in beats' },
            endBeat: { type: 'number', description: 'End position in beats' },
            name: { type: 'string', description: 'Clip display name' },
            type: { type: 'string', description: "'audio' or 'midi' — must match the track kind" },
        },
        ['trackId', 'startBeat', 'endBeat', 'name', 'type']
    ),
    tool(
        'moveClips',
        'Move several clips to explicit tracks and start beats in one undoable step.',
        {
            moves: {
                type: 'array',
                description: 'One target placement per clip',
                items: {
                    type: 'object',
                    properties: {
                        clipId: { type: 'string' },
                        trackId: { type: 'string', description: 'Destination track ID' },
                        startBeat: { type: 'number', description: 'New start position in beats' },
                    },
                    required: ['clipId', 'trackId', 'startBeat'],
                },
            },
        },
        ['moves']
    ),
    tool(
        'moveClip',
        'Move a clip to a different position or track.',
        {
            clipId: { type: 'string' },
            trackId: { type: 'string', description: 'Destination track ID' },
            startBeat: { type: 'number', description: 'New start position in beats' },
        },
        ['clipId', 'trackId', 'startBeat']
    ),
    tool('renameClip', 'Rename a clip.', { clipId: { type: 'string' }, name: { type: 'string' } }, ['clipId', 'name']),
    tool(
        'splitClip',
        'Split a clip into two at a specific beat.',
        {
            clipId: { type: 'string' },
            beat: { type: 'number', description: 'Split position in beats' },
        },
        ['clipId', 'beat']
    ),
    tool(
        'trimClipStart',
        'Trim the start of a clip (move left edge).',
        {
            clipId: { type: 'string' },
            newStartBeat: { type: 'number' },
        },
        ['clipId', 'newStartBeat']
    ),
    tool(
        'trimClipEnd',
        'Trim the end of a clip (move right edge).',
        {
            clipId: { type: 'string' },
            newEndBeat: { type: 'number' },
        },
        ['clipId', 'newEndBeat']
    ),
    tool(
        'muteClip',
        'Mute or unmute a specific clip.',
        {
            clipId: { type: 'string' },
            muted: { type: 'boolean' },
        },
        ['clipId', 'muted']
    ),
    tool(
        'setClipFade',
        'Set fade-in and fade-out on a clip.',
        {
            clipId: { type: 'string' },
            fadeInBeats: { type: 'number', description: 'Fade-in duration in beats' },
            fadeOutBeats: { type: 'number', description: 'Fade-out duration in beats' },
        },
        ['clipId', 'fadeInBeats', 'fadeOutBeats']
    ),
    tool(
        'nudgeClip',
        'Nudge a clip forward or backward by a number of beats.',
        {
            clipId: { type: 'string' },
            beats: { type: 'number', description: 'Positive=forward, negative=backward' },
        },
        ['clipId', 'beats']
    ),
    tool(
        'slipClipContent',
        "Slide a clip's internal content by setting its content offset in beats without moving the clip.",
        {
            clipId: { type: 'string' },
            clipType: { type: 'string', description: "'audio' or 'midi' — which content offset to slide" },
            offset: { type: 'number', description: 'New content offset in beats' },
        },
        ['clipId', 'clipType', 'offset']
    ),
    tool(
        'setClipGain',
        'Set clip volume. 0.0=silence, 1.0=unity, 2.0=+6dB.',
        {
            clipId: { type: 'string' },
            gain: { type: 'number', description: '0.0 to 2.0' },
        },
        ['clipId', 'gain']
    ),
    tool(
        'setClipColor',
        'Color-code a clip for visual organization.',
        {
            clipId: { type: 'string' },
            color: { type: 'string' },
        },
        ['clipId', 'color']
    ),
    tool(
        'lockClip',
        'Lock a clip to prevent accidental edits/moves.',
        {
            clipId: { type: 'string' },
            locked: { type: 'boolean' },
        },
        ['clipId', 'locked']
    ),
    tool('normalizeClip', 'Normalize clip volume to peak level.', { clipId: { type: 'string' } }, ['clipId']),
    tool(
        'setClipLoop',
        'Enable or disable looping on a clip.',
        {
            clipId: { type: 'string' },
            enabled: { type: 'boolean' },
        },
        ['clipId', 'enabled']
    ),
    tool(
        'crossfadeClips',
        'Create a crossfade between two adjacent clips.',
        {
            clipAId: { type: 'string' },
            clipBId: { type: 'string' },
            durationBeats: { type: 'number', description: 'Crossfade duration in beats' },
        },
        ['clipAId', 'clipBId', 'durationBeats']
    ),
];

export const deviceTools: readonly ToolSchema[] = [
    tool(
        'addDevice',
        "Add an audio effect to a track's device chain.",
        {
            trackId: { type: 'string' },
            deviceType: {
                type: 'string',
                enum: DEVICE_TYPES,
                description: 'The type of effect to add',
            },
            afterDeviceId: {
                type: 'string',
                description: 'Existing device ID after which to insert; omit to append',
            },
        },
        ['trackId', 'deviceType']
    ),
    tool(
        'setDeviceParameter',
        'Adjust a parameter on an existing device.',
        {
            deviceId: { type: 'string' },
            paramId: { type: 'string', description: 'Parameter name (e.g. "frequency", "ratio", "mix", "threshold")' },
            value: { type: 'number', description: 'Parameter value (range depends on the parameter)' },
        },
        ['deviceId', 'paramId', 'value']
    ),
    tool(
        'bypassDevice',
        'Bypass or re-enable an effect (keeps settings, just disables processing).',
        {
            deviceId: { type: 'string' },
            bypassed: { type: 'boolean' },
        },
        ['deviceId', 'bypassed']
    ),
    tool('removeDevice', 'Remove an effect from a track.', { deviceId: { type: 'string' } }, ['deviceId']),
];
