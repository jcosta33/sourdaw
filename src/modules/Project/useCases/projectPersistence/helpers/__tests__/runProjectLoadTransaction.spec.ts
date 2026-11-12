import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { projectTransitionEpoch } from '../../../../stores/projectTransitionEpoch';
import { captureProjectTransitionAuthority } from '../../captureProjectTransitionAuthority';
import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { resetProjectIdentityTransitionDependencies } from '../../resetProjectIdentityTransitionDependencies';
import { runProjectLoadTransaction } from '../runProjectLoadTransaction';

vi.mock('#/modules/AudioEngine/useCases', () => ({ cancelPendingAudioBufferImport: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn(), executeUserAppAction: vi.fn() }));

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

    it('revokes the lower read authority before a held successor can activate', async () => {
        const active = runProjectLoadTransaction();
        await expect(active.prepare()).resolves.toBe(true);
        expect(active.activate()).toBe(true);
        const epoch = projectTransitionEpoch.current;
        const authority = captureProjectTransitionAuthority();
        const entered = Promise.withResolvers<void>();
        const shutdown = Promise.withResolvers<void>();
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => {
                entered.resolve();
                return shutdown.promise;
            },
        });
        const successor = runProjectLoadTransaction();
        const preparing = successor.prepare();
        await entered.promise;
        const denied = captureProjectTransitionAuthority();
        expect(projectTransitionEpoch.current).toBe(epoch);
        expect(projectTransitionEpoch.isCurrent(epoch)).toBe(false);
        expect(authority.isCurrent()).toBe(false);
        expect(denied.isCurrent()).toBe(false);
        expect(successor.activate()).toBe(false);
        shutdown.resolve();
        await expect(preparing).resolves.toBe(true);
        expect(captureProjectTransitionAuthority().isCurrent()).toBe(false);
        expect(successor.activate()).toBe(true);
        expect(captureProjectTransitionAuthority().isCurrent()).toBe(true);
        expect(denied.isCurrent()).toBe(false);
        expect(projectTransitionEpoch.isCurrent(epoch)).toBe(false);
    });

    it('keeps a failed successor revocation sticky until another project activates', async () => {
        const active = runProjectLoadTransaction();
        await expect(active.prepare()).resolves.toBe(true);
        expect(active.activate()).toBe(true);
        const epoch = projectTransitionEpoch.current;
        const authority = captureProjectTransitionAuthority();
        const failure = new Error('successor preparation failed');
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: async () => {
                throw failure;
            },
        });
        const failed = runProjectLoadTransaction();
        await expect(failed.prepare()).rejects.toBe(failure);
        expect(failed.activate()).toBe(false);
        expect(projectTransitionEpoch.current).toBe(epoch);
        expect(projectTransitionEpoch.isCurrent(epoch)).toBe(false);
        expect(authority.isCurrent()).toBe(false);
        expect(projectTransitionEpoch.isCurrent(0)).toBe(false);
        const fresh = captureProjectTransitionAuthority();
        expect(fresh.isCurrent()).toBe(true);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        const returned = runProjectLoadTransaction();
        await expect(returned.prepare()).resolves.toBe(true);
        expect(fresh.isCurrent()).toBe(false);
        expect(returned.activate()).toBe(true);
        expect(projectTransitionEpoch.isCurrent(projectTransitionEpoch.current)).toBe(true);
        expect(projectTransitionEpoch.isCurrent(epoch)).toBe(false);
        expect(authority.isCurrent()).toBe(false);
    });

    it('never revives an edit captured during a held successor after that successor fails', async () => {
        const active = runProjectLoadTransaction();
        await expect(active.prepare()).resolves.toBe(true);
        expect(active.activate()).toBe(true);
        const before = captureProjectTransitionAuthority();
        const entered = Promise.withResolvers<void>();
        const shutdown = Promise.withResolvers<void>();
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => {
                entered.resolve();
                return shutdown.promise;
            },
        });
        const successor = runProjectLoadTransaction();
        const preparing = successor.prepare();
        await entered.promise;
        expect(successor.activate()).toBe(false);
        const during = captureProjectTransitionAuthority();
        expect(before.isCurrent()).toBe(false);
        expect(during.isCurrent()).toBe(false);
        const failure = new Error('successor preparation failed');
        const rejected = expect(preparing).rejects.toBe(failure);
        shutdown.reject(failure);
        await rejected;
        expect(during.isCurrent()).toBe(false);
        expect(before.isCurrent()).toBe(false);
        expect(captureProjectTransitionAuthority().isCurrent()).toBe(true);
    });

    it('settles only the newest failed preparation while an older revoked preparation remains held', async () => {
        const active = runProjectLoadTransaction();
        await expect(active.prepare()).resolves.toBe(true);
        expect(active.activate()).toBe(true);
        const oldEdit = captureProjectTransitionAuthority();
        const olderEntered = Promise.withResolvers<void>();
        const releaseOlder = Promise.withResolvers<void>();
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => {
                olderEntered.resolve();
                return releaseOlder.promise;
            },
        });
        const older = runProjectLoadTransaction();
        const olderPreparation = older.prepare();
        await olderEntered.promise;
        const denied = captureProjectTransitionAuthority();
        expect(denied.isCurrent()).toBe(false);

        const failure = new Error('newer preparation failed');
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => Promise.reject(failure) });
        const newer = runProjectLoadTransaction();
        await expect(newer.prepare()).rejects.toBe(failure);
        expect(newer.activate()).toBe(false);
        const fresh = captureProjectTransitionAuthority();
        expect(fresh.isCurrent()).toBe(true);
        expect(oldEdit.isCurrent()).toBe(false);
        expect(denied.isCurrent()).toBe(false);

        releaseOlder.resolve();
        await expect(olderPreparation).resolves.toBe(false);
        expect(older.activate()).toBe(false);
        expect(fresh.isCurrent()).toBe(true);
    });

    it.each(['resolve', 'reject'] as const)(
        'keeps a current successor closed to edits when an older revoked preparation settles by %s',
        async (olderOutcome) => {
            const active = runProjectLoadTransaction();
            await expect(active.prepare()).resolves.toBe(true);
            expect(active.activate()).toBe(true);
            const before = captureProjectTransitionAuthority();

            const olderEntered = Promise.withResolvers<void>();
            const olderShutdown = Promise.withResolvers<void>();
            setProjectIdentityTransitionDependencies({
                leaveCollaborationSession: () => {
                    olderEntered.resolve();
                    return olderShutdown.promise;
                },
            });
            const older = runProjectLoadTransaction();
            const olderPreparation = older.prepare();
            await olderEntered.promise;
            const deniedDuringOlder = captureProjectTransitionAuthority();
            expect(deniedDuringOlder.isCurrent()).toBe(false);

            const middleFailure = new Error('middle preparation failed');
            setProjectIdentityTransitionDependencies({
                leaveCollaborationSession: async () => Promise.reject(middleFailure),
            });
            const middle = runProjectLoadTransaction();
            await expect(middle.prepare()).rejects.toBe(middleFailure);
            expect(middle.activate()).toBe(false);
            const freshBetween = captureProjectTransitionAuthority();
            expect(freshBetween.isCurrent()).toBe(true);

            const currentEntered = Promise.withResolvers<void>();
            const currentShutdown = Promise.withResolvers<void>();
            setProjectIdentityTransitionDependencies({
                leaveCollaborationSession: () => {
                    currentEntered.resolve();
                    return currentShutdown.promise;
                },
            });
            const current = runProjectLoadTransaction();
            const currentPreparation = current.prepare();
            await currentEntered.promise;
            const deniedDuringCurrent = captureProjectTransitionAuthority();
            expect(deniedDuringCurrent.isCurrent()).toBe(false);
            expect(freshBetween.isCurrent()).toBe(false);

            if (olderOutcome === 'resolve') {
                olderShutdown.resolve();
                await expect(olderPreparation).resolves.toBe(false);
            } else {
                const olderFailure = new Error('older shutdown failed late');
                const rejected = expect(olderPreparation).rejects.toBe(olderFailure);
                olderShutdown.reject(olderFailure);
                await rejected;
            }
            expect(older.activate()).toBe(false);
            expect(current.signal.aborted).toBe(false);
            expect(captureProjectTransitionAuthority().isCurrent()).toBe(false);
            expect(before.isCurrent()).toBe(false);
            expect(deniedDuringOlder.isCurrent()).toBe(false);
            expect(deniedDuringCurrent.isCurrent()).toBe(false);
            expect(freshBetween.isCurrent()).toBe(false);

            const currentFailure = new Error('current shutdown failed');
            const rejected = expect(currentPreparation).rejects.toBe(currentFailure);
            currentShutdown.reject(currentFailure);
            await rejected;
            expect(current.activate()).toBe(false);
            expect(captureProjectTransitionAuthority().isCurrent()).toBe(true);
            expect(before.isCurrent()).toBe(false);
            expect(deniedDuringOlder.isCurrent()).toBe(false);
            expect(deniedDuringCurrent.isCurrent()).toBe(false);
            expect(freshBetween.isCurrent()).toBe(false);
        }
    );

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

    it('does not activate until an entered collaboration shutdown completes', async () => {
        const shutdownEntered = Promise.withResolvers<void>();
        const shutdown = Promise.withResolvers<void>();
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => {
                shutdownEntered.resolve();
                return shutdown.promise;
            },
        });
        const transaction = runProjectLoadTransaction();
        const preparing = transaction.prepare();

        await shutdownEntered.promise;
        expect(transaction.activate()).toBe(false);

        shutdown.resolve();
        await expect(preparing).resolves.toBe(true);
        expect(transaction.activate()).toBe(true);
    });

    it('preserves an entered collaboration shutdown rejection and refuses activation', async () => {
        const failure = new Error('held peer shutdown failed');
        const shutdownEntered = Promise.withResolvers<void>();
        const shutdown = Promise.withResolvers<void>();
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => {
                shutdownEntered.resolve();
                return shutdown.promise;
            },
        });
        const transaction = runProjectLoadTransaction();
        const preparing = transaction.prepare();

        await shutdownEntered.promise;
        expect(transaction.activate()).toBe(false);

        const rejected = expect(preparing).rejects.toBe(failure);
        shutdown.reject(failure);
        await rejected;
        expect(transaction.activate()).toBe(false);
    });
});
