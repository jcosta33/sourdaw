import { describe, it, expect, vi } from 'vitest';

vi.mock('../isOfflineInstrumentDevice', () => ({
    isOfflineInstrumentDevice: (type: string) => type === 'levain' || type === 'fermenter',
}));

import { projectStripTrack } from '../projectStripTrack';

import type { Track } from '#/modules/Arrangement/stores';

function makeTrack(overrides: Partial<Track> = {}): Track {
    return {
        id: 't1',
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#999',
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
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 't1-alt',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

describe('projectStripTrack — isTarget=false passthrough', () => {
    it('returns the track unchanged for non-target tracks', () => {
        const track = makeTrack({ gain: 0.5, pan: -0.3 });
        const result = projectStripTrack({
            track,
            isTarget: false,
            includeInserts: true,
            includeAutomation: true,
            targetMixer: 'bake',
        });
        expect(result).toBe(track);
    });
});

describe('projectStripTrack — keepLive vs bake mixer disposition', () => {
    it('keepLive forces UNITY_GAIN (1) and CENTRE_PAN (0), not NEUTRAL_GAIN', () => {
        const track = makeTrack({ gain: 0.8, pan: 0.5 });
        const result = projectStripTrack({
            track,
            isTarget: true,
            includeInserts: true,
            includeAutomation: true,
            targetMixer: 'keepLive',
        });
        // The critical regression guard: keepLive uses unity (1), NOT neutral (0.8).
        expect(result.gain).toBe(1);
        expect(result.pan).toBe(0);
    });

    it('bake with includeAutomation leaves gain/pan at track values', () => {
        const track = makeTrack({ gain: 0.6, pan: -0.2 });
        const result = projectStripTrack({
            track,
            isTarget: true,
            includeInserts: true,
            includeAutomation: true,
            targetMixer: 'bake',
        });
        expect(result.gain).toBe(0.6);
        expect(result.pan).toBe(-0.2);
    });

    it('bake without includeAutomation forces NEUTRAL_GAIN (0.8) and NEUTRAL_PAN (0)', () => {
        const track = makeTrack({ gain: 0.3, pan: 0.7 });
        const result = projectStripTrack({
            track,
            isTarget: true,
            includeInserts: true,
            includeAutomation: false,
            targetMixer: 'bake',
        });
        expect(result.gain).toBe(0.8);
        expect(result.pan).toBe(0);
    });
});

describe('projectStripTrack — includeInserts device filtering', () => {
    it('includeInserts=true keeps all devices', () => {
        const track = makeTrack({
            devices: [
                { type: 'levain', name: 'Levain', bypassed: false } as never,
                { type: 'gluten', name: 'Gluten', bypassed: false } as never,
            ],
        });
        const result = projectStripTrack({
            track,
            isTarget: true,
            includeInserts: true,
            includeAutomation: true,
            targetMixer: 'bake',
        });
        expect(result.devices).toHaveLength(2);
    });

    it('includeInserts=false filters to offline-instrument devices only', () => {
        const track = makeTrack({
            devices: [
                { type: 'levain', name: 'Levain', bypassed: false } as never,
                { type: 'gluten', name: 'Gluten', bypassed: false } as never,
                { type: 'fermenter', name: 'Fermenter', bypassed: false } as never,
            ],
        });
        const result = projectStripTrack({
            track,
            isTarget: true,
            includeInserts: false,
            includeAutomation: true,
            targetMixer: 'bake',
        });
        // Only levain and fermenter are offline instruments (per mock).
        expect(result.devices).toHaveLength(2);
        expect(result.devices.every((d) => d.type === 'levain' || d.type === 'fermenter')).toBe(true);
    });
});
