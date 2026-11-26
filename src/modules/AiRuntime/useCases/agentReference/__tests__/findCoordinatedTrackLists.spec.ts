import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { findCoordinatedTrackLists } from '../findCoordinatedTrackLists';
import { getPromptClauses } from '../groundingStrategies/getPromptClauses';
import { maskProjectReferences } from '../groundingStrategies/maskProjectReferences';
import { splitAttachedSourceClauses } from '../groundingStrategies/splitAttachedSourceClauses';

/**
 * A list read with its members as one keeps its text and its masked text character for character, so
 * the level reader reads each word and reference of the collapsed clause where the request wrote it.
 */

type ProjectTrack = ProjectContext['tracks'][number];

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
    sections: [{ id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 }],
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

function findCollapsedLists(prompt: string) {
    const catalog = getExecutableAppActionGroundingCatalog();
    const clauses = splitAttachedSourceClauses(
        getPromptClauses(prompt, maskProjectReferences(prompt, context)),
        catalog
    );
    return findCoordinatedTrackLists({ capability: 'track', clauses, context, prompt, risk: 'bounded-reversible' }).map(
        (list) => ({ masked: list.collapsedMasked, text: list.collapsedText })
    );
}

describe('findCoordinatedTrackLists', () => {
    it.each([
        ['Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two', 'Lift Drum Bus by 1.5 dB in Chorus Two'],
        ['Lift both Drum Bus and Bass Bus by 1.5 dB in Chorus Two', 'Lift Drum Bus by 1.5 dB in Chorus Two'],
        ['please lower both the Drum Bus and the Bass Bus by 3 dB', 'please lower the Drum Bus by 3 dB'],
    ])('collapses "%s" to its lead, its first member and its tail', (prompt, collapsedText) => {
        const [list] = findCollapsedLists(prompt);

        expect(list?.text).toBe(collapsedText);
        expect(list?.masked).toBe(maskProjectReferences(collapsedText, context));
    });

    it.each([
        'Lift both Drum Bus  and Bass Bus by 1.5 dB in Chorus Two',
        'lower both the Drum Bus , and the Bass Bus by 3 dB',
    ])('keeps the collapsed text of "%s" aligned with its masked text', (prompt) => {
        const [list] = findCollapsedLists(prompt);

        expect(list).toBeDefined();
        expect(list?.masked).toBe(maskProjectReferences(list?.text ?? '', context));
    });
});
