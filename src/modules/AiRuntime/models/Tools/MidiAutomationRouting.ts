import { tool, type ToolSchema } from './Types';

export const midiTools: readonly ToolSchema[] = [
    tool(
        'quantizeNotes',
        'Snap MIDI notes to the nearest grid position.',
        {
            clipId: { type: 'string' },
            gridSize: { type: 'number', description: '0.25=16th, 0.5=8th, 1=quarter, 2=half, 4=whole note' },
        },
        ['clipId', 'gridSize']
    ),
    tool(
        'quantizeNoteLengths',
        'Snap MIDI note lengths to the grid.',
        {
            clipId: { type: 'string' },
            gridSize: { type: 'number' },
        },
        ['clipId', 'gridSize']
    ),
    tool(
        'transposeNotes',
        'Shift all MIDI notes up or down by semitones.',
        {
            clipId: { type: 'string' },
            semitones: { type: 'number', description: '+12=up one octave, -7=down a fifth' },
        },
        ['clipId', 'semitones']
    ),
    tool(
        'humanizeNotes',
        'Add natural timing variation to MIDI notes.',
        {
            clipId: { type: 'string' },
            amount: { type: 'number', description: '0.0=none, 0.3=subtle, 0.7=loose, 1.0=maximum' },
        },
        ['clipId', 'amount']
    ),
    tool('invertNotes', 'Melodic inversion — mirror notes around the center pitch.', { clipId: { type: 'string' } }, [
        'clipId',
    ]),
    tool('retrogradeNotes', 'Reverse the note order (play backwards).', { clipId: { type: 'string' } }, ['clipId']),
    tool(
        'scaleVelocities',
        'Apply a velocity curve to notes in a clip.',
        {
            clipId: { type: 'string' },
            curve: { type: 'string', description: '"crescendo", "decrescendo", "accent-downbeats", "random"' },
            minVelocity: { type: 'number', description: '1–127, optional' },
            maxVelocity: { type: 'number', description: '1–127, optional' },
        },
        ['clipId', 'curve']
    ),
    tool(
        'scaleAllVelocities',
        'Scale all note velocities by a factor.',
        {
            clipId: { type: 'string' },
            factor: { type: 'number', description: '0.5=half, 1.0=no change, 1.5=50% louder' },
        },
        ['clipId', 'factor']
    ),
    tool(
        'setAllVelocities',
        'Set every note to the same velocity.',
        {
            clipId: { type: 'string' },
            velocity: { type: 'number', description: '1–127 (64=medium, 100=strong, 127=max)' },
        },
        ['clipId', 'velocity']
    ),
    tool(
        'arpeggiate',
        'Convert chords into an arpeggiated pattern.',
        {
            clipId: { type: 'string' },
            pattern: { type: 'string', enum: ['up', 'down', 'updown', 'downup', 'random'] },
            rate: { type: 'number', enum: [4, 8, 16, 32], description: 'Notes per whole note: 8=eighths' },
            octaves: { type: 'number', description: 'Number of octaves to span (1–4)' },
            gate: { type: 'number', description: 'Note length as percent of step (50=staccato, 100=legato)' },
        },
        ['clipId']
    ),
];

export const automationTools: readonly ToolSchema[] = [
    tool(
        'addAutomationLane',
        'Create an automation lane for a track parameter.',
        {
            trackId: { type: 'string' },
            parameterId: {
                type: 'string',
                enum: ['gain', 'pan'],
                description: 'Track parameter to automate',
            },
        },
        ['trackId', 'parameterId']
    ),
    tool(
        'addAutomationPoint',
        'Add a point to an automation lane.',
        {
            laneId: { type: 'string' },
            beat: { type: 'number' },
            value: { type: 'number', description: 'Within the selected lane minValue and maxValue bounds' },
            curve: {
                type: 'string',
                enum: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'],
                description: 'Interpolation between this point and the next',
            },
        },
        ['laneId', 'beat', 'value']
    ),
    tool(
        'setAutomationLaneEnabled',
        'Enable or disable an existing automation lane.',
        {
            laneId: { type: 'string' },
            enabled: { type: 'boolean', description: 'true=enable, false=disable' },
        },
        ['laneId', 'enabled']
    ),
    tool(
        'setAutomationMode',
        "Set a track's automation mode.",
        {
            trackId: { type: 'string' },
            mode: { type: 'string', enum: ['read', 'write', 'touch', 'latch', 'off'] },
        },
        ['trackId', 'mode']
    ),
    tool(
        'scaleAutomation',
        'Scale all automation values in a lane by a factor greater than 0 and at most 16.',
        {
            laneId: { type: 'string' },
            factor: { type: 'number', description: 'Value scale factor, greater than 0 and at most 16' },
        },
        ['laneId', 'factor']
    ),
    tool(
        'stretchAutomation',
        'Stretch automation timing by a factor greater than 0 and at most 16.',
        {
            laneId: { type: 'string' },
            factor: { type: 'number', description: 'Time scale factor, greater than 0 and at most 16' },
        },
        ['laneId', 'factor']
    ),
    tool(
        'invertAutomation',
        'Invert automation values across the selected lane range.',
        { laneId: { type: 'string' } },
        ['laneId']
    ),
    tool('reverseAutomation', 'Reverse automation timing within the lane.', { laneId: { type: 'string' } }, ['laneId']),
    tool(
        'thinAutomation',
        'Reduce redundant automation points within an optional tolerance.',
        {
            laneId: { type: 'string' },
            tolerance: {
                type: 'number',
                description: 'Optional value tolerance greater than 0 and within the lane range',
            },
        },
        ['laneId']
    ),
    tool(
        'quantizeAutomation',
        'Snap automation point timing to a beat grid.',
        {
            laneId: { type: 'string' },
            gridSize: { type: 'number', description: 'Beat grid greater than 0 and at most 64' },
        },
        ['laneId', 'gridSize']
    ),
];

export const routingTools: readonly ToolSchema[] = [
    tool(
        'createBus',
        'Create a bus track for parallel processing or submixing.',
        {
            name: { type: 'string', description: 'Bus name (e.g. "Reverb Bus", "Drum Bus", "Vocal Bus")' },
        },
        ['name']
    ),
    tool(
        'createFolder',
        'Create a folder track to organize tracks visually.',
        {
            name: { type: 'string', description: 'Folder name (e.g. "Drums", "Strings")' },
        },
        ['name']
    ),
    tool(
        'addSend',
        "Route a copy of a track's signal to a bus (parallel processing).",
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
            level: { type: 'number', description: 'Send level 0.0–1.0' },
        },
        ['trackId', 'busId', 'level']
    ),
    tool(
        'setSend',
        'Adjust the send level from a track to a bus.',
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
            level: { type: 'number' },
        },
        ['trackId', 'busId', 'level']
    ),
    tool(
        'removeSend',
        'Remove a send from a track to a bus.',
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
        },
        ['trackId', 'busId']
    ),
    tool(
        'setTrackOutput',
        "Route a track's output to a specific bus or master.",
        {
            trackId: { type: 'string' },
            outputId: { type: 'string', description: 'Destination track/bus ID' },
        },
        ['trackId', 'outputId']
    ),
    tool(
        'addSidechainRoute',
        'Route one source track into the single supported sidechain compressor on a distinct target track.',
        {
            sourceTrackId: { type: 'string', description: 'The trigger track (e.g. kick)' },
            targetTrackId: { type: 'string', description: 'The track being ducked (e.g. bass)' },
        },
        ['sourceTrackId', 'targetTrackId']
    ),
    tool(
        'removeSidechainRoute',
        'Remove the single existing sidechain route between two distinct tracks.',
        {
            sourceTrackId: { type: 'string' },
            targetTrackId: { type: 'string' },
        },
        ['sourceTrackId', 'targetTrackId']
    ),
];
