import { type RuntimeAction } from '../../RuntimeAction';

import { type PresetAction, type PresetContext } from './Types';

function buildLoopToggle(ctx: PresetContext): RuntimeAction | null {
    if (ctx.loopEnabled === undefined) {
        return null;
    }
    return { type: 'setLoopEnabled', payload: { enabled: !ctx.loopEnabled } };
}

function buildMetronomeToggle(ctx: PresetContext): RuntimeAction | null {
    if (ctx.metronomeEnabled === undefined) {
        return null;
    }
    return { type: 'setMetronomeEnabled', payload: { enabled: !ctx.metronomeEnabled } };
}

function buildCountInToggle(ctx: PresetContext): RuntimeAction | null {
    if (ctx.countInEnabled === undefined) {
        return null;
    }
    return { type: 'toggleCountIn', payload: { enabled: !ctx.countInEnabled } };
}

function buildPreRollToggle(ctx: PresetContext): RuntimeAction | null {
    if (ctx.preRollEnabled === undefined) {
        return null;
    }
    return { type: 'togglePreRoll', payload: { enabled: !ctx.preRollEnabled } };
}

export const transportPresets: readonly PresetAction[] = [
    {
        id: 'play',
        label: 'Play',
        keywords: ['play', 'start playback', 'resume', 'resume playback'],
        commandAliases: ['start playback', 'resume', 'resume playback'],
        category: 'Transport',
        buildAction: () => ({ type: 'setPlayback', payload: { playing: true } }),
    },
    {
        id: 'pause',
        label: 'Pause',
        keywords: ['pause', 'pause playback'],
        commandAliases: ['pause playback'],
        category: 'Transport',
        buildAction: () => ({ type: 'setPlayback', payload: { playing: false } }),
    },
    {
        id: 'stop',
        label: 'Stop',
        keywords: ['stop', 'halt'],
        commandAliases: ['halt'],
        category: 'Transport',
        buildAction: () => ({ type: 'stopPlayback' }),
    },
    {
        id: 'loop',
        label: 'Toggle Loop',
        keywords: ['loop', 'cycle', 'toggle loop'],
        commandAliases: ['loop', 'cycle'],
        category: 'Transport',
        buildAction: buildLoopToggle,
    },
    {
        id: 'metronome',
        label: 'Toggle Metronome',
        keywords: ['metronome', 'click', 'click track', 'toggle metronome'],
        category: 'Transport',
        buildAction: buildMetronomeToggle,
    },
    {
        id: 'punch-in-out-on',
        label: 'Enable Punch In/Out',
        keywords: ['enable punch in/out', 'turn punch in/out on'],
        category: 'Transport',
        buildAction: () => ({ type: 'setPunchEnabled', payload: { enabled: true } }),
    },
    {
        id: 'punch-in-out-off',
        label: 'Disable Punch In/Out',
        keywords: ['disable punch in/out', 'turn punch in/out off'],
        category: 'Transport',
        buildAction: () => ({ type: 'setPunchEnabled', payload: { enabled: false } }),
    },
    {
        id: 'count-in',
        label: 'Toggle Count-In',
        keywords: ['count in', 'count-in', 'precount', 'toggle count'],
        category: 'Transport',
        buildAction: buildCountInToggle,
    },
    {
        id: 'pre-roll',
        label: 'Toggle Pre-Roll',
        keywords: ['pre roll', 'pre-roll', 'preroll'],
        category: 'Transport',
        buildAction: buildPreRollToggle,
    },
];
