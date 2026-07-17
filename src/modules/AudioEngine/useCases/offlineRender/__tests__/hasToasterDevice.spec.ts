import { describe, it, expect } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { hasToasterDevice } from '../hasToasterDevice';

// Local, field-identical replica of Arrangement's TrackDummy fixture — foreign
// test fixtures have no compliant cross-module path (models are not re-exported).
const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    }),
};

describe('hasToasterDevice', () => {
    it('should return false when there is no toaster device', () => {
        const track = TrackDummy.create({
            devices: [
                {
                    id: 'd1',
                    name: 'Gain',
                    type: 'gain',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        });
        expect(hasToasterDevice(track)).toBe(false);
    });

    it('should return true when a toaster device exists', () => {
        const track = TrackDummy.create({
            devices: [
                {
                    id: 'd1',
                    name: 'Toaster',
                    type: 'toaster',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        });
        expect(hasToasterDevice(track)).toBe(true);
    });
});
