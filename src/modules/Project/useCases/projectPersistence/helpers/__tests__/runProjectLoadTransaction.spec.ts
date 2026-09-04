import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { captureProjectTransitionAuthority } from '../../captureProjectTransitionAuthority';
import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { resetProjectIdentityTransitionDependencies } from '../../resetProjectIdentityTransitionDependencies';
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

        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(false);
        expect(first.activate()).toBe(false);
        expect(second.activate()).toBe(true);
        expect(first.isCurrent()).toBe(false);
    });

    it('invalidates captured authority when a second transition prepares', async () => {
        const first = runProjectLoadTransaction();
        await first.prepare();
        expect(first.activate()).toBe(true);
        const authority = captureProjectTransitionAuthority();

        expect(authority.isCurrent()).toBe(true);

        const second = runProjectLoadTransaction();
        await second.prepare();

        expect(authority.isCurrent()).toBe(false);
        expect(first.signal.aborted).toBe(true);
    });

    it('does not leave collaboration while identity-transition deps are withheld', async () => {
        resetProjectIdentityTransitionDependencies();
        const leaveCollaborationSession = vi.fn(() => Promise.resolve());

        const transaction = runProjectLoadTransaction();
        const preparing = transaction.prepare();
        let settled: boolean | 'pending' = 'pending';
        void preparing.then(
            (value) => {
                settled = value;
            },
            () => {
                settled = false;
            }
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toBe('pending');
        expect(leaveCollaborationSession).not.toHaveBeenCalled();
        expect(resetActionReplayAuthority).not.toHaveBeenCalled();

        setProjectIdentityTransitionDependencies({ leaveCollaborationSession });

        await expect(preparing).resolves.toBe(true);
        expect(leaveCollaborationSession).toHaveBeenCalledOnce();
        expect(resetActionReplayAuthority).toHaveBeenCalledOnce();
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
