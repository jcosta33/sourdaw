import { describe, expect, it } from 'vitest';

import { preservesTrimCoordinatesByActionType } from '../PreservesTrimCoordinatesByActionType';

describe('preservesTrimCoordinatesByActionType', () => {
    it('marks exactly the five clip metadata operations', () => {
        const preserving = Object.entries(preservesTrimCoordinatesByActionType)
            .filter(([, preserves]) => preserves)
            .map(([type]) => type);

        expect(preserving.toSorted()).toEqual(['muteClip', 'renameClip', 'setClipColor', 'setClipFade', 'setClipGain']);
    });

    it('answers false for an action that can move project content', () => {
        expect(preservesTrimCoordinatesByActionType.trimClipStart).toBe(false);
    });
});
