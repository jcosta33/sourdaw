import { FADER_GAIN_RANGE_DESCRIPTION } from '#/utils/audioLevelLaw';

import { tool, type ToolSchema } from './Types';

export const transportTools: readonly ToolSchema[] = [
    tool(
        'setTempo',
        'Set the tempo in BPM. Range: 20–300. With a tempo map, edits the tempo event governing the playhead.',
        { bpm: { type: 'number' } },
        ['bpm']
    ),
    tool(
        'setPlayback',
        'Set playback explicitly to playing or paused.',
        { playing: { type: 'boolean', description: 'true=start playback, false=pause playback' } },
        ['playing']
    ),
    tool('stopPlayback', 'Stop playback and return playhead to start.', {}),
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
            gain: { type: 'number', description: FADER_GAIN_RANGE_DESCRIPTION },
        },
        ['gain']
    ),
    tool('setPunchIn', 'Set the punch-in point for recording.', { beat: { type: 'number' } }, ['beat']),
    tool('setPunchOut', 'Set the punch-out point for recording.', { beat: { type: 'number' } }, ['beat']),
    tool(
        'setPunchEnabled',
        'Enable or disable Transport Punch In/Out until changed without changing punch endpoints.',
        { enabled: { type: 'boolean' } },
        ['enabled']
    ),
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
