import { beforeEach, describe, expect, it } from 'vitest';

import {
    claimActionReplayCapability as claimStoredActionReplayCapability,
    clearActionReplayCapabilities,
    completeActionReplayMarkReconciliation,
    consumeActionReplayClaim,
    hasActionReplayCapability,
    registerActionReplayCapability as registerStoredActionReplayCapability,
    retainActionReplayMarkReconciliation,
    restoreActionReplayCapability,
    revokeActionReplayCapability,
} from '../actionReplayCapabilities';
import { actionReplayRevisionStore } from '../actionReplayRevisionStore';

type TestInverseAction = Parameters<typeof registerStoredActionReplayCapability>[0]['inverseAction'];

function create_metadata(entry_id: string) {
    return {
        id: entry_id,
        label: `Action ${entry_id}`,
        actionKind: 'testAction',
        source: 'manual' as const,
        timestamp: 10,
    };
}

function registerActionReplayCapability(input: { entryId: string; inverseAction: TestInverseAction }): void {
    registerStoredActionReplayCapability({ ...input, metadata: create_metadata(input.entryId) });
}

function claimActionReplayCapability(entry_id: string) {
    return claimStoredActionReplayCapability({ entryId: entry_id, metadata: create_metadata(entry_id) });
}

describe('action replay capabilities', () => {
    beforeEach(() => {
        clearActionReplayCapabilities();
    });

    it('should atomically claim a typed inverse once', () => {
        const revision_before_register = actionReplayRevisionStore.getSnapshot();
        const inverseAction = { type: 'togglePlayback' } as const;
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction });

        expect(actionReplayRevisionStore.getSnapshot()).toBe((revision_before_register ?? 0) + 1);

        expect(hasActionReplayCapability('entry-1')).toBe(true);
        const revision_before_claim = actionReplayRevisionStore.getSnapshot();
        const claim = claimActionReplayCapability('entry-1');
        expect(actionReplayRevisionStore.getSnapshot()).toBe((revision_before_claim ?? 0) + 1);
        expect(claim?.inverseAction).toEqual(inverseAction);
        expect(claim?.generation).toBeTypeOf('number');
        expect(claimActionReplayCapability('entry-1')).toBeNull();
        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });

    it('should expose a read-only scalar revision and bump every authority-state transition', () => {
        expect('set' in actionReplayRevisionStore).toBe(false);
        expect('update' in actionReplayRevisionStore).toBe(false);
        let expected_revision = actionReplayRevisionStore.getSnapshot() ?? 0;
        const expect_revision_bump = (operation: () => void) => {
            operation();
            expected_revision += 1;
            expect(actionReplayRevisionStore.getSnapshot()).toBe(expected_revision);
        };

        expect_revision_bump(() =>
            registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } })
        );
        const first_claim = claimActionReplayCapability('entry-1');
        if (!first_claim) {
            throw new Error('Expected first replay claim');
        }
        expected_revision += 1;
        expect(actionReplayRevisionStore.getSnapshot()).toBe(expected_revision);
        expect_revision_bump(() => restoreActionReplayCapability({ entryId: 'entry-1', claim: first_claim }));

        const reconciliation_claim = claimActionReplayCapability('entry-1');
        if (!reconciliation_claim) {
            throw new Error('Expected reconciliation replay claim');
        }
        expected_revision += 1;
        expect(actionReplayRevisionStore.getSnapshot()).toBe(expected_revision);
        expect_revision_bump(() =>
            retainActionReplayMarkReconciliation({ entryId: 'entry-1', claim: reconciliation_claim })
        );
        expect_revision_bump(() => completeActionReplayMarkReconciliation('entry-1'));

        expect_revision_bump(() =>
            registerActionReplayCapability({ entryId: 'entry-2', inverseAction: { type: 'togglePlayback' } })
        );
        const consumed_claim = claimActionReplayCapability('entry-2');
        if (!consumed_claim) {
            throw new Error('Expected consumed replay claim');
        }
        expected_revision += 1;
        expect(actionReplayRevisionStore.getSnapshot()).toBe(expected_revision);
        expect_revision_bump(() => consumeActionReplayClaim({ entryId: 'entry-2', claim: consumed_claim }));
        expect_revision_bump(() => revokeActionReplayCapability('entry-2'));
        expect_revision_bump(clearActionReplayCapabilities);
    });

    it('should restore a claimed inverse after a failed replay', () => {
        const inverseAction = { type: 'setTempo', payload: { bpm: 120 } } as const;
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction });

        const claim = claimActionReplayCapability('entry-1');
        if (claim === null) {
            throw new Error('Expected the capability to be claimed');
        }

        restoreActionReplayCapability({ entryId: 'entry-1', claim });

        expect(claimActionReplayCapability('entry-1')?.inverseAction).toEqual(inverseAction);
    });

    it('should not restore a claim from a generation cleared while replay was pending', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });
        const claim = claimActionReplayCapability('entry-1');
        if (claim === null) {
            throw new Error('Expected the capability to be claimed');
        }

        clearActionReplayCapabilities();
        restoreActionReplayCapability({ entryId: 'entry-1', claim });

        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });

    it('should not restore a claim after its exact entry ID is revoked', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });
        const claim = claimActionReplayCapability('entry-1');
        if (claim === null) {
            throw new Error('Expected the capability to be claimed');
        }

        revokeActionReplayCapability('entry-1');
        restoreActionReplayCapability({ entryId: 'entry-1', claim });

        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });

    it('should restore only the latest claim after the same entry ID is registered again', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });
        const stale_claim = claimActionReplayCapability('entry-1');
        if (stale_claim === null) {
            throw new Error('Expected the first capability to be claimed');
        }
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'stopPlayback' } });
        const current_claim = claimActionReplayCapability('entry-1');
        if (current_claim === null) {
            throw new Error('Expected the replacement capability to be claimed');
        }

        restoreActionReplayCapability({ entryId: 'entry-1', claim: stale_claim });
        restoreActionReplayCapability({ entryId: 'entry-1', claim: current_claim });

        expect(claimActionReplayCapability('entry-1')?.inverseAction).toEqual({ type: 'stopPlayback' });
    });

    it('should not let 200 stale restores displace newer capabilities', () => {
        const stale_claims: Array<{
            entryId: string;
            claim: NonNullable<ReturnType<typeof claimActionReplayCapability>>;
        }> = [];
        for (let index = 0; index < 200; index += 1) {
            const entry_id = `stale-entry-${index}`;
            registerActionReplayCapability({ entryId: entry_id, inverseAction: { type: 'togglePlayback' } });
            const claim = claimActionReplayCapability(entry_id);
            if (claim === null) {
                throw new Error(`Expected stale capability ${entry_id} to be claimed`);
            }
            stale_claims.push({ entryId: entry_id, claim });
            revokeActionReplayCapability(entry_id);
        }
        for (let index = 0; index < 200; index += 1) {
            registerActionReplayCapability({
                entryId: `current-entry-${index}`,
                inverseAction: { type: 'stopPlayback' },
            });
        }

        for (const stale_claim of stale_claims) {
            restoreActionReplayCapability(stale_claim);
        }

        for (let index = 0; index < 200; index += 1) {
            expect(hasActionReplayCapability(`current-entry-${index}`)).toBe(true);
            expect(hasActionReplayCapability(`stale-entry-${index}`)).toBe(false);
        }
    });

    it('should not let an exact-revoke tombstone consume a newer capability slot', () => {
        for (let index = 0; index < 200; index += 1) {
            registerActionReplayCapability({
                entryId: `entry-${index}`,
                inverseAction: { type: 'togglePlayback' },
            });
        }

        revokeActionReplayCapability('entry-0');
        registerActionReplayCapability({ entryId: 'entry-200', inverseAction: { type: 'stopPlayback' } });

        expect(hasActionReplayCapability('entry-0')).toBe(false);
        expect(hasActionReplayCapability('entry-1')).toBe(true);
        expect(hasActionReplayCapability('entry-200')).toBe(true);
    });

    it('should prune the oldest capabilities at the history bound', () => {
        for (let index = 0; index < 201; index += 1) {
            registerActionReplayCapability({
                entryId: `entry-${index}`,
                inverseAction: { type: 'togglePlayback' },
            });
        }

        expect(hasActionReplayCapability('entry-0')).toBe(false);
        expect(hasActionReplayCapability('entry-1')).toBe(true);
        expect(hasActionReplayCapability('entry-200')).toBe(true);
    });

    it('should clear all capabilities without affecting another owner', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });

        clearActionReplayCapabilities();

        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });
});
