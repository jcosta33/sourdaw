import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

/**
 * A range automation states its decibel figure the way a fader command does, and may hold one
 * change across several tracks named together: "Lift Drum Bus and Bass Bus by 1.5 dB in Chorus
 * Two". The figure is the one the request states, a list may close on one range phrase after it,
 * and everything a fader list refuses stays refused.
 */

type ProjectTrack = ProjectContext['tracks'][number];
type ProviderCalls = Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'];

function createTrack(id: string, name: string, kind: ProjectTrack['kind'] = 'audio'): ProjectTrack {
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
        sends: [],
    };
}

const projectContext: ProjectContext = {
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
        { id: 'section-chorus-one', name: 'Chorus One', startBeat: 32, endBeat: 48 },
        { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 },
    ],
    tracks: [
        createTrack('bus-drums', 'Drum Bus', 'bus'),
        createTrack('bus-bass', 'Bass Bus', 'bus'),
        createTrack('track-vocals', 'Vocals'),
        createTrack('master', 'Master', 'master'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function bridge(calls: ProviderCalls, prompt: string) {
    return bridgeGroundedLlmToolCalls({
        calls,
        prompt,
        context: projectContext,
        markerSignatures: [],
        sectionSignatures: [],
    });
}

function rangeCall(trackId: string, change: Record<string, unknown>, range: Record<string, unknown>) {
    return { name: 'automateParameterRange', arguments: { trackId, parameterId: 'gain', range, ...change } };
}

const CHORUS_TWO = { section: 'Chorus Two' };
const BUSES = ['bus-drums', 'bus-bass'] as const;

function busCalls(change: Record<string, unknown>, range: Record<string, unknown> = CHORUS_TWO): ProviderCalls {
    return BUSES.map((trackId) => rangeCall(trackId, change, range));
}

describe('range automation grounds the decibel figure and the shared target list its words state', () => {
    it.each([
        ['Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two', { deltaDb: 1.5 }, CHORUS_TWO],
        ['Dip Drum Bus and Bass Bus by 1.5 dB in Chorus Two', { deltaDb: -1.5 }, CHORUS_TWO],
        ['Dip Drum Bus and Bass Bus by 1.5 dB over bars 5 to 8.', { deltaDb: -1.5 }, { startBar: 5, endBar: 8 }],
    ])('grounds one call per listed track for "%s"', (prompt, change, range) => {
        const calls = busCalls(change, range);

        const result = bridge(calls, prompt);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual(calls.map((call) => ({ type: call.name, payload: call.arguments })));
    });

    it('grounds a pan range, which states no decibel figure, exactly as before', () => {
        const call = {
            name: 'automateParameterRange',
            arguments: { trackId: 'track-vocals', parameterId: 'pan', range: CHORUS_TWO, value: -0.5 },
        };

        const result = bridge([call], 'Automate the Vocals pan to the left in Chorus Two');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: call.name, payload: call.arguments }]);
    });

    it.each([
        ['a shared list', busCalls({ deltaDb: 2 }), 'Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two'],
        ['one track', [rangeCall('bus-drums', { deltaDb: 2 }, CHORUS_TWO)], 'Lift Drum Bus by 1.5 dB in Chorus Two'],
        [
            'one track, as a level',
            [rangeCall('bus-drums', { valueDb: -6 }, CHORUS_TWO)],
            'Lift Drum Bus by 1.5 dB in Chorus Two',
        ],
    ])('refuses a decibel figure the request does not state, on %s', (_case, calls, prompt) => {
        const result = bridge(calls, prompt);

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });

    it('refuses a decibel figure for one track the request does not name with a figure', () => {
        const result = bridge([rangeCall('bus-drums', { deltaDb: -6 }, CHORUS_TWO)], 'Duck the Drum Bus in Chorus Two');

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });

    it.each([
        ['a second decibel figure', 'Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two by 2 dB'],
        ['a tail that is no range phrase', 'Lift Drum Bus and Bass Bus by 1.5 dB loudly'],
        ['a tail naming another track', 'Lift Drum Bus and Bass Bus by 1.5 dB in Vocals'],
        ['a section the project lacks', 'Lift Drum Bus and Bass Bus by 1.5 dB in the Bridge'],
    ])('refuses a shared list followed by %s', (_case, prompt) => {
        const result = bridge(busCalls({ deltaDb: 1.5 }), prompt);

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });

    it('keeps a fader list closing on a range phrase refused, as fader commands have no range', () => {
        const calls = BUSES.map((trackId) => ({ name: 'setTrackGain', arguments: { trackId, deltaDb: -3 } }));

        const result = bridge(calls, 'Turn Drum Bus and Bass Bus down 3 dB in Chorus Two');

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });
});
