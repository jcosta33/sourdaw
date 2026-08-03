import { beforeEach, describe, expect, it } from 'vitest';

import { clearPendingActionConfirmations, proposePendingActionConfirmation } from '../pendingActionConfirmationStore';

describe('pendingActionConfirmationStore', () => {
    beforeEach(() => {
        clearPendingActionConfirmations();
    });

    it('preserves one materialized bus identity across a pending compound confirmation', () => {
        const busId = 'bus-ai-12345678-1234-4123-8123-123456789abc';
        const actions = [
            { type: 'createBus' as const, payload: { name: 'Vocal Plate', busId } },
            { type: 'addDevice' as const, payload: { trackId: busId, deviceType: 'builtin-reverb' } },
            {
                type: 'addSend' as const,
                payload: { trackId: 'track-vocals', busId, level: 0.25, expectedAbsent: true as const },
            },
        ];

        const confirmation = proposePendingActionConfirmation({
            id: 'confirmation-1',
            prompt: 'create a Vocal Plate bus and route Vocals to it',
            assistantMessageId: 'message-1',
            actions,
            actionLabels: ['Create bus', 'Add Reverb', 'Add send'],
            executionMode: 'atomic',
            projectRevision: 'revision-1',
        });

        expect(confirmation?.kind).toBe('app_actions');
        if (confirmation?.kind !== 'app_actions') {
            throw new Error('Expected an AppAction confirmation');
        }
        expect(confirmation.actions).toEqual(actions);
        expect(confirmation.actions[0]).toEqual({
            type: 'createBus',
            payload: { name: 'Vocal Plate', busId },
        });
    });
});
