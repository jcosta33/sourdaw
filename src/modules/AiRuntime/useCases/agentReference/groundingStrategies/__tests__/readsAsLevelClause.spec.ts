import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { maskProjectReferences } from '../maskProjectReferences';
import { readsAsLevelClause } from '../readsAsLevelClause';

/**
 * The level clause reader on its own: one clause, masked as the bridge masks it, read for one action.
 * Each row turns on one rule of the reader, so the rule it names is the only reading that decides it.
 */

type ProjectTrack = ProjectContext['tracks'][number];

function createTrack(id: string, name: string, clips: ProjectTrack['clips'] = []): ProjectTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
        sends: [],
    };
}

const riffTake: NonNullable<ProjectTrack['clips']>[number] = {
    id: 'clip-riff-take',
    name: 'Riff Take',
    type: 'audio',
    startBeat: 0,
    endBeat: 8,
    gain: 1,
    noteCount: 0,
};

const context: ProjectContext = {
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
        { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 },
        { id: 'section-verse-2', name: 'Verse 2', startBeat: 16, endBeat: 32 },
    ],
    tracks: [
        createTrack('track-drums', 'Drums'),
        createTrack('track-bass', 'Bass', [riffTake]),
        createTrack('track-keys', 'Keys'),
        createTrack('track-vocals', 'Vocals'),
        createTrack('track-mix', 'Mix'),
        createTrack('track-reverb', 'Reverb'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

/** The same project with no track called Mix, so "in the mix" names no reference. */
const contextWithoutMixTrack: ProjectContext = {
    ...context,
    tracks: context.tracks.filter((track) => track.name !== 'Mix'),
};

function reads(prompt: string, actionType = 'setTrackGain', project = context): boolean {
    const entry = getExecutableAppActionGroundingCatalog().find((candidate) => candidate.actionType === actionType);
    if (entry === undefined) {
        throw new Error(`no catalog entry for ${actionType}`);
    }
    return readsAsLevelClause({
        clause: { masked: maskProjectReferences(prompt, project), text: prompt },
        closesOnRange: actionType === 'automateParameterRange',
        context: project,
        entry,
    });
}

describe('readsAsLevelClause', () => {
    it.each([
        [
            'a figure the level starts from, before the one it lands on',
            'set Drums from -12 dB to -6 dB',
            'setTrackGain',
        ],
        ['a scope word that lowers', 'attenuate Drums by 3 dB', 'setTrackGain'],
        ['a scope word that raises', 'boost Drums by 3 dB', 'setTrackGain'],
        [
            'a range phrase whose name holds a number before the figure',
            'lift Drums in Verse 2 by 1.5 dB',
            'automateParameterRange',
        ],
        [
            'a subject opener whose determiner a subject and its predicate follow',
            'turn Drums up 2 dB so the vocal sits better',
            'setTrackGain',
        ],
        [
            'a subject opener whose determiner a subject and one verb follow',
            'turn Drums up 2 dB so the vocal sits',
            'setTrackGain',
        ],
        ['a subject opener whose subject is a pronoun', 'turn Drums up 2 dB so it sits better', 'setTrackGain'],
        [
            'a two-word subject opener whose determiner a clause follows',
            'turn Drums up 2 dB so that the kick cuts through',
            'setTrackGain',
        ],
        [
            'a subject opener whose determiner a track and its predicate follow',
            'turn Drums down 3 dB so the Vocals sit better',
            'setTrackGain',
        ],
        ['a comparison against a track', 'turn Drums down 3 dB like Keys', 'setTrackGain'],
        ['a comparison against a clip', 'turn Drums down 3 dB like Riff Take', 'setTrackGain'],
        [
            'a comparison against the current level',
            'turn Drums down 3 dB relative to the current level',
            'setTrackGain',
        ],
        ['a comparison against the level before', 'make Drums 3 dB quieter than before', 'setTrackGain'],
        ['a closing phrase between the target and the figure', 'Lower Drums overall by 3 dB', 'setTrackGain'],
        ['a closing phrase and courtesy after it', 'Lower Drums by 3 dB overall thanks', 'setTrackGain'],
        ['a closing phrase naming who asks and courtesy after it', 'Lower Drums by 3 dB for me please', 'setTrackGain'],
    ])('reads %s: "%s"', (_rule, prompt, actionType) => {
        expect(reads(prompt, actionType)).toBe(true);
    });

    it.each([
        ['a comparison a closing phrase follows', 'turn Drums down 3 dB like Keys in the mix'],
        ['a closing phrase before the figure', 'Lower Drums in the mix by 3 dB'],
        ['a closing phrase after a direction before the figure', 'Turn Drums up in the mix by 2 dB'],
        ['a closing phrase courtesy follows', 'Lower Drums by 3 dB in the mix please'],
        ['courtesy a closing phrase follows', 'Lower Drums by 3 dB please, in the mix'],
    ])('reads %s where no track is called Mix: "%s"', (_rule, prompt) => {
        expect(reads(prompt, 'setTrackGain', contextWithoutMixTrack)).toBe(true);
    });

    it.each([
        ['a figure the level starts from after the one it lands on', 'set Drums to -6 dB like Keys from -12 dB'],
        ['a number in no decibel unit after from', 'set Drums from 3 to -6 dB'],
        ['a target whose whole text names a clip', 'turn Riff Take down 3 dB'],
        ['two runs of words a reading would have to resolve', 'raise the vocal on the snare by 2 dB'],
        ['a closing word that is the whole name of a track', 'lower Drums by 3 dB in the Mix'],
        ['the word clip written beside a reference', 'turn the Drums clip down 3 dB'],
        ['a track a verb opener names as where the level goes', 'turn Drums up 2 dB to Vocals level'],
        ['a track a subject opener names with nothing after it', 'turn Drums up 2 dB so Vocals'],
        ['a noun phrase alone after a subject opener', 'turn Drums up 2 dB so the low band'],
        ['a destination after an amount qualifier', 'turn Drums up 2 dB or so on Reverb'],
        ['a track a verb opener names', 'turn Drums up 2 dB to Reverb'],
        ['a determiner after a verb opener', 'turn Drums up 2 dB to the low band'],
        ['a determiner a whole clause follows after a verb opener', 'turn Drums up 2 dB to the level of Vocals'],
        ['a kind of object after a subject opener', 'turn Drums up 2 dB so the send'],
        ['a track alone after a subject opener and its determiner', 'turn Drums down 3 dB so the Vocals'],
        ['the master after a subject opener', 'turn Drums down 3 dB so the master'],
        ['a plural kind of object after a subject opener', 'turn Drums up 2 dB so the buses sit'],
        ['a singular kind of object after a subject opener', 'turn Drums up 2 dB so the bus sits'],
        ['a control after the compared object', 'turn Drums down 3 dB like Keys on the send'],
        ['a pan after the compared object', 'turn Drums down 3 dB like Keys panned hard left'],
        ['a figure after the compared object', 'turn Drums down 3 dB relative to Keys at -12 dB'],
        ['a stretch of the song between the target and the figure', 'Lower Drums in the chorus by 3 dB'],
        ['a control between the target and the figure', 'Lower Drums on the send by 3 dB'],
    ])('refuses %s: "%s"', (_rule, prompt) => {
        expect(reads(prompt)).toBe(false);
    });

    it('refuses the words a head opening on its range holds, which are no level words', () => {
        expect(reads('In Chorus Two lift Drums by 1.5 dB', 'automateParameterRange')).toBe(false);
    });
});
