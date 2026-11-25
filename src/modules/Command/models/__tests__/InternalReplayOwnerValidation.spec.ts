import { describe, expect, it } from 'vitest';

import { internalReplayOwnerValidationByActionType } from '../InternalReplayOwnerValidation';

describe('internalReplayOwnerValidationByActionType', () => {
    it('pins the owner-only and optional action types', () => {
        const entries = Object.entries(internalReplayOwnerValidationByActionType);
        const ownerOnly = entries.filter(([, mode]) => mode === 'owner-only').map(([type]) => type);
        const optional = entries.filter(([, mode]) => mode === 'optional').map(([type]) => type);
        expect(ownerOnly.toSorted()).toEqual([
            'restoreAudioClipSlip',
            'restoreAudioClipStartTrim',
            'restoreClip',
            'restoreRecording',
            'restoreTimeOperationState',
        ]);
        expect(optional.toSorted()).toEqual([
            'deleteGrooveTemplate',
            'discardCreatedTrack',
            'discardDrawnClip',
            'discardDuplicatedClip',
            'discardRecording',
            'restoreClipMoves',
            'restoreDrawnClip',
            'restoreGrooveAssignment',
            'restoreTrackDisabled',
            'restoreTrackHeights',
        ]);
    });

    it('does not inherit a mode for an untrusted type name', () => {
        expect(Object.hasOwn(internalReplayOwnerValidationByActionType, 'constructor')).toBe(false);
    });
});
