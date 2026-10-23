import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../../stores/pendingActionConfirmationStore';
import { retireSupersededConfirmation } from '../retireSupersededConfirmation';

describe('retireSupersededConfirmation', () => {
    beforeEach(() => {
        clearPendingActionConfirmations();
    });

    it('invalidates the replaced card under its replacement and discards its prepared resources', async () => {
        const release = vi.fn();
        const retain = vi.fn();
        const replaced = proposePendingActionConfirmation({
            id: 'confirmation-replaced',
            prompt: 'import the stems',
            assistantMessageId: 'message-replaced',
            actions: [{ type: 'createBus', payload: { name: 'Stems', busId: 'bus-stems' } }],
            actionLabels: ['Create bus'],
            projectRevision: 'revision-replaced',
            resourceLease: { bytes: 1, release, retain },
        });
        if (replaced === null) {
            throw new Error('Expected the card to be proposed.');
        }

        await retireSupersededConfirmation(replaced, 'confirmation-replacement', {
            reason: 'Replaced by a refined proposal.',
            content: 'This proposal was replaced.',
        });

        expect(getPendingActionConfirmation('confirmation-replaced')).toMatchObject({
            status: 'invalidated',
            supersededBy: 'confirmation-replacement',
            error: 'Replaced by a refined proposal.',
        });
        expect(release).toHaveBeenCalledTimes(1);
        expect(retain).not.toHaveBeenCalled();
    });
});
