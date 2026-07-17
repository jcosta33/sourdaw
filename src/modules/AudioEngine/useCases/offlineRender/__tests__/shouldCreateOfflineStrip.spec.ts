import { describe, it, expect } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { shouldCreateOfflineStrip } from '../shouldCreateOfflineStrip';

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

describe('shouldCreateOfflineStrip', () => {
    it('should return false for a folder track without a toaster', () => {
        const track = TrackDummy.create({
            kind: 'folder',
            devices: [],
        });
        expect(shouldCreateOfflineStrip(track)).toBe(false);
    });

    it('should return true for a non-folder track', () => {
        const track = TrackDummy.create({
            kind: 'audio',
            devices: [],
        });
        expect(shouldCreateOfflineStrip(track)).toBe(true);
    });

    it('should return true for a folder track that has a toaster device', () => {
        const track = TrackDummy.create({
            kind: 'folder',
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
        expect(shouldCreateOfflineStrip(track)).toBe(true);
    });
});
