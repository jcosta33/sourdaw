import { type PresetAction } from './Types';

export const transportPresets: readonly PresetAction[] = [
    {
        id: 'play',
        label: 'Play',
        keywords: ['play', 'start playback', 'resume', 'resume playback'],
        category: 'Transport',
        buildAction: () => ({ type: 'setPlayback', payload: { playing: true } }),
    },
    {
        id: 'pause',
        label: 'Pause',
        keywords: ['pause', 'pause playback'],
        category: 'Transport',
        buildAction: () => ({ type: 'setPlayback', payload: { playing: false } }),
    },
    {
        id: 'stop',
        label: 'Stop',
        keywords: ['stop', 'halt'],
        category: 'Transport',
        buildAction: () => ({ type: 'stopPlayback' }),
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
