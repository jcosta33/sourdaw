import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../../models/ProjectContext';
import { hasTrailingIntentCancellation } from '../hasTrailingIntentCancellation';
import { maskProjectReferences } from '../maskProjectReferences';
import { resolveClauseActionIntent } from '../resolveClauseActionIntent';

const catalog = getExecutableAppActionGroundingCatalog();

const vocalsTrack: ProjectContextTrack = {
    id: 'track-vocals',
    name: 'Vocals',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    outputId: 'master',
    clipCount: 1,
    deviceCount: 0,
    clips: [{ id: 'clip-intro', name: 'Intro', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 }],
    devices: [],
    sends: [],
};

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 4,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 4,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [vocalsTrack],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('resolveClauseActionIntent', () => {
    it('resolves an exact intent phrase once the named clip is masked out', () => {
        const prompt = 'split the Intro clip at beat 4';
        const masked = maskProjectReferences(prompt, context);

        expect(resolveClauseActionIntent(masked, catalog)).toEqual({
            actionType: 'splitClip',
            index: 0,
            phrase: 'split the clip',
        });
    });

    it('returns null for a clause opened by a negation', () => {
        expect(resolveClauseActionIntent('do not stop playback', catalog)).toBeNull();
    });

    it('resolves a negated intent inside an explicit clause to no action', () => {
        expect(resolveClauseActionIntent('make it brighter but do not stop playback', catalog)).toBeNull();
    });

    it('resolves a directionally phrased gain clause to its owning action', () => {
        expect(resolveClauseActionIntent('turn down the master', catalog)).toEqual({
            actionType: 'setTrackGain',
            index: 0,
            phrase: 'turn down',
        });
    });
});

describe('hasTrailingIntentCancellation', () => {
    const prompt =
        'glue MIDI Intro and MIDI Verse clips, then cancel that command because the timing is wrong, then set tempo to 130';
    const plannedActionNames = ['glueClips', 'setTempo'];

    it('attributes a trailing cancellation to the action it withdraws', () => {
        expect(hasTrailingIntentCancellation(prompt, 'glueClips', catalog, plannedActionNames)).toBe(true);
    });

    it('does not attribute the cancellation to an unrelated planned action', () => {
        expect(hasTrailingIntentCancellation(prompt, 'setTempo', catalog, plannedActionNames)).toBe(false);
    });

    it('attributes a cancellation to the nearest preceding intent clause, not the farthest', () => {
        const twoClausePrompt = 'set tempo to 130, then glue MIDI Intro and MIDI Verse clips, then cancel that command';

        expect(hasTrailingIntentCancellation(twoClausePrompt, 'glueClips', catalog, ['glueClips', 'setTempo'])).toBe(
            true
        );
        expect(hasTrailingIntentCancellation(twoClausePrompt, 'setTempo', catalog, ['glueClips', 'setTempo'])).toBe(
            false
        );
    });

    it('does not attribute a cancellation cue that precedes every intent clause', () => {
        const cueBeforeIntentPrompt = 'cancel that command, then glue MIDI Intro and MIDI Verse clips';

        expect(
            hasTrailingIntentCancellation(cueBeforeIntentPrompt, 'glueClips', catalog, ['glueClips', 'setTempo'])
        ).toBe(false);
    });
});
