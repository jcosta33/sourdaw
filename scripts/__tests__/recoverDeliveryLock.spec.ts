import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDeliverCli } from '../deliverPullRequest.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { composeDeliveryReceipt } from '../prContract.ts';
import { runRecoverDeliveryLockCli, type DeliveryLockRecoveryDependencies } from '../recoverDeliveryLock.ts';

const NUMBER = 3344;
const OWNER_OID = '9f9c875746e69d6282e4233b32dfb1d07f418724';
const REJECTED_HEAD = '8dca20782dfc174bf28ed2ad985414674e7a8180';
const CURRENT_HEAD = 'c'.repeat(40);
const REF = `refs/sourdaw/delivery/pr-${NUMBER}`;
const OWNER = '{"version":1,"pid":1297320,"token":"bcf9e594-59ce-450e-a357-97a433899ce5"}';

type IncidentTestChange = {
    ownerOid?: string;
    owner?: { version: 1; pid: number; token: string };
    expectedError?: RegExp;
    state?: ReturnType<typeof remoteState>;
    processIsDead?: () => boolean;
};

function git(root: string, args: string[], input?: string): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', input }).trim();
}

function initialize(root: string): void {
    git(root, ['init', '--quiet']);
    const oid = git(root, ['hash-object', '-w', '--stdin'], OWNER);
    expect(oid).toBe(OWNER_OID);
    git(root, ['update-ref', REF, oid]);
}

function remoteState(
    overrides: Partial<{
        state: string;
        head: string;
        receiptId: number;
        actor: string;
        edited: boolean;
        body: string;
    }> = {}
) {
    const createdAt = '2026-09-02T07:00:00Z';
    return {
        state: overrides.state ?? 'open',
        head: overrides.head ?? CURRENT_HEAD,
        receipt: {
            id: overrides.receiptId ?? 5506507863,
            body:
                overrides.body ??
                composeDeliveryReceipt({
                    pullRequest: NUMBER,
                    head: REJECTED_HEAD,
                    bodySha256: 'a'.repeat(64),
                }),
            authorNodeId: overrides.actor ?? AUTHOR_BOT_NODE_ID,
            createdAt,
            updatedAt: overrides.edited === true ? '2026-09-02T07:01:00Z' : createdAt,
        },
    };
}

function dependencies(root: string, states: ReturnType<typeof remoteState>[]): DeliveryLockRecoveryDependencies {
    let index = 0;
    return {
        trustedLauncher: { primaryRoot: root, gitPath: 'git', ghPath: 'gh' },
        authenticateAuthor: async () => ({
            minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
            session: { configDir: root, env: {}, dispose: () => undefined },
        }),
        repositoryName: () => 'jcosta33/sourdaw',
        readRemoteState: () => states[Math.min(index++, states.length - 1)]!,
        processIsDead: () => true,
    };
}

describe('deliver --recover-lock', () => {
    it('routes recovery through the existing deliver command', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();

        try {
            await expect(
                runDeliverCli(['--recover-lock', '3344', '--owner', OWNER_OID], {
                    recovery: dependencies(root, [state, state]),
                })
            ).resolves.toBe(0);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('releases only the exact retained incident lock after two stable authoritative reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();

        try {
            await expect(
                runRecoverDeliveryLockCli(['3344', '--owner', OWNER_OID], dependencies(root, [state, state]))
            ).resolves.toBe(0);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each<[string, () => IncidentTestChange]>([
        [
            'owner OID',
            () => ({
                ownerOid: 'd'.repeat(40),
                owner: { version: 1 as const, pid: 1297320, token: 'bcf9e594-59ce-450e-a357-97a433899ce5' },
                expectedError: /owner does not match this recovery incident/,
            }),
        ],
        [
            'owner payload',
            () => ({ owner: { version: 1 as const, pid: 7, token: '00000000-0000-4000-8000-000000000000' } }),
        ],
        ['receipt actor', () => ({ state: remoteState({ actor: 'wrong-author' }) })],
        ['receipt comment ID', () => ({ state: remoteState({ receiptId: 5506507864 }) })],
        [
            'receipt body head',
            () => ({
                state: remoteState({
                    body: composeDeliveryReceipt({
                        pullRequest: NUMBER,
                        head: 'b'.repeat(40),
                        bodySha256: 'a'.repeat(64),
                    }),
                }),
            }),
        ],
        [
            'receipt body pull request',
            () => ({
                state: remoteState({
                    body: composeDeliveryReceipt({
                        pullRequest: NUMBER + 1,
                        head: REJECTED_HEAD,
                        bodySha256: 'a'.repeat(64),
                    }),
                }),
            }),
        ],
        ['edited receipt', () => ({ state: remoteState({ edited: true }) })],
        ['closed PR', () => ({ state: remoteState({ state: 'closed' }) })],
        ['rejected head still current', () => ({ state: remoteState({ head: REJECTED_HEAD }) })],
        ['live owner PID', () => ({ processIsDead: () => false })],
    ])('refuses %s without deleting the retained ref', async (_label, change) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const changed = change();
        const current = remoteState();
        const ownerOid = changed.ownerOid;
        const owner = changed.owner;
        const expectedError = changed.expectedError;
        const processIsDead = changed.processIsDead;
        const base = dependencies(root, [changed.state ?? current, changed.state ?? current]);
        const configured: DeliveryLockRecoveryDependencies = {
            ...base,
            ...(ownerOid === undefined ? {} : { readLockOid: () => ownerOid }),
            ...(owner === undefined ? {} : { readLockOwner: () => owner }),
            ...(processIsDead === undefined ? {} : { processIsDead }),
        };

        try {
            await expect(runRecoverDeliveryLockCli(['3344', '--owner', OWNER_OID], configured)).rejects.toThrow(
                expectedError
            );
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each([
        ['reviewer actor', REVIEWER_BOT_NODE_ID],
        ['unexpected actor', 'BOT_other'],
    ])('refuses a minted %s without deleting the retained ref', async (_label, actorNodeId) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();
        const base = dependencies(root, [state, state]);
        const configured: DeliveryLockRecoveryDependencies = {
            ...base,
            authenticateAuthor: async () => ({
                minted: { actorNodeId },
                session: { configDir: root, env: {}, dispose: () => undefined },
            }),
        };

        try {
            await expect(runRecoverDeliveryLockCli(['3344', '--owner', OWNER_OID], configured)).rejects.toThrow(
                /minted actor .+ is not/
            );
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses remote head drift between the two required state reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        try {
            await expect(
                runRecoverDeliveryLockCli(
                    ['3344', '--owner', OWNER_OID],
                    dependencies(root, [remoteState(), remoteState({ head: 'd'.repeat(40) })])
                )
            ).rejects.toThrow(/remote state changed/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses receipt-body drift between the two required state reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        try {
            await expect(
                runRecoverDeliveryLockCli(
                    ['3344', '--owner', OWNER_OID],
                    dependencies(root, [
                        remoteState(),
                        remoteState({
                            body: composeDeliveryReceipt({
                                pullRequest: NUMBER,
                                head: REJECTED_HEAD,
                                bodySha256: 'b'.repeat(64),
                            }),
                        }),
                    ])
                )
            ).rejects.toThrow(/remote state changed/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a symbolic incident ref without deleting its target lock', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const targetRef = `refs/sourdaw/delivery/pr-${NUMBER + 1}`;
        git(root, ['update-ref', targetRef, OWNER_OID]);
        git(root, ['symbolic-ref', REF, targetRef]);
        const state = remoteState();

        try {
            await expect(
                runRecoverDeliveryLockCli(['3344', '--owner', OWNER_OID], dependencies(root, [state, state]))
            ).rejects.toThrow(/ownership changed before release/);
            expect(git(root, ['symbolic-ref', '-q', REF])).toBe(targetRef);
            expect(git(root, ['rev-parse', '--verify', targetRef])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a CAS race and leaves the new owner in place', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();
        const base = dependencies(root, [state, state]);
        const replacement = git(
            root,
            ['hash-object', '-w', '--stdin'],
            '{"version":1,"pid":7,"token":"00000000-0000-4000-8000-000000000000"}'
        );
        let reads = 0;
        const configured: DeliveryLockRecoveryDependencies = {
            ...base,
            readRemoteState: () => {
                reads += 1;
                if (reads === 2) {
                    git(root, ['update-ref', REF, replacement, OWNER_OID]);
                }
                return state;
            },
        };

        try {
            await expect(runRecoverDeliveryLockCli(['3344', '--owner', OWNER_OID], configured)).rejects.toThrow(
                /ownership changed before release/
            );
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(replacement);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
