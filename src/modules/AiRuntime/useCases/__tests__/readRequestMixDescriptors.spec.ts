import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { getProjectContext } from '../getProjectContext';
import { compilePerceptualConstraints } from '../perceptualConstraints/compilePerceptualConstraints';
import { readRequestMixDescriptors } from '../readRequestMixDescriptors';

import { createTrack } from './trackFixture';

registerDeviceEnginePorts();

function readDescriptors(prompt: string) {
    const context = getProjectContext();
    return readRequestMixDescriptors({
        prompt,
        catalog: getMixRecipeCatalog(),
        context,
        reading: compilePerceptualConstraints(prompt, context),
    });
}

beforeEach(() => {
    trackStore.set({
        tracks: [
            createTrack({ id: 'track-drums', name: 'Drums' }),
            createTrack({ id: 'track-vocal', name: 'Vocal' }),
            createTrack({ id: 'track-bass', name: 'Bass' }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
});

describe('reading the characters a whole-project request asks for', () => {
    it.each([
        ['make this mix warmer and more open', ['warm']],
        ['add more punch and width', ['punchy', 'wide']],
        ['make this mix not only warmer but also wider', ['warm', 'wide']],
        // The catalog's own "less muddy" term names the de-mudding character, so it stays read.
        ['make it warmer and less muddy', ['warm', 'muddy']],
        // An `and` that opens a new instruction ends the kept clause before it.
        ['keep the drums punchy and make the vocal warmer', ['warm']],
    ])('reads "%s" as %j', (prompt, expected) => {
        expect(readDescriptors(prompt)).toEqual(expected);
    });

    // A withheld, reduced or kept quality is left out: never planned as an increase, and never read
    // as another character in its place ("less warm" is not "dark").
    it.each([
        ["make this mix warmer but don't let the vocal get brighter", ['warm']],
        ['make the drums less punchy and the bass less warm', []],
        ['keep the drums punchy and the vocal warm', []],
        ['make it darker, not brighter', ['dark']],
        ['warm it up without making it any wider', ['warm']],
        ['make it not only warmer', []],
        ['make it not only warmer but also not wider', ['warm']],
        ['do not make it not only warmer but also wider', []],
        ['without making it not only warmer but also wider', []],
        ['do not make it warmer but make it wider', ['wide']],
    ])('leaves out what "%s" withholds, reduces or keeps', (prompt, expected) => {
        expect(readDescriptors(prompt)).toEqual(expected);
    });
});
