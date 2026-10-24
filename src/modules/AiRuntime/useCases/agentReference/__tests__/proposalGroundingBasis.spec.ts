import { describe, expect, it } from 'vitest';

import { proposalGroundingBasis } from '../proposalGroundingBasis';

const snare = { name: 'setTrackGain', arguments: { trackId: 'track-snare', deltaDb: -3 } };
const snareRefined = { name: 'setTrackGain', arguments: { trackId: 'track-snare', deltaDb: -2 } };
const fader = { trackId: 'track-vocals', operations: ['setTrackGain'] };
const pan = { trackId: 'track-vocals', operations: ['setTrackPan'] };

function createCard(protectedControls: Array<{ trackId: string; operations: string[] }>) {
    return proposalGroundingBasis.create({
        prompt: 'turn Snare down 3 dB',
        calls: [snare],
        protectedUnchanged: [],
        protectedControls,
    });
}

describe('proposalGroundingBasis protected controls', () => {
    it('records the operations a card keeps as they resolved', () => {
        expect(createCard([fader]).protectedControls).toEqual([fader]);
    });

    it('keeps both when two grounded requests protect different controls of one track', () => {
        const refined = proposalGroundingBasis.extend({
            previous: createCard([fader]),
            prompt: 'make Snare 2 dB and keep the Vocals pan as is',
            calls: [snareRefined],
            inheritedCommandIndexes: [0],
            protectedUnchanged: [],
            protectedControls: [pan],
        });

        expect(refined.protectedControls).toEqual([
            { trackId: 'track-vocals', operations: ['setTrackGain', 'setTrackPan'] },
        ]);
    });

    it('keeps the control protection a refinement adds on its own', () => {
        const refined = proposalGroundingBasis.extend({
            previous: createCard([]),
            prompt: 'make Snare 2 dB and keep the Vocals pan as is',
            calls: [snareRefined],
            inheritedCommandIndexes: [0],
            protectedUnchanged: [],
            protectedControls: [pan],
        });

        expect(refined.protectedControls).toEqual([pan]);
    });

    it('leaves a basis that predates the record without one', () => {
        const legacy = createCard([]);
        delete legacy.protectedControls;
        const refined = proposalGroundingBasis.extend({
            previous: legacy,
            prompt: 'make Snare 2 dB',
            calls: [snareRefined],
            inheritedCommandIndexes: [0],
            protectedUnchanged: [],
            protectedControls: [pan],
        });

        expect(refined.protectedControls).toBeUndefined();
    });
});
