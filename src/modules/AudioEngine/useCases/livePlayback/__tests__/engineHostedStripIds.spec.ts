/**
 * Which strips the renderer stops counting a latency for (#4153).
 *
 * Two conditions decide one strip, and getting either wrong is audible in a
 * different direction: excluding a strip the engine does not carry drops a
 * hold the Web Audio graph really needs, and including a carried strip's
 * engine-compensated device counts one delay twice. The helper is pure, so
 * nothing is mocked.
 */

import { describe, expect, it } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { engineHostedStripIds } from '../engineHostedStripIds';
import { type StripCarrier } from '../stripCarriers';

function createTrack(overrides: Partial<Track> & { id: string }): Track {
    return {
        name: `name-${overrides.id}`,
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
        outputId: 'hw_out',
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
    };
}

function device(id: string, type: string): Device {
    return { id, name: id, type, bypassed: false, parameterValues: {} };
}

const NATIVE: StripCarrier = { carrier: 'native' };
const WEB: StripCarrier = { carrier: 'web', reason: 'a device the engine cannot build' };

describe('engineHostedStripIds', () => {
    it('names a native strip holding a body the engine compensates', () => {
        const tracks = [createTrack({ id: 'guitar', devices: [device('d-bac', 'bacteria')] })];

        expect([...engineHostedStripIds(new Map([['guitar', NATIVE]]), tracks)]).toEqual(['guitar']);
    });

    // The engine compensates a device it is running. A web-carried strip's
    // Bacteria is a gated-shut worklet reporting its own figure, and that
    // report is the only thing aligning it.
    it('leaves a web-carried strip out however it is equipped', () => {
        const tracks = [createTrack({ id: 'guitar', devices: [device('d-bac', 'bacteria')] })];

        expect([...engineHostedStripIds(new Map([['guitar', WEB]]), tracks)]).toEqual([]);
    });

    // A track with no carrier entry was not decided native, so a missing entry
    // has to read as "not the engine's", never as native by default.
    it('leaves a track with no carrier entry out', () => {
        const tracks = [createTrack({ id: 'guitar', devices: [device('d-bac', 'bacteria')] })];

        expect([...engineHostedStripIds(new Map(), tracks)]).toEqual([]);
    });

    // Buses get no carrier entry at all (`projectStripCarriers`), and a bus
    // twin is built natively whenever the engine carries any track. Its body
    // deepens every route through it, so leaving it out understates the hold
    // the engine already took and double-delays every strip beside that route.
    it('names a bus holding a compensated body once a track is native', () => {
        const tracks = [
            createTrack({ id: 'guitar', outputId: 'bus-fx' }),
            createTrack({ id: 'bus-fx', kind: 'bus', devices: [device('d-bac', 'bacteria')] }),
        ];

        expect([...engineHostedStripIds(new Map([['guitar', NATIVE]]), tracks)]).toEqual(['bus-fx']);
    });

    // With no track the engine's, no native bus twin was built either: the
    // Web Audio bus really is delaying by its own worklet's reported figure.
    it('leaves a bus out when the engine carries no track', () => {
        const tracks = [
            createTrack({ id: 'guitar', outputId: 'bus-fx' }),
            createTrack({ id: 'bus-fx', kind: 'bus', devices: [device('d-bac', 'bacteria')] }),
        ];

        expect([...engineHostedStripIds(new Map([['guitar', WEB]]), tracks)]).toEqual([]);
    });

    // An empty answer is what tells the caller its sum needs no correcting at
    // all, so a native strip carrying only bodies the engine declares nothing
    // for must not appear.
    it('leaves a native strip holding no compensated body out', () => {
        const tracks = [createTrack({ id: 'guitar', devices: [device('d-knead', 'knead')] })];

        expect([...engineHostedStripIds(new Map([['guitar', NATIVE]]), tracks)]).toEqual([]);
    });

    it('names each qualifying strip of a mixed session once', () => {
        const tracks = [
            createTrack({ id: 'guitar', devices: [device('d-bac', 'bacteria'), device('d-knead', 'knead')] }),
            createTrack({ id: 'drums', devices: [device('d-bac-2', 'bacteria')] }),
            createTrack({ id: 'keys', devices: [device('d-bac-3', 'bacteria')] }),
        ];

        const carriers = new Map<string, StripCarrier>([
            ['guitar', NATIVE],
            ['drums', WEB],
            ['keys', NATIVE],
        ]);

        expect([...engineHostedStripIds(carriers, tracks)]).toEqual(['guitar', 'keys']);
    });
});
