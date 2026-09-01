import { FADER_GAIN_RANGE_DESCRIPTION, FADER_MAX_GAIN_LABEL } from '#/utils/audioLevelLaw';

import { tool, type ToolSchema } from './Types';

export const trackTools: readonly ToolSchema[] = [
    tool(
        'addTrack',
        'Create a new track in the session.',
        {
            name: { type: 'string', description: 'Display name (e.g. "Kick", "Vocals", "Synth Pad")' },
            kind: { type: 'string', enum: ['audio', 'midi', 'bus', 'folder'], description: 'Track type' },
        },
        ['name', 'kind']
    ),
    tool('removeTrack', 'Delete a track and all its clips/devices.', { trackId: { type: 'string' } }, ['trackId']),
    tool('renameTrack', 'Rename a track.', { trackId: { type: 'string' }, name: { type: 'string' } }, [
        'trackId',
        'name',
    ]),
    tool(
        'muteTrack',
        'Mute or unmute a track.',
        {
            trackId: { type: 'string' },
            muted: { type: 'boolean', description: 'true=mute, false=unmute' },
        },
        ['trackId', 'muted']
    ),
    tool(
        'soloTrack',
        'Solo or unsolo a track (only hear this track).',
        {
            trackId: { type: 'string' },
            soloed: { type: 'boolean', description: 'true=solo, false=unsolo' },
        },
        ['trackId', 'soloed']
    ),
    tool(
        'setSoloSafe',
        'Enable or disable solo-safe protection for a track.',
        {
            trackId: { type: 'string' },
            soloSafe: { type: 'boolean', description: 'true=enable solo safe, false=disable solo safe' },
        },
        ['trackId', 'soloSafe']
    ),
    tool(
        'armTrack',
        'Arm a track for recording input.',
        {
            trackId: { type: 'string' },
            armed: { type: 'boolean' },
        },
        ['trackId', 'armed']
    ),
    tool('duplicateTrack', 'Duplicate a track with all clips and devices.', { trackId: { type: 'string' } }, [
        'trackId',
    ]),
    tool(
        'setTrackGain',
        `Set track volume. 0.0=silence, 0.8=default, 1.0=unity, ${FADER_MAX_GAIN_LABEL}=max.`,
        {
            trackId: { type: 'string' },
            gain: { type: 'number', description: FADER_GAIN_RANGE_DESCRIPTION },
        },
        ['trackId', 'gain']
    ),
    tool(
        'setTrackPan',
        'Pan a track left/right. -50=hard left, 0=center, 50=hard right.',
        {
            trackId: { type: 'string' },
            pan: { type: 'number', description: '-50 to 50' },
        },
        ['trackId', 'pan']
    ),
    tool(
        'setTrackColor',
        'Color-code a track for visual organization.',
        {
            trackId: { type: 'string' },
            color: { type: 'string', description: 'Six-digit hexadecimal color (for example #ff5500)' },
        },
        ['trackId', 'color']
    ),
    tool('clearSolos', 'Unsolo all tracks — hear the full mix again.', {}),
    tool(
        'reorderTrack',
        'Move a track to a new position in the track list.',
        {
            trackId: { type: 'string' },
            newIndex: { type: 'number', description: '0-based index in the track list' },
        },
        ['trackId', 'newIndex']
    ),
];
