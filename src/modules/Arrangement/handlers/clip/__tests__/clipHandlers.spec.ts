import { describe, it, expect } from 'vitest';

import { clipHandlers } from '../clipHandlers';
import { handleAddClip } from '../handleAddClip';
import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';
import { handleDuplicateClip } from '../handleDuplicateClip';
import { handleMoveClip } from '../handleMoveClip';
import { handleRemoveClip } from '../handleRemoveClip';
import { handleRestoreClipPlacement } from '../handleRestoreClipPlacement';

describe('clipHandlers', () => {
    it('exports a map of clip operation handlers', () => {
        expect(clipHandlers).toHaveProperty('addClip');
        expect(clipHandlers).toHaveProperty('moveClip');
        expect(clipHandlers).toHaveProperty('restoreClipPlacement');
        expect(clipHandlers).toHaveProperty('discardDuplicatedClip');
        expect(clipHandlers).toHaveProperty('duplicateClip');
        expect(clipHandlers).toHaveProperty('removeClip');

        expect(clipHandlers.addClip).toBe(handleAddClip);
        expect(clipHandlers.moveClip).toBe(handleMoveClip);
        expect(clipHandlers.restoreClipPlacement).toBe(handleRestoreClipPlacement);
        expect(clipHandlers.discardDuplicatedClip).toBe(handleDiscardDuplicatedClip);
        expect(clipHandlers.duplicateClip).toBe(handleDuplicateClip);
        expect(clipHandlers.removeClip).toBe(handleRemoveClip);
    });

    it('contains all expected clip handlers', () => {
        const expectedKeys = [
            'addClip',
            'moveClip',
            'restoreClipPlacement',
            'discardDuplicatedClip',
            'duplicateClip',
            'duplicateClipToNextBar',
            'removeClip',
            'renameClip',
            'splitClip',
            'restoreClipSplitState',
            'trimClipStart',
            'trimClipEnd',
            'setClipFade',
            'copyClip',
            'cutClip',
            'pasteClip',
            'normalizeClip',
            'reverseClip',
            'restoreReversedClip',
            'glueClips',
            'restoreClipGlueState',
            'nudgeClip',
            'crossfadeClips',
            'restoreCrossfadeClips',
            'setClipGain',
            'setClipColor',
            'lockClip',
            'setClipLoop',
            'restoreClipLoop',
            'setClipLoopLength',
            'restoreClipLoopLength',
            'consolidateSelection',
            'bounceSelection',
            'muteClip',
            'deleteTime',
            'insertTime',
            'duplicateTimeRange',
            'exportMidi',
            'stripSilence',
            'arpeggiate',
        ];

        const actualKeys = Object.keys(clipHandlers);
        expect(actualKeys).toEqual(expect.arrayContaining(expectedKeys));
        expect(actualKeys.length).toBe(expectedKeys.length);
    });
});
