/**
 * The programme a session with no clock to place its material on gets (#3068).
 *
 * An unconfigured projector answers no programme rather than a guessed one, and
 * the answer has two halves that are easy to get half right: nothing native is
 * scheduled, and every strip holding live material is one Web Audio alone
 * voices. Naming no strip there would tell the carrier law a project full of
 * clips has nothing to sound, and every plugin strip in it would be carried
 * natively over material the native engine never received.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn(() => 0),
}));

import { offlinePpqEndpointProjectorState } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getCompensationDelay } from '../../latencyCompensation/compensation/getCompensationDelay';
import { readLiveGraphProgramme } from '../readLiveGraphProgramme';

const SAMPLE_RATE = 48_000;

function createTrack(overrides?: Partial<Track>): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'midi',
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

function midiClip(): Track['clips'][number] {
    return {
        id: 'notes',
        trackId: 'midi-1',
        name: 'notes',
        startBeat: 0,
        endBeat: 2,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
    };
}

/** The projector the composition root injects, at a flat 120 BPM. */
function configureProjector(): void {
    offlinePpqEndpointProjectorState.project = ({ startPpq, endPpq, sampleRate }) => {
        const startSeconds = startPpq * 0.5;
        const endSeconds = endPpq * 0.5;
        return {
            startSamples: startSeconds * sampleRate,
            endSamples: endSeconds * sampleRate,
            durationSamples: (endSeconds - startSeconds) * sampleRate,
            startSeconds,
            endSeconds,
            durationSeconds: endSeconds - startSeconds,
        };
    };
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = () => 120;
}

beforeEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
    vi.mocked(getCompensationDelay).mockClear();
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
});

describe('readLiveGraphProgramme', () => {
    it('names the strips Web Audio is left to voice when there is no clock to place them on', () => {
        const programme = readLiveGraphProgramme({
            stripTracks: [createTrack({ id: 'midi-1', clips: [midiClip()] })],
            attachedInstanceIds: new Set(),
            sampleRate: SAMPLE_RATE,
        });

        expect(programme.playbacksByStripId.size).toBe(0);
        expect(programme.webVoicedStripIds.has('midi-1')).toBe(true);
    });

    // The engine-hosted set is what stops a device the native engine
    // compensates itself from being counted twice, and this reader is where a
    // session states it. Read at the compensation boundary rather than off a
    // figure, because the correction is invisible in a project holding no such
    // device.
    it('reads its strips against the engine-hosted set the session names', () => {
        configureProjector();
        const hosted: ReadonlySet<string> = new Set(['audio-1']);

        readLiveGraphProgramme({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'audio' })],
            attachedInstanceIds: new Set(),
            sampleRate: SAMPLE_RATE,
            engineHostedStripIds: hosted,
        });

        expect(vi.mocked(getCompensationDelay).mock.calls).toEqual([['audio-1', undefined, hosted]]);
    });

    // A session naming none is the web-carried case, where every device counts
    // and a gated worklet's own reported figure is what aligns the strip.
    it('reads its strips against no hosted set when the session names none', () => {
        configureProjector();

        readLiveGraphProgramme({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'audio' })],
            attachedInstanceIds: new Set(),
            sampleRate: SAMPLE_RATE,
        });

        expect(vi.mocked(getCompensationDelay).mock.calls).toEqual([['audio-1', undefined, undefined]]);
    });
});
