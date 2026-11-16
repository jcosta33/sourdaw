import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { legacyLoopAnchorInverseByActionType } from '../legacyLoopAnchorInverseByActionType';
import { normalizeLegacyLoopAnchorInverse } from '../normalizeLegacyLoopAnchorInverse';

const keyless = { present: true, enabled: true };

describe('normalizeLegacyLoopAnchorInverse', () => {
    it('rewrites exactly three action types', () => {
        const rewriting = Object.entries(legacyLoopAnchorInverseByActionType)
            .filter(([, normalize]) => normalize !== legacyLoopAnchorInverseByActionType.addTrack)
            .map(([type]) => type);

        expect(rewriting.toSorted()).toEqual(['restoreClipLoop', 'slipClipContent', 'trimClipStart']);
    });

    it('anchors a keyless trimClipStart', () => {
        expect(
            normalizeLegacyLoopAnchorInverse({ type: 'trimClipStart', payload: { clipId: 'c', newStartBeat: 1 } })
        ).toEqual({ type: 'trimClipStart', payload: { clipId: 'c', newStartBeat: 1, loopOriginBeat: null } });
    });

    it('keeps a trimClipStart that carries its anchor', () => {
        const action: AppAction = {
            type: 'trimClipStart',
            payload: { clipId: 'c', newStartBeat: 1, loopOriginBeat: 2 },
        };
        expect(normalizeLegacyLoopAnchorInverse(action)).toBe(action);
    });

    it('anchors the replacement of a keyless restoreClipLoop and leaves expected alone', () => {
        expect(
            normalizeLegacyLoopAnchorInverse({
                type: 'restoreClipLoop',
                payload: { clipId: 'c', expected: keyless, replacement: keyless },
            })
        ).toEqual({
            type: 'restoreClipLoop',
            payload: { clipId: 'c', expected: keyless, replacement: { ...keyless, loopOriginBeat: null } },
        });
    });

    it('keeps a restoreClipLoop whose replacement carries its anchor', () => {
        const action: AppAction = {
            type: 'restoreClipLoop',
            payload: { clipId: 'c', expected: keyless, replacement: { ...keyless, loopOriginBeat: null } },
        };
        expect(normalizeLegacyLoopAnchorInverse(action)).toBe(action);
    });

    it('lifts no rows for a keyless midi slipClipContent', () => {
        expect(
            normalizeLegacyLoopAnchorInverse({
                type: 'slipClipContent',
                payload: { clipId: 'c', clipType: 'midi', offset: 1 },
            })
        ).toEqual({ type: 'slipClipContent', payload: { clipId: 'c', clipType: 'midi', offset: 1, rowLiftBeats: 0 } });
    });

    it('keeps an audio slipClipContent and a midi one that carries rowLiftBeats', () => {
        const audio: AppAction = { type: 'slipClipContent', payload: { clipId: 'c', clipType: 'audio', offset: 1 } };
        const keyed: AppAction = {
            type: 'slipClipContent',
            payload: { clipId: 'c', clipType: 'midi', offset: 1, rowLiftBeats: 3 },
        };
        expect(normalizeLegacyLoopAnchorInverse(audio)).toBe(audio);
        expect(normalizeLegacyLoopAnchorInverse(keyed)).toBe(keyed);
    });

    it('passes every other action through untouched', () => {
        const action: AppAction = { type: 'removeAllTracks' };
        expect(normalizeLegacyLoopAnchorInverse(action)).toBe(action);
    });
});
