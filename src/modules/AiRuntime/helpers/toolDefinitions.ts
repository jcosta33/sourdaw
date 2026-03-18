/* (c) Copyright Webdaw Ltd., all rights reserved. */

/**
 * Tool definitions for the Hermes function calling system prompt.
 * Each tool maps 1:1 to an AppAction type.
 *
 * These are serialized as JSON inside `<tools>` XML in the system prompt —
 * NOT passed via the OpenAI `tools` API parameter.
 */

type ToolSchema = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, unknown>;
            required: string[];
        };
    };
};

function tool(
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = []
): ToolSchema {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: { type: 'object', properties, required },
        },
    };
}

// ─── Track Management ────────────────────────────────────────────────────

const trackTools: ToolSchema[] = [
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
        'Set track volume. 0.0=silence, 0.8=default, 1.0=max.',
        {
            trackId: { type: 'string' },
            gain: { type: 'number', description: '0.0 to 1.0' },
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
            color: { type: 'string', description: 'CSS color: hex (#ff5500), named (red), or hsl' },
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
];

// ─── Transport & Playback ────────────────────────────────────────────────

const transportTools: ToolSchema[] = [
    tool('setTempo', 'Set the project tempo in BPM. Range: 20–300.', { bpm: { type: 'number' } }, ['bpm']),
    tool('togglePlayback', 'Start or pause playback.', {}),
    tool('stopPlayback', 'Stop playback and return playhead to start.', {}),
    tool('toggleRecording', 'Start or stop recording.', {}),
    tool('toggleLoop', 'Toggle loop playback on/off.', {}),
    tool(
        'setLoopRegion',
        'Set loop start and end points.',
        {
            startBeat: { type: 'number', description: 'Loop start in beats (bar 1 = beat 0, bar 2 = beat 4 in 4/4)' },
            endBeat: { type: 'number', description: 'Loop end in beats' },
        },
        ['startBeat', 'endBeat']
    ),
    tool(
        'seekPlayhead',
        'Move the playhead to a specific beat position.',
        {
            beat: { type: 'number', description: 'Beat position (bar 1 = beat 0)' },
        },
        ['beat']
    ),
    tool('toggleMetronome', 'Toggle the metronome click on/off.', {}),
    tool(
        'setMetronomeVolume',
        'Set metronome click volume.',
        {
            volume: { type: 'number', description: '0.0 to 1.0' },
        },
        ['volume']
    ),
    tool(
        'setMasterGain',
        'Set the master output volume.',
        {
            gain: { type: 'number', description: '0.0 to 1.0 (0.8 = default)' },
        },
        ['gain']
    ),
    tool('setPunchIn', 'Set the punch-in point for recording.', { beat: { type: 'number' } }, ['beat']),
    tool('setPunchOut', 'Set the punch-out point for recording.', { beat: { type: 'number' } }, ['beat']),
    tool('togglePunch', 'Toggle punch recording mode.', {}),
    tool('toggleCountIn', 'Toggle count-in before recording.', {}),
    tool('setCountInBars', 'Set number of count-in bars.', { bars: { type: 'number' } }, ['bars']),
    tool(
        'addTimeSignatureChange',
        'Add a time signature change at a beat position.',
        {
            beat: { type: 'number' },
            numerator: { type: 'number', description: 'Beats per bar (e.g. 3, 4, 5, 6, 7)' },
            denominator: { type: 'number', description: 'Beat unit (4=quarter, 8=eighth)' },
        },
        ['beat', 'numerator', 'denominator']
    ),
];

// ─── Clip Editing ────────────────────────────────────────────────────────

const clipTools: ToolSchema[] = [
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
    tool('reverseClip', 'Reverse the audio/MIDI content of a clip.', { clipId: { type: 'string' } }, ['clipId']),
    tool('normalizeClip', 'Normalize clip volume to peak level.', { clipId: { type: 'string' } }, ['clipId']),
    tool(
        'glueClips',
        'Merge multiple adjacent clips into one.',
        {
            clipIds: { type: 'array', items: { type: 'string' }, description: 'At least 2 clip IDs to merge' },
        },
        ['clipIds']
    ),
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
        'setClipLoopLength',
        'Set the loop length of a clip in beats.',
        {
            clipId: { type: 'string' },
            loopLength: { type: 'number' },
        },
        ['clipId', 'loopLength']
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

// ─── Devices & Effects ───────────────────────────────────────────────────

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

const deviceTools: ToolSchema[] = [
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

// ─── MIDI Editing ────────────────────────────────────────────────────────

const midiTools: ToolSchema[] = [
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
            pattern: { type: 'string', description: '"up", "down", "updown", "random"' },
            rate: { type: 'number', description: 'Note rate: 0.25=16th, 0.5=8th, 1=quarter' },
            octaves: { type: 'number', description: 'Number of octaves to span (1–4)' },
            gate: { type: 'number', description: 'Note length as fraction of step (0.5=staccato, 1.0=legato)' },
        },
        ['clipId']
    ),
];

// ─── Automation ──────────────────────────────────────────────────────────

const automationTools: ToolSchema[] = [
    tool(
        'addAutomationLane',
        'Create an automation lane for a track parameter.',
        {
            trackId: { type: 'string' },
            parameterId: { type: 'string', description: 'e.g. "gain", "pan", "mute", or a device param ID' },
            parameterName: { type: 'string', description: 'Display name for the lane' },
        },
        ['trackId', 'parameterId', 'parameterName']
    ),
    tool(
        'addAutomationPoint',
        'Add a point to an automation lane.',
        {
            laneId: { type: 'string' },
            beat: { type: 'number' },
            value: { type: 'number', description: 'Normalized 0.0–1.0' },
            curve: {
                type: 'string',
                enum: ['linear', 'step', 'exponential'],
                description: 'Interpolation between this point and the next',
            },
        },
        ['laneId', 'beat', 'value']
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
        'Scale all automation values in a lane by a factor.',
        {
            laneId: { type: 'string' },
            factor: { type: 'number' },
        },
        ['laneId', 'factor']
    ),
    tool(
        'invertAutomation',
        'Invert an automation lane (1.0 becomes 0.0 and vice versa).',
        { laneId: { type: 'string' } },
        ['laneId']
    ),
    tool('reverseAutomation', 'Reverse the direction of an automation lane.', { laneId: { type: 'string' } }, [
        'laneId',
    ]),
];

// ─── Routing & Buses ─────────────────────────────────────────────────────

const routingTools: ToolSchema[] = [
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
        'Set up sidechain routing (e.g. kick ducking the bass).',
        {
            sourceTrackId: { type: 'string', description: 'The trigger track (e.g. kick)' },
            targetTrackId: { type: 'string', description: 'The track being ducked (e.g. bass)' },
        },
        ['sourceTrackId', 'targetTrackId']
    ),
    tool(
        'removeSidechainRoute',
        'Remove a sidechain routing.',
        {
            sourceTrackId: { type: 'string' },
            targetTrackId: { type: 'string' },
        },
        ['sourceTrackId', 'targetTrackId']
    ),
];

// ─── AI / Generation ─────────────────────────────────────────────────────

const generationTools: ToolSchema[] = [
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
    tool('detectKey', 'Detect the musical key of an audio clip.', { clipId: { type: 'string' } }, ['clipId']),
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
    tool(
        'addNotes',
        'Write MIDI notes directly to a clip. Use this for any custom note content — melodies, chords, basslines, rhythms.',
        {
            clipId: { type: 'string', description: 'Target clip ID' },
            notes: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        pitch: { type: 'number', description: 'MIDI note number (60=C4, 64=E4, 67=G4)' },
                        startBeat: { type: 'number', description: 'Start position in beats within the clip' },
                        duration: { type: 'number', description: 'Note length in beats (0.25=16th, 0.5=8th, 1=quarter)' },
                        velocity: { type: 'number', description: '1-127, default 100' },
                    },
                },
                description: 'Array of notes to write',
            },
        },
        ['clipId', 'notes']
    ),
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
    tool(
        'generateAudio',
        'Generate audio from a text description using AI (MusicGen). Creates an audio clip on a track. Requires AI Audio Server running.',
        {
            prompt: { type: 'string', description: 'Text description of the audio to generate (e.g. "funky bass guitar in C minor", "ambient pad with reverb")' },
            durationSeconds: { type: 'number', description: 'Duration in seconds (1-30, default 8)' },
            trackId: { type: 'string', description: 'Optional: place on existing audio track' },
        },
        ['prompt']
    ),
    tool(
        'stemSeparate',
        'Separate an audio clip into individual stems using AI (Demucs): vocals, drums, bass, other. Creates new tracks for each stem.',
        {
            clipId: { type: 'string', description: 'Audio clip to separate' },
            stems: {
                type: 'array',
                items: { type: 'string' },
                description: 'Which stems to extract: "vocals", "drums", "bass", "other", or "all" (default)',
            },
        },
        ['clipId']
    ),
];

// ─── Markers & Sections ─────────────────────────────────────────────────

const markerTools: ToolSchema[] = [
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

// ─── Time Editing ────────────────────────────────────────────────────────

const timeTools: ToolSchema[] = [
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

// ─── Workspace & View ────────────────────────────────────────────────────

const workspaceTools: ToolSchema[] = [
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

/** All tool schemas exposed to the LLM via the system prompt. */
export const DAW_TOOL_SCHEMAS: ToolSchema[] = [
    ...trackTools,
    ...transportTools,
    ...clipTools,
    ...deviceTools,
    ...midiTools,
    ...automationTools,
    ...routingTools,
    ...generationTools,
    ...markerTools,
    ...timeTools,
    ...workspaceTools,
];

/**
 * Serialize a single tool to a compact function-signature string.
 * Instead of verbose JSON schema, uses: `name(param:type, ...) - description`
 * This dramatically reduces token count (~40 chars vs ~150+ chars per tool).
 */
function serializeTool(t: ToolSchema): string {
    const fn = t.function;
    const params = Object.entries(fn.parameters.properties)
        .map(([key, val]) => {
            const v = val as { type?: string; enum?: string[]; description?: string };
            const typeStr = v.enum ? v.enum.join('|') : (v.type ?? 'string');
            return `${key}:${typeStr}`;
        })
        .join(', ');
    return `${fn.name}(${params}) - ${fn.description}`;
}

/**
 * Serialize all tool schemas as compact function signatures for the system prompt.
 * Uses Hermes `<tools>` XML wrapper with one tool per line for readability.
 */
export function serializeToolsForPrompt(): string {
    return DAW_TOOL_SCHEMAS.map(serializeTool).join('\n');
}
