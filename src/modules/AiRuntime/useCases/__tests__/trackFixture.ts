import { type Track } from '#/modules/Arrangement/stores';

/**
 * A complete track, so a spec can seed `trackStore` without importing the Arrangement use-case barrel
 * and the graph of every module it reaches, which would widen any narrow barrel mock the spec holds.
 */
export function createTrack(overrides: Partial<Track>): Track {
    return {
        id: 't1',
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}
