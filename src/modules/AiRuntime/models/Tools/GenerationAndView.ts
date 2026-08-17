import { createAddNotesToolSchema } from './CreateAddNotesToolSchema';
import { tool, type ToolSchema } from './Types';

export const generationTools: readonly ToolSchema[] = [
    tool(
        'generateDrumPattern',
        'Generate a drum pattern.',
        {
            style: {
                type: 'string',
                description:
                    '"hip-hop", "trap", "house", "techno", "rock", "jazz", "latin", "boom-bap", "drill", "dnb"',
            },
            trackId: { type: 'string', description: 'Optional: place on existing track' },
            bars: { type: 'number', description: 'Pattern length in bars (default 4)' },
            density: { type: 'number', description: '0.0=sparse to 1.0=busy (default 0.5)' },
        },
        ['style']
    ),
    tool(
        'generateMelody',
        'Generate a melody line.',
        {
            style: { type: 'string', description: '"pop", "jazz", "classical", "ambient", "edm", "r&b"' },
            key: { type: 'number', description: 'Root note as MIDI number (60=C4, 64=E4). Optional.' },
            scale: { type: 'string', description: '"major", "minor", "pentatonic", "blues", "dorian", "mixolydian"' },
            trackId: { type: 'string' },
            bars: { type: 'number' },
        },
        ['style']
    ),
    tool(
        'generateChordProgression',
        'Generate a chord progression.',
        {
            style: { type: 'string', description: '"pop", "jazz", "neo-soul", "lo-fi", "classical", "edm"' },
            key: { type: 'number', description: 'Root note as MIDI number (60=C4)' },
            scale: { type: 'string' },
            trackId: { type: 'string' },
            bars: { type: 'number' },
            voicing: { type: 'string', description: '"close", "open", "spread", "shell"' },
        },
        ['style']
    ),
    tool('analyzeMix', 'Analyze the current mix for issues (clipping, frequency masking, etc.).', {}),
    tool('autoFixMix', 'Automatically fix common mix issues (gain staging, panning, EQ conflicts).', {}),
    tool('detectTempo', 'Detect the tempo of an audio clip.', { clipId: { type: 'string' } }, ['clipId']),
    tool(
        'detectKey',
        'Detect the musical key of an audio clip. Atonal, percussive or broadband material reports that no key was found rather than guessing one.',
        { clipId: { type: 'string' } },
        ['clipId']
    ),
    tool(
        'audioToMidi',
        'Convert audio to MIDI (e.g. extract melody from vocals).',
        {
            clipId: { type: 'string' },
            trackId: { type: 'string', description: 'Optional: target track for MIDI output' },
        },
        ['clipId']
    ),
    tool(
        'stripSilence',
        'Remove silent sections from a clip.',
        {
            clipId: { type: 'string' },
            threshold: { type: 'number', description: 'Silence threshold in dB (default -60)' },
        },
        ['clipId']
    ),
    createAddNotesToolSchema(),
    tool(
        'completeMidi',
        'AI-continue a MIDI phrase. Analyzes existing notes and generates a continuation in the same style.',
        {
            clipId: { type: 'string', description: 'Clip whose notes to continue' },
            direction: { type: 'string', description: '"forward" (default) or "backward"' },
            bars: { type: 'number', description: 'How many bars to generate (default 4)' },
        },
        ['clipId']
    ),
    tool(
        'variationMidi',
        'Create a variation of a MIDI clip — keeps the feel but changes some notes/rhythms.',
        {
            clipId: { type: 'string' },
            amount: { type: 'number', description: '0.0=subtle, 0.5=moderate, 1.0=wild (default 0.3)' },
        },
        ['clipId']
    ),
    tool(
        'generateBassline',
        'Generate a bassline that fits the current chord progression or select clip.',
        {
            clipId: { type: 'string', description: 'Reference clip (chords/melody to base the bass on)' },
            style: { type: 'string', description: '"walking", "root-fifth", "syncopated", "octave"' },
            trackId: { type: 'string', description: 'Optional: target track for the bassline' },
        },
        ['clipId']
    ),
];

export const markerTools: readonly ToolSchema[] = [
    tool(
        'addMarker',
        'Add a marker at a beat position (e.g. "Chorus", "Drop").',
        {
            beat: { type: 'number' },
            name: { type: 'string', description: 'Marker label' },
        },
        ['beat', 'name']
    ),
    tool('removeMarker', 'Delete a marker.', { markerId: { type: 'string' } }, ['markerId']),
    tool(
        'addSection',
        'Define a song section (e.g. Intro, Verse, Chorus).',
        {
            startBeat: { type: 'number' },
            endBeat: { type: 'number' },
            name: { type: 'string', description: '"Intro", "Verse 1", "Chorus", "Bridge", "Outro"' },
        },
        ['startBeat', 'endBeat', 'name']
    ),
    tool('removeSection', 'Delete a section.', { sectionId: { type: 'string' } }, ['sectionId']),
    tool('renameSection', 'Rename a section.', { sectionId: { type: 'string' }, name: { type: 'string' } }, [
        'sectionId',
        'name',
    ]),
];

export const timeTools: readonly ToolSchema[] = [
    tool(
        'deleteTime',
        'Delete a time range from the arrangement (all tracks affected).',
        {
            startBeat: { type: 'number' },
            endBeat: { type: 'number' },
        },
        ['startBeat', 'endBeat']
    ),
    tool(
        'insertTime',
        'Insert empty time at a position (pushes everything after).',
        {
            atBeat: { type: 'number' },
            durationBeats: { type: 'number' },
        },
        ['atBeat', 'durationBeats']
    ),
    tool(
        'duplicateTimeRange',
        'Duplicate a time range (all tracks) and insert after.',
        {
            startBeat: { type: 'number' },
            endBeat: { type: 'number' },
        },
        ['startBeat', 'endBeat']
    ),
];

export const workspaceTools: readonly ToolSchema[] = [
    tool(
        'setWorkspaceMode',
        'Switch the main view.',
        {
            mode: { type: 'string', enum: ['arrange', 'clip'], description: '"arrange"=timeline, "clip"=clip editor' },
        },
        ['mode']
    ),
    tool('openMixer', 'Open the mixer view.', {}),
    tool('closeMixer', 'Close the mixer view.', {}),
    tool('toggleSidebar', 'Show or hide the sidebar.', {}),
    tool('toggleInspector', 'Show or hide the inspector panel.', {}),
    tool('toggleChatPanel', 'Show or hide the AI chat panel.', {}),
    tool(
        'setEditingTool',
        'Switch the editing cursor tool.',
        {
            tool: { type: 'string', description: '"select", "draw", "erase", "split", "mute", "zoom"' },
        },
        ['tool']
    ),
    tool(
        'setSnapValue',
        'Set the grid snap resolution.',
        {
            value: { type: 'number', description: '0.25=16th note, 0.5=8th, 1=quarter, 4=bar' },
        },
        ['value']
    ),
    tool('zoomToFit', 'Zoom to show all content in the arrangement.', {}),
    tool('zoomToSelection', 'Zoom to the current selection.', {}),
    tool('saveProject', 'Save the current project.', {}),
    tool('exportProject', 'Export the project (render to audio file).', {}),
];
