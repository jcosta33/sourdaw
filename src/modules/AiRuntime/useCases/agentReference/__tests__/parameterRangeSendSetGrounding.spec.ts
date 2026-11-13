import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

/**
 * A clause riding the sends of a set of sources to one bus takes one range write per member: the set
 * is read once, with the bus as its destination, and every call must move exactly one member's send
 * to that bus by the one figure across the one range the clause states.
 */

type ProjectTrack = ProjectContext['tracks'][number];

const HALL_SEND = [{ busId: 'bus-hall', level: 0.5, preFader: false }];
const BOTH_SENDS = [...HALL_SEND, { busId: 'bus-plate', level: 0.5, preFader: false }];
const VOCALS = ['track-lead-vocal', 'track-backing-vocal'];

function track(id: string, name: string, kind: ProjectTrack['kind'], sends: ProjectTrack['sends'] = []): ProjectTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends,
    };
}

type Ride = { trackId: string; busId?: string; deltaDb?: number; range?: Record<string, unknown> };

function bridge(prompt: string, rides: readonly Ride[]) {
    return bridgeGroundedLlmToolCalls({
        calls: rides.map(({ trackId, busId = 'bus-hall', deltaDb = -3, range = { section: 'Verse Two' } }) => ({
            name: 'automateParameterRange',
            arguments: { trackId, parameterId: `send:${busId}`, range, deltaDb },
        })),
        prompt,
        context: {
            tempo: 120,
            timeSignature: [4, 4],
            isPlaying: false,
            isRecording: false,
            isLooping: false,
            loopStart: 0,
            loopEnd: 16,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 16,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            masterGain: 0.8,
            sections: [
                { id: 'section-verse-one', name: 'Verse One', startBeat: 0, endBeat: 32 },
                { id: 'section-verse-two', name: 'Verse Two', startBeat: 32, endBeat: 64 },
            ],
            tracks: [
                track('track-lead-vocal', 'Lead Vocal', 'audio', BOTH_SENDS),
                track('track-backing-vocal', 'Backing Vocal', 'audio', BOTH_SENDS),
                track('track-spoken-word', 'Spoken Word', 'audio', HALL_SEND),
                track('bus-hall', 'Hall', 'bus'),
                track('bus-plate', 'Plate', 'bus'),
                track('master', 'Master', 'master'),
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'mix',
            playheadPosition: 0,
        },
        markerSignatures: [],
        sectionSignatures: [],
    });
}

const EVERY_VOCAL = 'Lower every vocal send to the Hall by 3 dB only in verse two.';
const NAMED_VOCALS = 'Lower the Lead Vocal and Backing Vocal sends to the Hall by 3 dB in Verse Two';

describe('a clause riding a set of sends to one bus', () => {
    it.each([
        { prompt: EVERY_VOCAL, rides: VOCALS.map((trackId) => ({ trackId })) },
        { prompt: 'Duck the Lead Vocal send to Hall by 3 dB in Verse Two', rides: [{ trackId: 'track-lead-vocal' }] },
        { prompt: 'Lower send from Lead Vocal to Hall by 3 dB in Verse Two', rides: [{ trackId: 'track-lead-vocal' }] },
    ])('grounds "$prompt" one write per member', ({ prompt, rides }) => {
        const result = bridge(prompt, rides);

        expect(result.rejections).toEqual([]);
        expect(result.actions.map((action) => action.payload)).toEqual(
            rides.map(({ trackId }) =>
                expect.objectContaining({
                    trackId,
                    parameterId: 'send:bus-hall',
                    deltaDb: -3,
                    range: { section: 'Verse Two' },
                })
            )
        );
    });

    it.each<{ case: string; prompt?: string; rides: readonly Ride[] }>([
        {
            case: 'a call for a track outside the set',
            rides: [...VOCALS, 'track-spoken-word'].map((trackId) => ({ trackId })),
        },
        { case: 'a set missing a member', rides: [{ trackId: 'track-lead-vocal' }] },
        { case: 'a different bus', rides: VOCALS.map((trackId) => ({ trackId, busId: 'bus-plate' })) },
        {
            case: 'a second figure',
            rides: [{ trackId: 'track-lead-vocal' }, { trackId: 'track-backing-vocal', deltaDb: -6 }],
        },
        {
            case: 'a range other than the one stated',
            rides: VOCALS.map((trackId) => ({ trackId, range: { section: 'Verse One' } })),
        },
        {
            case: 'one member on a range other than the one stated',
            rides: [
                { trackId: 'track-lead-vocal' },
                { trackId: 'track-backing-vocal', range: { section: 'Verse One' } },
            ],
        },
        {
            // The retired `automateSendRange` grounded no named list of sources either: the set reading
            // reads a category ("every vocal send"), and a list whose tail names the bus is no list.
            case: 'a named list of sources whose tail names the bus',
            prompt: NAMED_VOCALS,
            rides: VOCALS.map((trackId) => ({ trackId })),
        },
    ])('refuses $case', ({ prompt = EVERY_VOCAL, rides }) => {
        const result = bridge(prompt, rides);

        expect(result.actions).toEqual([]);
        expect(result.rejections.length).toBeGreaterThan(0);
    });
});
