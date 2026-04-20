import { describe, it, expect } from 'vitest';

import { clipHandlers } from '../clipHandlers';
import { handleAddClip } from '../handleAddClip';
import { handleDuplicateClip } from '../handleDuplicateClip';
import { handleMoveClip } from '../handleMoveClip';
import { handleRemoveClip } from '../handleRemoveClip';

describe('clipHandlers', () => {
    it('exports a map of clip operation handlers', () => {
        expect(clipHandlers).toHaveProperty('addClip');
        expect(clipHandlers).toHaveProperty('moveClip');
        expect(clipHandlers).toHaveProperty('duplicateClip');
        expect(clipHandlers).toHaveProperty('removeClip');

        expect(clipHandlers.addClip).toBe(handleAddClip);
        expect(clipHandlers.moveClip).toBe(handleMoveClip);
        expect(clipHandlers.duplicateClip).toBe(handleDuplicateClip);
        expect(clipHandlers.removeClip).toBe(handleRemoveClip);
    });

    it('contains all expected clip handlers', () => {
        const expectedKeys = [
            'addClip',
            'moveClip',
            'duplicateClip',
            'duplicateClipToNextBar',
            'removeClip',
            'renameClip',
            'splitClip',
            'trimClipStart',
            'trimClipEnd',
            'setClipFade',
            'copyClip',
            'cutClip',
            'pasteClip',
            'normalizeClip',
            'reverseClip',
            'glueClips',
            'nudgeClip',
            'crossfadeClips',
            'setClipGain',
            'setClipColor',
            'lockClip',
            'setClipLoop',
            'setClipLoopLength',
            'consolidateSelection',
            'bounceSelection',
            'muteClip',
            'audioToMidi',
            'deleteTime',
            'insertTime',
            'duplicateTimeRange',
            'stripSilence',
            'detectTempo',
            'detectKey',
            'arpeggiate',
        ];

        const actualKeys = Object.keys(clipHandlers);
        expect(actualKeys).toEqual(expect.arrayContaining(expectedKeys));
        expect(actualKeys.length).toBe(expectedKeys.length);
    });
});
