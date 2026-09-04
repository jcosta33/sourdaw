import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runDeliverCli } from '../deliverPullRequest.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { composeDeliveryReceipt } from '../prContract.ts';
import {
    runRecoverDeliveryLockCli,
    type DeliveryLockRecoveryDependencies,
    type JournaledRecoveryRemoteState,
} from '../recoverDeliveryLock.ts';

const NUMBER = 4711;
const CRASHED_PID = 424_242;
const HEAD = 'c'.repeat(40);
const REF = `refs/sourdaw/delivery/pr-${NUMBER}`;
const RECOVERING_FENCE = { kind: 'pid', pid: process.pid, startedAt: 'recovering-process' } as const;

function git(root: string, args: string[], input?: string): string {
    return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
}

function journaledOwner(phase: 'prepared' | 'remote-mutation-attempted', epoch: number): string {
    return JSON.stringify({
        version: 4,
        pid: CRASHED_PID,
        token: '123e4567-e89b-12d3-a456-426614174000',
        operation: 'delivery',
        number: NUMBER,
        ownerFence: { kind: 'pgid', pgid: CRASHED_PID, leaderStartedAt: 'crashed-delivery-start' },
        mutation: { phase, epoch },
    });
}

function initialize(root: string, owner = journaledOwner('prepared', 0)): string {
    git(root, ['init', '--quiet']);
    const oid = git(root, ['hash-object', '-w', '--stdin'], owner);
    git(root, ['update-ref', REF, oid]);
    return oid;
}

function remoteState(overrides: Partial<JournaledRecoveryRemoteState> = {}): JournaledRecoveryRemoteState {
    return {
        state: overrides.state ?? 'open',
        head: overrides.head ?? HEAD,
        merged: overrides.merged ?? false,
        ...(overrides.mergedByActorNodeId === undefined ? {} : { mergedByActorNodeId: overrides.mergedByActorNodeId }),
        receipts: overrides.receipts ?? [],
    };
}

function mergedRemoteState(actorNodeId: string): JournaledRecoveryRemoteState {
    return remoteState({
        state: 'closed',
        merged: true,
        mergedByActorNodeId: actorNodeId,
        receipts: [
            {
                id: 9000000001,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                body: composeDeliveryReceipt({ pullRequest: NUMBER, head: HEAD, bodySha256: 'a'.repeat(64) }),
            },
        ],
    });
}

type Harness = {
    dependencies: DeliveryLockRecoveryDependencies;
    remoteReads: () => number;
    authentications: () => number;
};

function harness(
    root: string,
    states: JournaledRecoveryRemoteState[],
    fenceIsLive = false,
    afterRecoveryReceiptPersisted?: () => void
): Harness {
    let remoteReads = 0;
    let authentications = 0;
    return {
        remoteReads: () => remoteReads,
        authentications: () => authentications,
        dependencies: {
            trustedLauncher: { primaryRoot: root, gitPath: 'git', ghPath: 'gh' },
            authenticateAuthor: async () => {
                authentications += 1;
                return {
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session: { configDir: root, env: {}, dispose: () => undefined },
                };
            },
            repositoryName: () => 'jcosta33/sourdaw',
            readJournaledRemoteState: () => {
                const state = states[Math.min(remoteReads, states.length - 1)]!;
                remoteReads += 1;
                return state;
            },
            ownerFenceIsLive: () => fenceIsLive,
            currentOwnerFence: () => RECOVERING_FENCE,
            afterRecoveryReceiptPersisted,
        },
    };
}

function temporaryRoot(): string {
    return mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-general-recovery-'));
}

function removeTemporaryRoot(root: string): void {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
}

function recoveryReceipt(root: string, ownerOid: string): Record<string, unknown> {
    const oid = git(root, ['rev-parse', '--verify', `refs/sourdaw/delivery/recovered/pr-${NUMBER}/${ownerOid}`]);
    return JSON.parse(git(root, ['cat-file', 'blob', oid])) as Record<string, unknown>;
}

describe('deliver --recover-lock on a journaled delivery owner', () => {
    it('refuses a live owner fence by name before reading GitHub', async () => {
        const root = temporaryRoot();
        const ownerOid = initialize(root);
        const { dependencies, remoteReads, authentications } = harness(root, [remoteState()], true);

        try {
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], dependencies)
            ).rejects.toThrow(
                new RegExp(`still held by live process ${CRASHED_PID} \\(process group ${CRASHED_PID}\\)`)
            );
            expect(remoteReads()).toBe(0);
            expect(authentications()).toBe(0);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(ownerOid);
        } finally {
            removeTemporaryRoot(root);
        }
    });

    it('clears a dead owner on an open pull request and names the next command', async () => {
        const root = temporaryRoot();
        const ownerOid = initialize(root);
        const state = remoteState();
        const { dependencies } = harness(root, [state, state]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await expect(
                runDeliverCli(['--recover-lock', String(NUMBER), '--owner', ownerOid], { recovery: dependencies })
            ).resolves.toBe(0);
            expect(log.mock.calls.map(([line]) => line)).toEqual([
                `delivery-lock-recovered:${NUMBER}:${ownerOid}:OPEN`,
                `pnpm deliver ${NUMBER}`,
            ]);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
            expect(recoveryReceipt(root, ownerOid)).toMatchObject({
                number: NUMBER,
                ownerOid,
                ownerPhase: 'prepared',
                state: 'OPEN',
                head: HEAD,
                mergedByActorNodeId: null,
                receiptIds: [],
            });
        } finally {
            log.mockRestore();
            removeTemporaryRoot(root);
        }
    });

    it('records an author-App merge that landed while the delivery was attempting remote writes', async () => {
        const root = temporaryRoot();
        const ownerOid = initialize(root, journaledOwner('remote-mutation-attempted', 1));
        const state = mergedRemoteState(AUTHOR_BOT_NODE_ID);
        const { dependencies } = harness(root, [state, state]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await expect(runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], dependencies)).resolves.toBe(
                0
            );
            expect(log).toHaveBeenCalledWith(`delivery-lock-recovered:${NUMBER}:${ownerOid}:MERGED`);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
            expect(recoveryReceipt(root, ownerOid)).toMatchObject({
                ownerPhase: 'remote-mutation-attempted',
                state: 'MERGED',
                mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                receiptIds: [9000000001],
            });
        } finally {
            log.mockRestore();
            removeTemporaryRoot(root);
        }
    });

    it.each<[string, () => JournaledRecoveryRemoteState[], RegExp]>([
        [
            'a merge by an actor that is not the author App',
            () => {
                const state = mergedRemoteState(REVIEWER_BOT_NODE_ID);
                return [state, state];
            },
            new RegExp(`was merged by ${REVIEWER_BOT_NODE_ID}, which is not the author App`),
        ],
        [
            'a merge GitHub attributes to no actor',
            () => {
                const state = remoteState({ state: 'closed', merged: true });
                return [state, state];
            },
            new RegExp(`PR #${NUMBER} is merged with no merge actor`),
        ],
        [
            'a head that moves between the two reads',
            () => [remoteState(), remoteState({ head: 'd'.repeat(40) })],
            /remote state changed between reads/,
        ],
    ])('refuses %s and names the adopted owner it kept', async (_label, states, expectedError) => {
        const root = temporaryRoot();
        const ownerOid = initialize(root);
        const { dependencies } = harness(root, states());

        try {
            const thrown = await runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], dependencies).then(
                () => expect.fail('expected the recovery to refuse'),
                (error: unknown) => error
            );
            const message = thrown instanceof Error ? thrown.message : String(thrown);
            expect(message).toMatch(expectedError);
            const adoptedOid = git(root, ['rev-parse', '--verify', REF]);
            expect(adoptedOid).not.toBe(ownerOid);
            expect(message).toContain(`preserved exact lock owner ${adoptedOid}`);
            expect(message).toContain(`pnpm deliver --recover-lock ${NUMBER} --owner ${adoptedOid}`);
            expect(JSON.parse(git(root, ['cat-file', 'blob', adoptedOid]))).toMatchObject({
                version: 4,
                operation: 'delivery',
                number: NUMBER,
                pid: process.pid,
                ownerFence: RECOVERING_FENCE,
                mutation: { phase: 'prepared', epoch: 1 },
            });
            expect(() => recoveryReceipt(root, ownerOid)).toThrow();
        } finally {
            removeTemporaryRoot(root);
        }
    });

    it('releases the adopted owner a crash left behind after the receipt was persisted', async () => {
        const root = temporaryRoot();
        const ownerOid = initialize(root);
        const state = remoteState();
        const crashed = harness(root, [state, state], false, () => {
            throw new Error('crashed before releasing the adopted owner');
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], crashed.dependencies)
            ).rejects.toThrow(/crashed before releasing the adopted owner/);
            expect(log).not.toHaveBeenCalled();
            expect(git(root, ['rev-parse', '--verify', REF])).not.toBe(ownerOid);

            const replay = harness(root, [state, state]);
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], replay.dependencies)
            ).resolves.toBe(0);

            expect(log.mock.calls.map(([line]) => line)).toEqual([
                `delivery-lock-recovered:${NUMBER}:${ownerOid}:OPEN`,
                `pnpm deliver ${NUMBER}`,
            ]);
            expect(replay.remoteReads()).toBe(0);
            expect(replay.authentications()).toBe(0);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
        } finally {
            log.mockRestore();
            removeTemporaryRoot(root);
        }
    });

    it('refuses to replay a receipt when the ref holds neither the recorded nor the adopted owner', async () => {
        const root = temporaryRoot();
        const ownerOid = initialize(root);
        const state = remoteState();
        const crashed = harness(root, [state, state], false, () => {
            throw new Error('crashed before releasing the adopted owner');
        });

        try {
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], crashed.dependencies)
            ).rejects.toThrow(/crashed before releasing the adopted owner/);
            const foreignOid = git(root, ['hash-object', '-w', '--stdin'], journaledOwner('prepared', 7));
            git(root, ['update-ref', REF, foreignOid]);

            const replay = harness(root, [state, state]);
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], replay.dependencies)
            ).rejects.toThrow(/delivery lock ownership changed before recovery/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(foreignOid);
            expect(replay.remoteReads()).toBe(0);
        } finally {
            removeTemporaryRoot(root);
        }
    });

    it('replays a recorded recovery without reading or writing GitHub again', async () => {
        const root = temporaryRoot();
        const ownerOid = initialize(root);
        const state = remoteState();
        const first = harness(root, [state, state]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], first.dependencies)
            ).resolves.toBe(0);
            const expectedLines = log.mock.calls.map(([line]) => line);
            log.mockClear();

            const replay = harness(root, [state, state]);
            await expect(
                runRecoverDeliveryLockCli([String(NUMBER), '--owner', ownerOid], replay.dependencies)
            ).resolves.toBe(0);

            expect(log.mock.calls.map(([line]) => line)).toEqual(expectedLines);
            expect(replay.remoteReads()).toBe(0);
            expect(replay.authentications()).toBe(0);
        } finally {
            log.mockRestore();
            removeTemporaryRoot(root);
        }
    });
});
