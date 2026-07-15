import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { runProjectLoadTransaction } from '../runProjectLoadTransaction';

vi.mock('#/modules/AudioEngine/useCases', () => ({ cancelPendingAudioBufferImport: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn() }));

describe('runProjectLoadTransaction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it('should revoke replay authority and leave collaboration before activation', async () => {
        const transaction = runProjectLoadTransaction();

        expect(transaction.activate()).toBe(false);
        await expect(transaction.prepare()).resolves.toBe(true);
        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(transaction.activate()).toBe(true);
        expect(transaction.isCurrent()).toBe(true);
    });

    it('should make an older prepared transition stale when a newer transition prepares', async () => {
        const first = runProjectLoadTransaction();
        const second = runProjectLoadTransaction();

        await expect(first.prepare()).resolves.toBe(true);
        await expect(second.prepare()).resolves.toBe(true);

        expect(first.activate()).toBe(false);
        expect(second.activate()).toBe(true);
        expect(first.isCurrent()).toBe(false);
    });

    it('should reject activation when collaboration shutdown fails', async () => {
        const failure = new Error('peer shutdown failed');
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.reject(failure),
        });
        const transaction = runProjectLoadTransaction();

        await expect(transaction.prepare()).rejects.toBe(failure);
        expect(transaction.activate()).toBe(false);
    });
});
