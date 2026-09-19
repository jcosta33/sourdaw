import { describeLevelLawDb, SEND_LEVEL_LAW, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';

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
    tool('invertNotes', 'Melodic inversion — mirror notes around the center pitch.', { clipId: { type: 'string' } }, [
        'clipId',
    ]),
    tool('retrogradeNotes', 'Reverse the note order (play backwards).', { clipId: { type: 'string' } }, ['clipId']),
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
        'Add a point to an automation lane. Exactly one of valueDb, deltaDb, or value; the decibel forms are accepted only on a gain lane, whose minValueDb and maxValueDb state its window.',
        {
            laneId: { type: 'string' },
            beat: { type: 'number' },
            valueDb: {
                type: 'number',
                description: `Absolute level, gain lanes only. Within the lane's own minValueDb and maxValueDb; ${describeLevelLawDb(TRACK_FADER_LAW)}`,
            },
            deltaDb: {
                type: 'number',
                description:
                    "Change relative to the level the gain lane already draws at this beat, in decibels (negative is quieter). Gain lanes only; the result must land within the lane's own minValueDb and maxValueDb",
            },
            value: {
                type: 'number',
                description:
                    "Deprecated linear amplitude on a gain lane; prefer valueDb (absolute dB) or deltaDb (relative dB). On every other lane this is the value in the lane's own units, within its minValue and maxValue bounds",
            },
            curve: {
                type: 'string',
                enum: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'],
                description: 'Interpolation between this point and the next',
            },
        },
        ['laneId', 'beat']
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
        'addSend',
        `Route a copy of a track's signal to a bus (parallel processing). Exactly one of levelDb, deltaDb, or level. ${describeLevelLawDb(SEND_LEVEL_LAW)}.`,
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
            levelDb: { type: 'number', description: `Absolute send level. ${describeLevelLawDb(SEND_LEVEL_LAW)}` },
            deltaDb: {
                type: 'number',
                description: `Send level relative to unity, in decibels (negative is quieter), since the send does not exist yet. The result must land within ${describeLevelLawDb(SEND_LEVEL_LAW)}`,
            },
            level: {
                type: 'number',
                description:
                    'Deprecated linear amplitude; prefer levelDb (absolute dB) or deltaDb (relative dB). Send level 0.0–1.0',
            },
        },
        ['trackId', 'busId']
    ),
    tool(
        'setSend',
        `Adjust the send level from a track to a bus. Exactly one of levelDb, deltaDb, or level. ${describeLevelLawDb(SEND_LEVEL_LAW)}.`,
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
            levelDb: { type: 'number', description: `Absolute send level. ${describeLevelLawDb(SEND_LEVEL_LAW)}` },
            deltaDb: {
                type: 'number',
                description: `Change relative to the send's current level, in decibels (negative is quieter). The result must land within ${describeLevelLawDb(SEND_LEVEL_LAW)}`,
            },
            level: {
                type: 'number',
                description:
                    'Deprecated linear amplitude; prefer levelDb (absolute dB) or deltaDb (relative dB). Send level 0.0–1.0',
            },
        },
        ['trackId', 'busId']
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
