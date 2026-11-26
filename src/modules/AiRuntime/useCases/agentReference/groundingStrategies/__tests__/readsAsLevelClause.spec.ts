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
    markers: [{ id: 'marker-big-moment', name: 'Big Moment', beat: 48 }],
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

/** The same project with no section or marker, so only the section kinds name a stretch of the song. */
const contextWithoutPlaces: ProjectContext = { ...context, sections: [], markers: [] };

const finale = { id: 'section-finale', name: 'Finale', startBeat: 72, endBeat: 88 };
const buildUp = { id: 'section-build-up', name: 'Build Up', startBeat: 32, endBeat: 48 };

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
        ['a lead verb and its direction around the target', 'bump Drums up 2 dB', 'setTrackGain'],
        ['a lead verb whose target has an article', 'take the Drums down 3 dB', 'setTrackGain'],
        ['a lead verb that pulls the level down', 'pull Drums down 3 dB', 'setTrackGain'],
        ['a lead verb that nudges the level', 'nudge Drums down 3 dB', 'setTrackGain'],
        ['a manner word between the direction and the figure', 'turn Drums down gently by 3 dB', 'setTrackGain'],
        ['an opener stating who asks', "I'd like you to lower Drums by 3 dB", 'setTrackGain'],
        ['a greeting before the request', 'hey, lower Drums by 3 dB', 'setTrackGain'],
        ['courtesy of several words after the figure', 'lower Drums by 3 dB thanks a lot', 'setTrackGain'],
        ['when the change is wanted after the figure', 'lower Drums by 3 dB right now', 'setTrackGain'],
        [
            'a kind noun after a track a subject opener names',
            'turn Drums down 3 dB so the Vocals track sits better',
            'setTrackGain',
        ],
        ['a kind noun after the compared track', 'turn Drums down 3 dB like the Keys track', 'setTrackGain'],
        ['targets only list punctuation separates', 'turn down Bass & Drums by 3 dB', 'setTrackGain'],
        ['a determiner right before the target', 'turn my Drums down 3 dB', 'setTrackGain'],
        ['a level noun and its preposition of before the target', 'lower the volume of Drums by 3 dB', 'setTrackGain'],
        ['a level noun and its preposition on before the target', 'raise the gain on Drums by 2 dB', 'setTrackGain'],
        [
            'a level noun and its preposition for before the target',
            'turn the volume for Drums down 3 dB',
            'setTrackGain',
        ],
        ['a kind noun right before the target', 'lower the track Drums by 3 dB', 'setTrackGain'],
        ['a kind noun with no article before the target', 'set channel Drums to -6 dB', 'setTrackGain'],
        [
            'a level noun and its preposition where no reference is masked',
            'raise the volume of the vocal by 2 dB',
            'setTrackGain',
        ],
        ['a trailing range the action declares', 'lift Drums by 1.5 dB in Verse 2', 'automateParameterRange'],
    ])('reads %s: "%s"', (_rule, prompt, actionType) => {
        expect(reads(prompt, actionType)).toBe(true);
    });

    it.each([
        ['a comparison a closing phrase follows', 'turn Drums down 3 dB like Keys in the mix'],
        ['a closing phrase before the figure', 'Lower Drums in the mix by 3 dB'],
        ['a closing phrase after a direction before the figure', 'Turn Drums up in the mix by 2 dB'],
        ['a closing phrase courtesy follows', 'Lower Drums by 3 dB in the mix please'],
        ['courtesy a closing phrase follows', 'Lower Drums by 3 dB please, in the mix'],
        ['a closing phrase where no reference is masked', 'raise the vocal in the mix by 2 dB'],
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
        ['a second track between the target and the figure', 'lower Drums on Reverb by 3 dB'],
        ['a device control between the target and the figure', 'put Drums threshold at -6 dB'],
        ['a measured metric after the figure', 'set Drums to -6 dB peak'],
        ['a clause of its own after the figure', 'lower Drums by 3 dB was too much'],
        ['a comparison against an object no reference names', 'lower Drums by 3 dB like the snare'],
        ['a word of a marker name between the target and the figure', 'lower Drums at the big moment by 3 dB'],
        ['musical time after the figure', 'lower Drums by 3 dB for 2 bars'],
        ['a word right before the target that may start a name no track holds', 'lower Acoustic Drums by 3 dB'],
        ['a word of a marker name before the target', 'at the big moment lower Drums by 3 dB'],
        ['a trim between the target and the figure', 'put Drums trim at -6 dB'],
        ['automation between the target and the figure', 'lower Drums automation by 3 dB'],
        ['a ceiling between the target and the figure', 'put Drums ceiling at -1 dB'],
        ['a band between the target and the figure', 'lower Drums highs by 3 dB'],
        ['a pan between the target and the figure', 'lower Drums pan by 3 dB'],
        ['a mixer control before the target', 'pan down Drums by 3 dB'],
        ['a place in time after the figure', 'turn Drums up 2 dB at the end'],
        ['a length in words after the figure', 'turn Drums up 2 dB for one measure'],
        ['an output after the figure', 'turn Drums up 2 dB in the headphones'],
        ['a destination noun after a verb opener', 'turn Drums up 2 dB to aux'],
        ['a kind noun after a verb opener', 'turn Drums up 2 dB to bus'],
        ['the start of the song after the figure', 'Lower Drums by 3 dB at the start'],
        ['a band after the figure', 'Lower Drums by 3 dB in the highs'],
        ['a figure the level starts from after the one it lands on', 'set Drums to -6 dB from -12 dB'],
        ['a second track a subject opener names after the subject', 'turn Drums up 2 dB so Vocals sit above Reverb'],
        ['a subject opener with nothing after it', 'turn Drums up 2 dB so'],
        ['a kind of object where no reference is masked', 'lower the vocal send by 3 dB'],
    ])('refuses %s: "%s"', (_rule, prompt) => {
        expect(reads(prompt)).toBe(false);
    });

    it.each([
        'threshold',
        'ratio',
        'attack',
        'release',
        'knee',
        'makeup',
        'reduction',
        'shelf',
        'filter',
        'cutoff',
        'resonance',
        'frequency',
        'eq',
        'compress',
        'compressor',
        'compression',
        'limit',
        'limiter',
        'normalize',
        'normalise',
        'drive',
        'saturation',
        'decay',
        'feedback',
        'width',
        'wet',
        'dry',
    ])('refuses the device control "%s" before the target', (word) => {
        expect(reads(`${word} lower Drums by 3 dB`)).toBe(false);
    });

    it.each([
        'intro',
        'verse',
        'prechorus',
        'chorus',
        'refrain',
        'hook',
        'bridge',
        'breakdown',
        'buildup',
        'drop',
        'interlude',
        'outro',
        'section',
    ])('refuses the section kind "%s" before the target', (word) => {
        expect(reads(`in the ${word} lower Drums by 3 dB`, 'setTrackGain', contextWithoutPlaces)).toBe(false);
    });

    it.each([
        ['just', 'turn Drums up just 2 dB'],
        ['exactly', 'lower Drums by 3 dB exactly'],
        ['about', 'turn Drums up about 2 dB'],
        ['approximately', 'lower Drums by 3 dB approximately'],
        ['around', 'turn Drums up around 2 dB'],
        ['roughly', 'turn Drums up 2 dB roughly'],
        ['slightly', 'turn Drums up 2 dB slightly'],
        ['a bit', 'turn Drums up a bit by 2 dB'],
        ['a little', 'turn Drums up a little by 2 dB'],
        ['a touch', 'turn Drums up a touch by 2 dB'],
        ['a lot', 'turn Drums up a lot by 2 dB'],
        ['full', 'lower Drums by a full 3 dB'],
        ['or so', 'turn Drums up 2 dB or so'],
        ['another', 'turn Drums up another 2 dB'],
        ['further', 'lower Drums by a further 3 dB'],
        ['additional', 'lower Drums by an additional 3 dB'],
        ['extra', 'turn Drums up an extra 2 dB'],
        ['again', 'turn Drums up 2 dB again'],
        ['too', 'turn Drums up 2 dB too'],
        ['as well', 'turn Drums up 2 dB as well'],
        ['together', 'turn down Bass & Drums together by 3 dB'],
        ['instead', 'raise Drums by 2 dB instead'],
    ])('reads the amount qualifier "%s": "%s"', (_word, prompt) => {
        expect(reads(prompt)).toBe(true);
    });

    it.each([
        ['in the mix', 'lower Drums by 3 dB in the mix'],
        ['overall', 'lower Drums by 3 dB overall'],
        ['for me', 'lower Drums by 3 dB for me'],
        ['right now', 'lower Drums by 3 dB right now'],
        ['now', 'lower Drums by 3 dB now'],
    ])('reads the closing phrase "%s": "%s"', (_phrase, prompt) => {
        expect(reads(prompt, 'setTrackGain', contextWithoutMixTrack)).toBe(true);
    });

    it.each([
        ['make', 'make Drums 3 dB quieter'],
        ['of', 'lower the volume of Drums by 3 dB'],
        ['on', 'raise the gain on Drums by 2 dB'],
        ['for', 'turn the volume for Drums down 3 dB'],
    ])('reads the level carrier or level noun preposition "%s": "%s"', (_word, prompt) => {
        expect(reads(prompt)).toBe(true);
    });

    it.each([
        ['like', 'turn Drums down 3 dB like Keys'],
        ['relative to', 'turn Drums down 3 dB relative to Keys'],
        ['compared to', 'turn Drums down 3 dB compared to Keys'],
        ['compared with', 'turn Drums down 3 dB compared with Keys'],
    ])('reads the comparison against another track "%s": "%s"', (_phrase, prompt) => {
        expect(reads(prompt)).toBe(true);
    });

    it.each([
        ['relative to the current level', 'turn Drums down 3 dB relative to the current level'],
        ['than before', 'make Drums 3 dB quieter than before'],
        ['than it is', 'make Drums 3 dB louder than it is'],
    ])('reads the comparison against the level as it stands "%s": "%s"', (_phrase, prompt) => {
        expect(reads(prompt)).toBe(true);
    });

    it.each([
        ['because', 'turn Drums down 3 dB because Keys is too loud'],
        ['since', 'turn Drums down 3 dB since Keys is too loud'],
        ['so', 'turn Drums up 2 dB so it sits better'],
        ['so that', 'turn Drums up 2 dB so that it cuts through the master'],
        ['to', 'turn Drums up 2 dB to make room for Keys'],
    ])('reads the reason opener "%s": "%s"', (_word, prompt) => {
        expect(reads(prompt)).toBe(true);
    });

    it.each([
        ['band', 'turn Drums up 2 dB so the low band'],
        ['master', 'turn Drums up 2 dB so the master'],
        ['aux', 'turn Drums up 2 dB so the aux'],
        ['output', 'turn Drums up 2 dB so the output'],
        ['monitor', 'turn Drums up 2 dB so the monitors'],
        ['headphone', 'turn Drums up 2 dB so the headphones'],
    ])('refuses the destination "%s" after a subject opener: "%s"', (_noun, prompt) => {
        expect(reads(prompt)).toBe(false);
    });

    it.each([
        ['a bus kind noun before an audio track', 'lower the bus Drums by 3 dB'],
        ['a VCA kind noun before a track no VCA group shares a name with', 'lower the vca Drums by 3 dB'],
    ])('refuses %s: "%s"', (_rule, prompt) => {
        expect(reads(prompt)).toBe(false);
    });

    it('reads a kind noun before the object of that kind the target names', () => {
        const busReverb = {
            ...context,
            tracks: context.tracks.map((track) => (track.name === 'Reverb' ? { ...track, kind: 'bus' } : track)),
        };
        const drumsVca = {
            ...context,
            vcaGroups: [{ id: 'vca-drums', name: 'Drums', gain: 1, muted: false, trackIds: ['track-drums'] }],
        };

        expect(reads('lower the bus Reverb by 3 dB', 'setTrackGain', busReverb)).toBe(true);
        expect(reads('lower the vca Drums by 3 dB', 'setTrackGain', drumsVca)).toBe(true);
    });

    it('refuses a verb opener whose first word a track name holds', () => {
        const project = { ...context, tracks: [...context.tracks, createTrack('track-plate-room', 'Plate Room')] };

        expect(reads('turn Drums up 2 dB to plate', 'setTrackGain', project)).toBe(false);
    });

    it('refuses a word of a section name before the target', () => {
        const project = { ...contextWithoutPlaces, sections: [finale] };

        expect(reads('at the finale lower Drums by 3 dB', 'setTrackGain', project)).toBe(false);
        expect(reads('lower Drums at the finale by 3 dB', 'setTrackGain', project)).toBe(false);
    });

    it("reads a level word a section name holds as the level's own", () => {
        const project = { ...contextWithoutPlaces, sections: [buildUp] };

        expect(reads('turn Drums up 2 dB', 'setTrackGain', project)).toBe(true);
    });

    it('refuses the words a head opening on its range holds, which are no level words', () => {
        expect(reads('In Chorus Two lift Drums by 1.5 dB', 'automateParameterRange')).toBe(false);
    });
});
