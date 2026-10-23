import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendChatMessage, chatStore, clearChatMessages } from '../../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../../stores/pendingActionConfirmationStore';
import { retireSupersededConfirmation } from '../retireSupersededConfirmation';

describe('retireSupersededConfirmation', () => {
    beforeEach(() => {
        clearPendingActionConfirmations();
        clearChatMessages();
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

    it("says in the retired card's chat message why it was replaced, as its error and its content", async () => {
        appendChatMessage({
            id: 'message-replaced',
            role: 'assistant',
            content: 'Turn Vocals down 3 dB',
            timestamp: 1,
            isCommandAction: true,
        });
        const replaced = proposePendingActionConfirmation({
            id: 'confirmation-replaced',
            prompt: 'turn Vocals down 3 dB',
            assistantMessageId: 'message-replaced',
            actions: [{ type: 'setTrackGain', payload: { trackId: 'track-vocals', deltaDb: -3, expectedGain: 0.8 } }],
            actionLabels: ['Turn Vocals down 3 dB'],
            projectRevision: 'revision-replaced',
        });
        if (replaced === null) {
            throw new Error('Expected the card to be proposed.');
        }

        await retireSupersededConfirmation(replaced, 'confirmation-replacement', {
            reason: 'Replaced by a refined proposal.',
            content: 'This proposal was replaced.',
        });

        expect(chatStore.value?.messages.find((message) => message.id === 'message-replaced')).toMatchObject({
            pendingActionConfirmationStatus: 'invalidated',
            error: 'Replaced by a refined proposal.',
            content: 'This proposal was replaced.',
        });
    });
});
