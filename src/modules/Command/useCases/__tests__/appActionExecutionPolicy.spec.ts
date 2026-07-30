import { describe, expect, it } from 'vitest';

import { requiresAppActionConfirmation } from '../requiresAppActionConfirmation';

describe('app action execution policy', () => {
    it.each(['setTempo', 'setMasterGain', 'setTrackOutput', 'setSend', 'addSend', 'removeSend'] as const)(
        'requires confirmation for a single authority-sensitive %s action',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(true);
        }
    );

    it.each(['removeTrack', 'removeAllTracks', 'removeClip', 'removeDevice', 'bounceInPlace'] as const)(
        'requires confirmation for a single destructive %s action',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(true);
        }
    );

    it('requires confirmation for a single broad reversible action', () => {
        expect(requiresAppActionConfirmation([{ type: 'duplicateTrack' }])).toBe(true);
    });

    it('requires confirmation for a multi-action batch even when every action is bounded', () => {
        expect(requiresAppActionConfirmation([{ type: 'muteTrack' }, { type: 'setTrackGain' }])).toBe(true);
    });

    it.each(['renameTrack', 'muteTrack', 'setTrackGain'] as const)(
        'allows a single bounded %s action without confirmation',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(false);
        }
    );

    it('does not require confirmation for an empty batch', () => {
        expect(requiresAppActionConfirmation([])).toBe(false);
    });
});
