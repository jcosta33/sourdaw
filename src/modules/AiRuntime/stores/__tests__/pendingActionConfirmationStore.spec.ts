import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../pendingActionConfirmationStore';

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

    it('isolates approved actions and protected targets at proposal and read boundaries', () => {
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Drum Bus', busId: 'bus-drum' },
        };
        const protectedUnchanged = [{ id: 'track-parallel', name: 'Parallel Compression' }];
        const proposed = proposePendingActionConfirmation({
            id: 'confirmation-2',
            prompt: 'create a Drum Bus',
            assistantMessageId: 'message-2',
            actions: [action],
            actionLabels: ['Create Drum Bus'],
            protectedUnchanged,
            executionMode: 'atomic',
            projectRevision: 'revision-2',
        });
        if (!proposed) {
            throw new Error('Expected a pending confirmation');
        }
        const inputProtectedTarget = protectedUnchanged[0];
        const proposedProtectedTarget = proposed.protectedUnchanged[0];
        if (!inputProtectedTarget || !proposedProtectedTarget) {
            throw new Error('Expected a protected target');
        }

        action.payload.name = 'Changed input';
        inputProtectedTarget.name = 'Changed input';
        if (proposed.actions[0]?.type === 'createBus') {
            proposed.actions[0].payload.name = 'Changed read';
        }
        proposedProtectedTarget.name = 'Changed read';

        const reread = getPendingActionConfirmation(proposed.id);
        expect(reread?.actions).toEqual([{ type: 'createBus', payload: { name: 'Drum Bus', busId: 'bus-drum' } }]);
        expect(reread?.protectedUnchanged).toEqual([{ id: 'track-parallel', name: 'Parallel Compression' }]);
        expect(reread?.approvalSnapshot).toEqual({
            actions: [{ type: 'createBus', payload: { name: 'Drum Bus', busId: 'bus-drum' } }],
            actionLabels: ['Create Drum Bus'],
            protectedUnchanged: [{ id: 'track-parallel', name: 'Parallel Compression' }],
        });
    });
});
