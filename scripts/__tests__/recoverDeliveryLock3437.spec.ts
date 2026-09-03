import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDeliverCli } from '../deliverPullRequest.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { composeDeliveryReceipt } from '../prContract.ts';
import { runRecoverDeliveryLockCli, type DeliveryLockRecoveryDependencies } from '../recoverDeliveryLock.ts';

const NUMBER = 3437;
const OWNER_OID = '3ebcbf92f6a331dcd31a00b1891b522fbd170748';
const CURRENT_HEAD = 'c'.repeat(40);
const REF = `refs/sourdaw/delivery/pr-${NUMBER}`;
const OWNER = '{"version":1,"pid":26953,"token":"f515a71d-c25a-4714-b725-ef6e9b141005"}';

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

function receiptComment(overrides: Partial<{ id: number; authorNodeId: string; body: string }> = {}) {
    return {
        id: overrides.id ?? 9000000001,
        authorNodeId: overrides.authorNodeId ?? AUTHOR_BOT_NODE_ID,
        body:
            overrides.body ??
            composeDeliveryReceipt({
                pullRequest: NUMBER,
                head: CURRENT_HEAD,
                bodySha256: 'a'.repeat(64),
            }),
    };
}

function remoteState(
    overrides: Partial<{
        state: string;
        head: string;
        merged: boolean;
        comments: ReturnType<typeof receiptComment>[];
    }> = {}
) {
    return {
        state: overrides.state ?? 'open',
        head: overrides.head ?? CURRENT_HEAD,
        merged: overrides.merged ?? false,
        comments: overrides.comments ?? [],
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

// The default missing-receipt reader shells out to `gh api`; this stub answers exactly the two
// endpoints that reader calls and models --paginate honestly: without the flag only page one of
// the comments exists, with it both pages come back slurped into one array of page arrays. The
// script uses only shell builtins so it runs under the replaced child environment, which carries
// no PATH.
function writeStubGh(root: string): string {
    const receipt = composeDeliveryReceipt({
        pullRequest: NUMBER,
        head: CURRENT_HEAD,
        bodySha256: 'a'.repeat(64),
    });
    const pageOne = [{ id: 9000000001, user: { node_id: AUTHOR_BOT_NODE_ID }, body: 'ordinary discussion' }];
    const pageTwo = [{ id: 9000000002, user: { node_id: AUTHOR_BOT_NODE_ID }, body: receipt }];
    const pullRequestRecord = JSON.stringify({ state: 'open', head: { sha: CURRENT_HEAD }, merged: false });
    const paginatedComments = JSON.stringify([pageOne, pageTwo]);
    const firstPageComments = JSON.stringify([pageOne]);
    const stubPath = join(root, 'gh');
    writeFileSync(
        stubPath,
        [
            '#!/bin/sh',
            'url=',
            'paginate=0',
            'for arg in "$@"; do',
            '    case "$arg" in',
            '        --paginate) paginate=1 ;;',
            '        repos/*) url=$arg ;;',
            '    esac',
            'done',
            'case "$url" in',
            `    repos/jcosta33/sourdaw/pulls/${NUMBER})`,
            `        printf '%s\\n' '${pullRequestRecord}'`,
            '        ;;',
            `    repos/jcosta33/sourdaw/issues/${NUMBER}/comments*)`,
            '        if [ "$paginate" = 1 ]; then',
            `            printf '%s\\n' '${paginatedComments}'`,
            '        else',
            `            printf '%s\\n' '${firstPageComments}'`,
            '        fi',
            '        ;;',
            '    *)',
            '        echo "stub gh: unexpected arguments" >&2',
            '        exit 1',
            '        ;;',
            'esac',
            '',
        ].join('\n')
    );
    chmodSync(stubPath, 0o700);
    return stubPath;
}

describe('deliver --recover-lock 3437', () => {
    it('routes recovery through the existing deliver command', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();

        try {
            await expect(
                runDeliverCli(['--recover-lock', '3437', '--owner', OWNER_OID], {
                    recovery: dependencies(root, [state, state]),
                })
            ).resolves.toBe(0);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('releases only the exact retained incident lock after two stable reads without a receipt', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();

        try {
            await expect(
                runRecoverDeliveryLockCli(['3437', '--owner', OWNER_OID], dependencies(root, [state, state]))
            ).resolves.toBe(0);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('ignores non-author receipts and ordinary author comments when proving receipt absence', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState({
            comments: [
                receiptComment({ authorNodeId: REVIEWER_BOT_NODE_ID }),
                receiptComment({ id: 9000000002, body: 'ordinary discussion' }),
            ],
        });

        try {
            await expect(
                runRecoverDeliveryLockCli(['3437', '--owner', OWNER_OID], dependencies(root, [state, state]))
            ).resolves.toBe(0);
            expect(() => git(root, ['rev-parse', '--verify', REF])).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('finds an author delivery receipt on a later comments page through the default reader', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const stubGh = writeStubGh(root);

        try {
            await expect(
                runRecoverDeliveryLockCli(['3437', '--owner', OWNER_OID], {
                    trustedLauncher: { primaryRoot: root, gitPath: 'git', ghPath: 'gh' },
                    authenticateAuthor: async () => ({
                        minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                        session: {
                            configDir: root,
                            env: { SOURDAW_TRUSTED_GH_PATH: stubGh },
                            dispose: () => undefined,
                        },
                    }),
                    repositoryName: () => 'jcosta33/sourdaw',
                    processIsDead: () => true,
                })
            ).rejects.toThrow(/already carries an author delivery receipt/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it.each<[string, () => IncidentTestChange]>([
        [
            'owner OID',
            () => ({
                ownerOid: 'd'.repeat(40),
                owner: { version: 1 as const, pid: 26953, token: 'f515a71d-c25a-4714-b725-ef6e9b141005' },
                expectedError: /owner does not match this recovery incident/,
            }),
        ],
        [
            'owner payload',
            () => ({
                owner: { version: 1 as const, pid: 7, token: '00000000-0000-4000-8000-000000000000' },
                expectedError: /payload does not match the retained incident owner/,
            }),
        ],
        [
            'live owner PID',
            () => ({ processIsDead: () => false, expectedError: /still live or cannot be proven dead/ }),
        ],
        ['closed PR', () => ({ state: remoteState({ state: 'closed' }), expectedError: /is not open/ })],
        [
            'unverifiable head',
            () => ({ state: remoteState({ head: 'not-a-sha' }), expectedError: /current head cannot be verified/ }),
        ],
        ['merged PR', () => ({ state: remoteState({ merged: true }), expectedError: /is already merged/ })],
        [
            'author receipt comment',
            () => ({
                state: remoteState({ comments: [receiptComment()] }),
                expectedError: /already carries an author delivery receipt/,
            }),
        ],
        [
            'a malformed author receipt-shaped comment',
            () => ({
                state: remoteState({
                    comments: [receiptComment({ body: '<!-- sourdaw-delivery-receipt:v2\npull-request: 3437\n-->' })],
                }),
                expectedError: /invalid delivery receipt/,
            }),
        ],
        [
            'an author receipt naming a different pull request',
            () => ({
                state: remoteState({
                    comments: [
                        receiptComment({
                            body: composeDeliveryReceipt({
                                pullRequest: 9999,
                                head: CURRENT_HEAD,
                                bodySha256: 'a'.repeat(64),
                            }),
                        }),
                    ],
                }),
                expectedError: /already carries an author delivery receipt/,
            }),
        ],
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
            await expect(runRecoverDeliveryLockCli(['3437', '--owner', OWNER_OID], configured)).rejects.toThrow(
                expectedError
            );
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it.each<[string, string[]]>([
        ['an unknown pull request', ['1', '--owner', OWNER_OID]],
        ['the 3344 owner against 3437', ['3437', '--owner', '9f9c875746e69d6282e4233b32dfb1d07f418724']],
        ['the 3437 owner against 3344', ['3344', '--owner', OWNER_OID]],
    ])('refuses %s as a wrong PR/owner combination', async (_label, args) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        const state = remoteState();

        try {
            await expect(runRecoverDeliveryLockCli(args, dependencies(root, [state, state]))).rejects.toThrow(
                /usage: pnpm deliver --recover-lock/
            );
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('refuses remote head drift between the two required state reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        try {
            await expect(
                runRecoverDeliveryLockCli(
                    ['3437', '--owner', OWNER_OID],
                    dependencies(root, [remoteState(), remoteState({ head: 'd'.repeat(40) })])
                )
            ).rejects.toThrow(/remote state changed/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('refuses a comment appearing between the two required state reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        try {
            await expect(
                runRecoverDeliveryLockCli(
                    ['3437', '--owner', OWNER_OID],
                    dependencies(root, [
                        remoteState(),
                        remoteState({ comments: [receiptComment({ id: 9000000003, body: 'ordinary discussion' })] }),
                    ])
                )
            ).rejects.toThrow(/remote state changed/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('refuses same-id comment body drift between the two required state reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-recovery-'));
        initialize(root);
        try {
            await expect(
                runRecoverDeliveryLockCli(
                    ['3437', '--owner', OWNER_OID],
                    dependencies(root, [
                        remoteState({ comments: [receiptComment({ body: 'original wording' })] }),
                        remoteState({ comments: [receiptComment({ body: 'edited wording' })] }),
                    ])
                )
            ).rejects.toThrow(/remote state changed/);
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(OWNER_OID);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
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
            await expect(runRecoverDeliveryLockCli(['3437', '--owner', OWNER_OID], configured)).rejects.toThrow(
                /ownership changed before release/
            );
            expect(git(root, ['rev-parse', '--verify', REF])).toBe(replacement);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });
});
