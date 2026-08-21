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
    tool('removeAllTracks', 'Remove every track from the session.', {}),
    tool('renameTrack', 'Rename a track.', { trackId: { type: 'string' }, name: { type: 'string' } }, [
        'trackId',
        'name',
    ]),
    tool('selectTrack', 'Select a track (focus for editing).', { trackId: { type: 'string' } }, ['trackId']),
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
    tool(
        'hideTrack',
        'Hide/show a track in the arrangement view.',
        {
            trackId: { type: 'string' },
            hidden: { type: 'boolean' },
        },
        ['trackId', 'hidden']
    ),
    tool(
        'disableTrack',
        'Disable a track (saves CPU but keeps content).',
        {
            trackId: { type: 'string' },
            disabled: { type: 'boolean' },
        },
        ['trackId', 'disabled']
    ),
    tool('freezeTrack', 'Freeze a track to save CPU (renders to temp audio).', { trackId: { type: 'string' } }, [
        'trackId',
    ]),
    tool('unfreezeTrack', 'Unfreeze a previously frozen track.', { trackId: { type: 'string' } }, ['trackId']),
    tool('bounceInPlace', 'Bounce a track to audio in-place (destructive render).', { trackId: { type: 'string' } }, [
        'trackId',
    ]),
    tool(
        'bounceToNewTrack',
        'Bounce a track to a new audio track (non-destructive).',
        { trackId: { type: 'string' } },
        ['trackId']
    ),
    tool(
        'setTrackNotes',
        'Add production notes to a track (e.g. "re-record verse 2", "needs EQ").',
        {
            trackId: { type: 'string' },
            notes: { type: 'string' },
        },
        ['trackId', 'notes']
    ),
    tool(
        'groupTracks',
        'Group multiple tracks into a folder/group.',
        {
            trackIds: { type: 'array', items: { type: 'string' }, description: 'Track IDs to group' },
            name: { type: 'string', description: 'Group name (e.g. "Drums", "Vocals")' },
        },
        ['trackIds', 'name']
    ),
    tool(
        'foldTrack',
        'Collapse/expand a folder or group track.',
        {
            trackId: { type: 'string' },
            folded: { type: 'boolean' },
        },
        ['trackId', 'folded']
    ),
    tool(
        'autoOrganizeProject',
        'Automatically rename, color-code, and group tracks based on their content to organize the project. E.g., combine all vocals into a "Vocals" folder, name them "Lead Vocal", "Backing Vocal", and color them purple.',
        {
            tracks: {
                type: 'array',
                description: 'List of updates per track.',
                items: {
                    type: 'object',
                    properties: {
                        trackId: { type: 'string' },
                        newName: { type: 'string', description: 'Standardized name (e.g., "Bass", "Kick")' },
                        color: { type: 'string', description: 'CSS color (e.g., "blue", "#ff0000")' },
                        folderName: {
                            type: 'string',
                            description: 'Optional folder group to move this track into (e.g., "Drums").',
                        },
                    },
                    required: ['trackId'],
                },
            },
        },
        ['tracks']
    ),
];
