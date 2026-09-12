/**
 * The two-pass session programme (#4153).
 *
 * The first read is what the carrier law is decided from, and the second is
 * what corrects the figures once the carriers are known. What this file owns is
 * that relationship: how many reads a session takes, and which strips the
 * second one is told the engine hosts. The figures themselves belong to
 * `getCompensationDelay.spec.ts`, so the reader and the carrier law are both
 * mocked here and only their arguments are observed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';

vi.mock('../readLiveGraphProgramme', () => ({ readLiveGraphProgramme: vi.fn() }));
vi.mock('../stripCarriers', () => ({ projectStripCarriers: vi.fn() }));

import { type LiveGraphProgramme } from '../projectLiveGraphProgramme';
import { readLiveGraphProgramme } from '../readLiveGraphProgramme';
import { readSessionProgramme } from '../readSessionProgramme';
import { projectStripCarriers, type StripCarrier } from '../stripCarriers';

const SAMPLE_RATE = 48_000;

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

/** A programme distinguishable by its exclusions, so the reads can be told apart. */
function programme(tag: string): LiveGraphProgramme {
    return {
        playbacksByStripId: new Map(),
        bakedStripIds: new Set(),
        webVoicedStripIds: new Set(),
        exclusions: [{ stripId: tag, subjectId: tag, reason: tag }],
    };
}

function readEach(stripTracks: readonly Track[]): LiveGraphProgramme {
    return readSessionProgramme({
        stripTracks,
        inputMonitoredTrackIds: new Set(),
        attachedInstanceIds: new Set(),
        sampleRate: SAMPLE_RATE,
    });
}

/** The `engineHostedStripIds` each read was given, in call order. */
function hostedSetsPerRead(): readonly (ReadonlySet<string> | undefined)[] {
    return vi.mocked(readLiveGraphProgramme).mock.calls.map((call) => call[0].engineHostedStripIds);
}

beforeEach(() => {
    vi.mocked(readLiveGraphProgramme).mockReset();
    vi.mocked(readLiveGraphProgramme).mockReturnValueOnce(programme('first')).mockReturnValue(programme('second'));
    vi.mocked(projectStripCarriers).mockReset();
});

describe('readSessionProgramme', () => {
    // A session with nothing to correct must not pay for a second projection,
    // and the reader it hands out must be the plain one: an empty hosted set
    // and no set at all read the same, but only one of them says so.
    it('reads once when no native strip holds a body the engine compensates', () => {
        const tracks = [createTrack({ id: 'guitar', devices: [device('d-knead', 'knead')] })];
        vi.mocked(projectStripCarriers).mockReturnValue(new Map([['guitar', NATIVE]]));

        const result = readEach(tracks);

        expect(hostedSetsPerRead()).toEqual([undefined]);
        expect(result).toEqual(programme('first'));
    });

    // The correcting read is the session's programme, and the set it carries
    // has to name the bus as well: a bus twin is the engine's whenever a track
    // is, and its body deepens every route through it.
    it('reads again for a native bacteria, naming its strip and the bus it feeds', () => {
        const tracks = [
            createTrack({ id: 'guitar', outputId: 'bus-fx', devices: [device('d-bac', 'bacteria')] }),
            createTrack({ id: 'bus-fx', kind: 'bus', devices: [device('d-bus-bac', 'bacteria')] }),
        ];
        vi.mocked(projectStripCarriers).mockReturnValue(new Map([['guitar', NATIVE]]));

        const result = readEach(tracks);

        expect(hostedSetsPerRead()).toEqual([undefined, new Set(['guitar', 'bus-fx'])]);
        expect(result).toEqual(programme('second'));
    });

    // A web-carried strip's Bacteria is a gated-shut worklet reporting its own
    // figure, and that report is the only thing aligning it: naming it here
    // would drop a hold the Web Audio graph really needs.
    it('leaves a web-carried bacteria strip out of the set it names', () => {
        const tracks = [
            createTrack({ id: 'guitar', devices: [device('d-bac', 'bacteria')] }),
            createTrack({ id: 'keys', devices: [device('d-bac-web', 'bacteria')] }),
        ];
        vi.mocked(projectStripCarriers).mockReturnValue(
            new Map<string, StripCarrier>([
                ['guitar', NATIVE],
                ['keys', WEB],
            ])
        );

        readEach(tracks);

        expect(hostedSetsPerRead()).toEqual([undefined, new Set(['guitar'])]);
    });

    // The carrier law reads the programme's shape, never its figures, so the
    // first read is what it is given — a second read aimed at a set the law
    // has not yet produced would be circular.
    it('decides the carriers against the first read', () => {
        const tracks = [createTrack({ id: 'guitar', devices: [device('d-bac', 'bacteria')] })];
        vi.mocked(projectStripCarriers).mockReturnValue(new Map([['guitar', NATIVE]]));

        readEach(tracks);

        expect(vi.mocked(projectStripCarriers).mock.calls).toHaveLength(1);
        expect(vi.mocked(projectStripCarriers).mock.calls[0]?.[0].programme).toEqual(programme('first'));
    });
});
