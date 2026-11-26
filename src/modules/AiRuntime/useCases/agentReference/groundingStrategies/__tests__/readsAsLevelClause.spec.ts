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
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function reads(prompt: string, actionType = 'setTrackGain'): boolean {
    const entry = getExecutableAppActionGroundingCatalog().find((candidate) => candidate.actionType === actionType);
    if (entry === undefined) {
        throw new Error(`no catalog entry for ${actionType}`);
    }
    return readsAsLevelClause({
        clause: { masked: maskProjectReferences(prompt, context), text: prompt },
        closesOnRange: actionType === 'automateParameterRange',
        context,
        entry,
    });
}

describe('readsAsLevelClause', () => {
    it.each([
        ['a figure the level starts from, before the one it lands on', 'set Drums from -12 dB to -6 dB'],
        ['a scope word that lowers', 'attenuate Drums by 3 dB'],
        ['a scope word that raises', 'boost Drums by 3 dB'],
        ['a range phrase whose name holds a number before the figure', 'lift Drums in Verse 2 by 1.5 dB'],
    ])('reads %s: "%s"', (_rule, prompt) => {
        const actionType = prompt.startsWith('lift') ? 'automateParameterRange' : 'setTrackGain';

        expect(reads(prompt, actionType)).toBe(true);
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
    ])('refuses %s: "%s"', (_rule, prompt) => {
        expect(reads(prompt)).toBe(false);
    });

    it('reads the words a head opening on its range holds, which are no level words', () => {
        expect(reads('In Chorus Two lift Drums by 1.5 dB', 'automateParameterRange')).toBe(false);
    });
});
