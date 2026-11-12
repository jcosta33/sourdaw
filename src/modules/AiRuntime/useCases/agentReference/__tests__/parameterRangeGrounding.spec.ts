import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

/**
 * A range automation writes across the one range the request states. Its `range` argument must
 * name the same beats as that phrase, read through the project the range writes into, and a
 * request that states anything after the range but its figure or its ramps may narrow it, which one
 * range write cannot honour.
 */

type ProjectTrack = ProjectContext['tracks'][number];
type Section = NonNullable<ProjectContext['sections']>[number];

const RANGE_MISMATCH = 'Provider value range does not match the user request';

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

function section(id: string, name: string, startBeat: number, endBeat: number): Section {
    return { id, name, startBeat, endBeat };
}

const CHORUS_ONE_AND_TWO = [section('s-one', 'Chorus One', 32, 48), section('s-two', 'Chorus Two', 56, 72)];
const CHORUS_AND_CHORUS_TWO = [section('s-chorus', 'Chorus', 32, 48), section('s-two', 'Chorus Two', 56, 72)];
const VERSE_AND_CHORUS = [section('s-verse', 'Verse', 0, 32), section('s-chorus', 'Chorus', 32, 48)];
const SYMBOL_SECTIONS = [section('s-stars', 'Chorus ***', 32, 48), section('s-b', 'Chorus B', 56, 72)];
const TWO_CHORUSES = [
    section('s-verse', 'Verse', 0, 32),
    section('s-chorus-1', 'Chorus', 32, 48),
    section('s-verse-2', 'Verse', 48, 80),
    section('s-chorus-2', 'Chorus', 80, 96),
];

function bridge(
    range: Record<string, unknown>,
    prompt: string,
    sections: readonly Section[] = CHORUS_ONE_AND_TWO,
    change: Record<string, unknown> = { deltaDb: -1.5 }
) {
    return bridgeGroundedLlmToolCalls({
        calls: [
            {
                name: 'automateParameterRange',
                arguments: { trackId: 'bus-drums', parameterId: 'gain', range, ...change },
            },
        ],
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
            sections: [...sections],
            tracks: [createTrack('bus-drums', 'Drum Bus', 'bus'), createTrack('master', 'Master', 'master')],
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

describe('a range automation writes across the range its request states', () => {
    it.each([
        {
            case: 'the section it names',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus Two',
            range: { section: 'Chorus Two' },
        },
        {
            case: 'the section it names before its figure',
            prompt: 'Dip Drum Bus in Chorus Two by 1.5 dB',
            range: { section: 'Chorus Two' },
        },
        {
            case: 'the beats of the section it names',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus Two',
            range: { startBeat: 56, endBeat: 72 },
        },
        {
            case: 'a run of bars',
            prompt: 'Dip Drum Bus by 1.5 dB over bars 5 to 8.',
            range: { startBar: 5, endBar: 8 },
        },
        {
            case: 'a span of beats',
            prompt: 'Dip Drum Bus by 1.5 dB from beat 16 to beat 48',
            range: { startBeat: 16, endBeat: 48 },
        },
        {
            case: 'a span of beats stated with over',
            prompt: 'Dip Drum Bus by 1.5 dB over beats 16 to 48',
            range: { startBeat: 16, endBeat: 48 },
        },
    ])('grounds $case', ({ prompt, range }) => {
        const result = bridge(range, prompt);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toHaveLength(1);
    });

    it.each([
        { reference: 'the second chorus', range: { section: 'the second chorus' } },
        { reference: 'the second chorus', range: { section: 'Chorus 2' } },
        { reference: 'the second chorus', range: { startBeat: 80, endBeat: 96 } },
    ])('grounds the ordinal "$reference" as the range $range', ({ reference, range }) => {
        const result = bridge(range, `Dip Drum Bus by 1.5 dB in ${reference}`, TWO_CHORUSES);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toHaveLength(1);
    });

    it('grounds a range the request closes with its ramps', () => {
        const result = bridge(
            { section: 'Chorus Two' },
            'Duck the Drum Bus by 4 dB during Chorus Two, ramping in and out over one beat.',
            CHORUS_ONE_AND_TWO,
            { deltaDb: -4, rampIn: 1, rampOut: 1 }
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toHaveLength(1);
    });

    it.each([
        {
            case: 'the contained section for a request naming the longer one',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus Two',
            range: { section: 'Chorus' },
            sections: CHORUS_AND_CHORUS_TWO,
        },
        {
            case: 'the longer section for a request naming the contained one',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus',
            range: { section: 'Chorus Two' },
            sections: CHORUS_AND_CHORUS_TWO,
        },
        {
            case: 'one section for a request naming two apart',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus and Chorus Two',
            range: { section: 'Chorus Two' },
            sections: CHORUS_AND_CHORUS_TWO,
        },
        {
            case: 'the section whose name the request states only in part',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus B',
            range: { section: 'Chorus ***' },
            sections: SYMBOL_SECTIONS,
        },
        {
            case: 'the shorter section a request only contains',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus Two',
            range: { section: 'Chorus' },
            sections: VERSE_AND_CHORUS,
        },
        {
            case: 'the shorter section a request only contains, before its figure',
            prompt: 'Dip Drum Bus in Chorus Two by 1.5 dB',
            range: { section: 'Chorus' },
            sections: VERSE_AND_CHORUS,
        },
        {
            case: 'a range narrowed by a later clause',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus Two, but not in the first half',
            range: { section: 'Chorus Two' },
            sections: CHORUS_ONE_AND_TWO,
        },
        {
            case: 'a range narrowed after it',
            prompt: 'Dip Drum Bus by 1.5 dB in Chorus Two except the last bar',
            range: { section: 'Chorus Two' },
            sections: CHORUS_ONE_AND_TWO,
        },
        {
            case: 'a run of bars the request does not state',
            prompt: 'Dip Drum Bus by 1.5 dB over bars 5 to 8.',
            range: { startBar: 5, endBar: 9 },
            sections: CHORUS_ONE_AND_TWO,
        },
        {
            case: 'a section the project does not hold',
            prompt: 'Dip Drum Bus by 1.5 dB in the Bridge',
            range: { section: 'Bridge' },
            sections: CHORUS_ONE_AND_TWO,
        },
        {
            case: 'a range the request never states',
            prompt: 'Dip Drum Bus by 1.5 dB',
            range: { section: 'Chorus Two' },
            sections: CHORUS_ONE_AND_TWO,
        },
    ])('refuses $case', ({ prompt, range, sections }) => {
        expect(bridge(range, prompt, sections)).toEqual({
            actions: [],
            rejections: [{ index: 0, name: 'automateParameterRange', reason: RANGE_MISMATCH }],
        });
    });
});
