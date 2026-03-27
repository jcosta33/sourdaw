import { type PresetAction } from './types';

export const transportPresets: readonly PresetAction[] = [
    {
        id: 'play',
        label: 'Play / Pause',
        keywords: ['play', 'start', 'playback', 'resume', 'pause'],
        category: 'Transport',
        buildAction: () => ({ type: 'togglePlayback' }),
    },
    {
        id: 'stop',
        label: 'Stop',
        keywords: ['stop', 'halt'],
        category: 'Transport',
        buildAction: () => ({ type: 'stopPlayback' }),
    },
    {
        id: 'record',
        label: 'Record',
        keywords: ['record', 'recording', 'arm recording'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleRecording' }),
    },
    {
        id: 'loop',
        label: 'Toggle Loop',
        keywords: ['loop', 'cycle', 'toggle loop'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleLoop' }),
    },
    {
        id: 'metronome',
        label: 'Toggle Metronome',
        keywords: ['metronome', 'click', 'click track', 'toggle metronome'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleMetronome' }),
    },
    {
        id: 'punch',
        label: 'Toggle Punch In/Out',
        keywords: ['punch', 'punch in', 'punch out', 'toggle punch'],
        category: 'Transport',
        buildAction: () => ({ type: 'togglePunch' }),
    },
    {
        id: 'count-in',
        label: 'Toggle Count-In',
        keywords: ['count in', 'count-in', 'precount', 'toggle count'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleCountIn' }),
    },
    {
        id: 'pre-roll',
        label: 'Toggle Pre-Roll',
        keywords: ['pre roll', 'pre-roll', 'preroll'],
        category: 'Transport',
        buildAction: () => ({ type: 'togglePreRoll' }),
    },
];
