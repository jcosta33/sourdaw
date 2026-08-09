import { describe, expect, it } from 'vitest';

import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { requiresAppActionConfirmation } from '../requiresAppActionConfirmation';

describe('app action execution policy', () => {
    it.each([
        'armTrack',
        'toggleRecording',
        'setTempo',
        'setMasterGain',
        'stopPlayback',
        'setTrackOutput',
        'setSend',
        'addSend',
        'removeSend',
        'addSidechainRoute',
        'removeSidechainRoute',
        'setPunchIn',
        'setPunchOut',
    ] as const)('requires confirmation for a single authority-sensitive %s action', (type) => {
        expect(requiresAppActionConfirmation([{ type }])).toBe(true);
    });

    it.each(['removeTrack', 'removeAllTracks', 'removeClip', 'removeDevice', 'bounceInPlace'] as const)(
        'requires confirmation for a single destructive %s action',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(true);
        }
    );

    it.each(['duplicateTrack', 'clearSolos'] as const)(
        'requires confirmation for a single broad reversible %s action',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(true);
        }
    );

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

    it('fails closed for an unclassified action type', () => {
        expect(getAppActionExecutionPolicy('futureAction')).toEqual({
            classification: 'default',
            risk: 'unclassified',
            requiresConfirmation: true,
            reason: 'This action has no explicit execution policy and must be reviewed.',
        });
    });
});
