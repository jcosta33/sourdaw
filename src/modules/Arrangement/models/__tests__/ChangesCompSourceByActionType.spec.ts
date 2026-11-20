import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { changesCompSource, changesCompSourceByActionType } from '../ChangesCompSourceByActionType';

describe('changesCompSourceByActionType', () => {
    it('marks exactly the actions that can change a comp take source', () => {
        const marked = Object.entries(changesCompSourceByActionType)
            .filter(([, value]) => value)
            .map(([type]) => type);

        expect(marked.toSorted()).toEqual([
            'addClip',
            'bounceInPlace',
            'crossfadeClips',
            'cutClip',
            'detectTempo',
            'discardDrawnClip',
            'discardDuplicatedClip',
            'drawClip',
            'duplicateClip',
            'duplicateClipAt',
            'duplicateClipToNextBar',
            'fitClipToBeats',
            'flattenTrack',
            'freezeTrack',
            'glueClips',
            'moveClip',
            'moveClips',
            'nudgeClip',
            'pasteClip',
            'relinkClipAudioSources',
            'removeClip',
            'removeTrack',
            'restoreClip',
            'restoreClipFileId',
            'restoreClipGlueState',
            'restoreClipLoop',
            'restoreClipLoopLength',
            'restoreClipMoves',
            'restoreClipPlacement',
            'restoreClipSplitState',
            'restoreClipStretchState',
            'restoreCrossfadeClips',
            'restoreDrawnClip',
            'restoreReversedClip',
            'restoreTrack',
            'restoreTrackClipStates',
            'reverseClip',
            'setClipLoop',
            'setClipLoopLength',
            'setClipStretchMode',
            'setClipStretchRatio',
            'slipClipContent',
            'splitClip',
            'trimClipEnd',
            'trimClipStart',
            'unfreezeTrack',
        ]);
    });

    it('answers false for an inherited name read from untrusted JSON', () => {
        const parsed: Pick<AppAction, 'type'> = JSON.parse('{"type":"constructor"}');

        expect(changesCompSource(parsed.type)).toBe(false);
    });
});
