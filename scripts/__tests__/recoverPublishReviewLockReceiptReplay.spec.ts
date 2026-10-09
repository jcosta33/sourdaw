import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    parseReviewDocument,
    publishReview,
    renderReviewDocumentBody,
    reviewPublicationPayload,
    reviewPublicationPayloadDigest,
    shellPort,
} from '../publishReview.ts';
import {
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    recordReviewPublicationRecoveryReceipt,
    writePullRequestMutationLockOwner,
} from '../pullRequestMutationLock.ts';
import { runRecoverPublishReviewLockCli } from '../recoverPublishReviewLock.ts';
import { parseReviewDossier } from '../reviewDossier.ts';
import { buildReviewDossier } from '../reviewDossierPublication.ts';
import { deliveryAuthorization, publishedReviewId } from '../reviewDossierViews.ts';
import { recoveryReceipt } from '../reviewPublicationRecoveryReceipt.ts';
import { inspectReviewPublicationRemote } from '../reviewPublicationRemoteInspection.ts';

import type { PublishReviewPort } from '../publishReview.ts';
import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const number = 5111;
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const reviewId = 5458704450;
const reviewJson = {
    format: 'compact-v1',
    event: 'APPROVE',
    reviewerModel: 'review-model',
    body: 'The focused recovery checks held.',
    comments: [],
    evidence: {
        headSha: head,
        claims: [{ observable: 'receipt replay', verification: 'two live reads', observed: 'same approval' }],
    },
};
const document = parseReviewDocument(reviewJson);
const body = renderReviewDocumentBody(document);
const session: GhSession = { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined };
const roots: string[] = [];

function git(root: string, args: string[]): void {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

function bundlePath(root: string): string {
    return join(root, '.agents', 'review-bundles', `${number}-${head}`);
}

function fixture(input: { receiptHead?: string; receiptDigest?: string; planCarrying?: boolean } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-receipt-adoption-'));
    roots.push(root);
    git(root, ['init']);
    const bundle = bundlePath(root);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'review.json'), JSON.stringify(reviewJson));
    writeFileSync(join(bundle, 'diff.patch'), 'diff --git a/AGENTS.md b/AGENTS.md\n');
    writeFileSync(
        join(bundle, 'manifest.json'),
        JSON.stringify({ pr: number, baseRefName: 'main', baseSha: base, headSha: head })
    );
    const plan: ReviewRiskPlan = {
        format: 'risk-plan-v1',
        pr: number,
        headSha: head,
        baseSha: base,
        riskClasses: ['small'],
        requiredStances: ['correctness', 'test-validity'],
        triggers: ['small:handwritten-lines<=200'],
    };
    if (input.planCarrying !== false) {
        writeFileSync(join(bundle, 'risk-plan.json'), JSON.stringify(plan));
    }
    const { canonical } = buildReviewDossier({
        plan,
        raw: {
            format: 'dossier-input-v1',
            pr: number,
            headSha: head,
            baseSha: base,
            stances: [
                { stance: 'correctness', reviewerModel: 'review-model', modelTier: 'strongest', outcome: 'clean' },
                { stance: 'test-validity', reviewerModel: 'review-model', modelTier: 'standard', outcome: 'clean' },
            ],
            evidence: [{ observable: 'an exact approval', verification: 'two live reads', observed: 'same review' }],
            limitations: [],
            assessmentImpact: 'none',
        },
        discarded: [],
        comments: [],
        recommendation: 'approve',
    });
    if (input.planCarrying !== false) {
        writeFileSync(join(bundle, 'dossier.json'), canonical);
    }
    const payloadDigest = reviewPublicationPayloadDigest(
        reviewPublicationPayload({
            commitId: head,
            event: document.event,
            body,
            comments: document.comments,
        })
    );
    const owner = {
        version: 3 as const,
        pid: 999_999,
        token: '11111111-1111-4111-8111-111111111111',
        operation: 'review-publication' as const,
        number,
        expectedHead: head,
        payloadDigest,
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
        ownerFence: { kind: 'pgid' as const, pgid: 999_999, leaderStartedAt: 'Tue Oct  6 19:46:37 2026' },
        mutation: { phase: 'remote-mutation-attempted' as const, epoch: 2 },
    };
    const ownerOid = writePullRequestMutationLockOwner(root, owner, number);
    const adoptedOwnerOid = writePullRequestMutationLockOwner(
        root,
        {
            ...owner,
            token: '22222222-2222-4222-8222-222222222222',
            mutation: { ...owner.mutation, epoch: 3 },
        },
        number
    );
    recordReviewPublicationRecoveryReceipt(
        root,
        number,
        ownerOid,
        recoveryReceipt(
            number,
            ownerOid,
            adoptedOwnerOid,
            input.receiptHead ?? head,
            input.receiptDigest ?? payloadDigest,
            'landed'
        )
    );
    return { root, ownerOid, bundle, payloadDigest };
}

function remote(
    input: {
        state?: string;
        liveHead?: string;
        stateAfterInspections?: string;
        liveHeadAfterInspections?: string;
        actor?: string;
        body?: string;
        unresolvedThreads?: number;
        extraComment?: boolean;
        driftAfterFirst?: boolean;
        dismissAfterFirst?: boolean;
        laterReviewerState?: string;
        laterReviewerHead?: string;
        reviewerVisibility?: 'missing' | 'null-id';
    } = {}
) {
    const state = { posts: 0, inspections: 0, reviewStateReads: 0 };
    let reviewerVisibility: 'complete' | 'missing' | 'null-id' = input.reviewerVisibility ?? 'complete';
    const liveHead = input.liveHead ?? head;
    const prState = input.state ?? 'OPEN';
    const review = {
        id: reviewId,
        state: 'APPROVED',
        body: input.body ?? body,
        commit_id: head,
        user: { node_id: input.actor ?? REVIEWER_BOT_NODE_ID, login: 'reviewer[bot]', type: 'Bot' },
    };
    const gh = (args: string[]): string => {
        if (args[0] === 'pr') {
            state.inspections += 1;
            return JSON.stringify({
                state: state.inspections > 2 ? (input.stateAfterInspections ?? prState) : prState,
                headRefOid: state.inspections > 2 ? (input.liveHeadAfterInspections ?? liveHead) : liveHead,
                labels: [],
            });
        }
        if (args[0] === 'api' && args[1] === 'graphql') {
            state.reviewStateReads += 1;
            // The later decision arrives after both exact REST inspections, before authority is read.
            if (input.laterReviewerState !== undefined && state.inspections < 2) {
                throw new Error('later review state read before two exact publication inspections');
            }
            const reviewStateNodes: Array<{
                id: string;
                databaseId: number | null;
                state: string;
                submittedAt: string;
                author: { login: string; __typename: string; id: string };
                commit: { oid: string };
            }> = [];
            if (reviewerVisibility !== 'missing') {
                reviewStateNodes.push({
                    id: `PRR_${reviewId}`,
                    databaseId: reviewerVisibility === 'null-id' ? null : reviewId,
                    state: 'APPROVED',
                    submittedAt: '2026-10-06T19:46:57Z',
                    author: { login: 'reviewer[bot]', __typename: 'Bot', id: review.user.node_id },
                    commit: { oid: head },
                });
            }
            if (input.laterReviewerState !== undefined) {
                reviewStateNodes.push({
                    id: `PRR_${reviewId + 1}`,
                    databaseId: reviewId + 1,
                    state: input.laterReviewerState,
                    submittedAt: '2026-10-06T19:47:57Z',
                    author: { login: 'reviewer[bot]', __typename: 'Bot', id: review.user.node_id },
                    commit: { oid: input.laterReviewerHead ?? head },
                });
            }
            return JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            id: 'PR_fixture',
                            headRefOid: liveHead,
                            reviews: {
                                nodes: reviewStateNodes,
                                pageInfo: { hasPreviousPage: false, startCursor: null },
                            },
                            reviewThreads: {
                                nodes: Array.from({ length: input.unresolvedThreads ?? 0 }, (_, index) => ({
                                    id: `PRRT_${index}`,
                                    isResolved: false,
                                })),
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                },
            });
        }
        if (args.includes('--method')) {
            state.posts += 1;
            throw new Error('duplicate review POST');
        }
        const endpoint = args.at(-1) ?? '';
        if (endpoint.endsWith(`/pulls/${number}/reviews?per_page=100`)) {
            if (input.driftAfterFirst && state.inspections > 1) {
                return JSON.stringify([[{ ...review, body: 'changed after first inspection' }]]);
            }
            if (input.dismissAfterFirst && state.inspections > 1) {
                return JSON.stringify([[{ ...review, state: 'DISMISSED' }]]);
            }
            return JSON.stringify([[review]]);
        }
        if (endpoint.endsWith(`/pulls/${number}/comments?per_page=100`)) {
            if (input.extraComment) {
                return JSON.stringify([
                    [
                        {
                            id: 1,
                            pull_request_review_id: reviewId,
                            path: 'AGENTS.md',
                            original_line: 1,
                            side: 'RIGHT',
                            body: 'unexpected',
                            in_reply_to_id: null,
                        },
                    ],
                ]);
            }
            return JSON.stringify([[]]);
        }
        if (endpoint.endsWith(`/pulls/${number}/reviews/${reviewId}`)) {
            return JSON.stringify(review);
        }
        throw new Error(`unexpected gh request: ${args.join(' ')}`);
    };
    return {
        state,
        gh,
        showCompleteReview: () => {
            reviewerVisibility = 'complete';
        },
    };
}

function port(root: string, gh: (args: string[]) => string): PublishReviewPort {
    const result = shellPort(session, root, (command, args) => {
        if (command === 'git' && args[0] === 'rev-parse') {
            return join(root, '.git');
        }
        if (command === 'gh') {
            return gh(args);
        }
        throw new Error(`unexpected ${command} ${args.join(' ')}`);
    });
    return {
        ...result,
        primaryRoot: () => root,
        assertApprovalContext: () => ({ pr: number, baseRefName: 'main', baseSha: base, headSha: head }),
    };
}

function recover(
    root: string,
    ownerOid: string,
    gh: (args: string[]) => string,
    overrides: { isOwnerLive?: () => boolean; publicationPort?: () => PublishReviewPort } = {}
) {
    return runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
        primaryRoot: () => root,
        authenticateReviewer: async () => ({ minted: { actorNodeId: REVIEWER_BOT_NODE_ID }, session }),
        repositoryName: () => 'jcosta33/sourdaw',
        inspect: (pr, actor, expectedHead) => inspectReviewPublicationRemote(pr, actor, expectedHead, gh),
        publicationPort: overrides.publicationPort ?? (() => port(root, gh)),
        isOwnerLive: overrides.isOwnerLive ?? (() => false),
        currentOwnerFence: () => ({ kind: 'pid', pid: process.pid, startedAt: 'test-process' }),
    });
}

function dossier(root: string) {
    return parseReviewDossier(JSON.parse(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')) as unknown);
}

describe('already recovered landed receipt binds its modern dossier', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const root of roots.splice(0)) {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('binds once after two exact reads, authorizes an open current approval, then replays without POST', async () => {
        const { root, ownerOid } = fixture();
        const github = remote();
        const before = dossier(root);

        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

        const bound = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        expect(github.state.inspections).toBeGreaterThanOrEqual(3);
        expect(publishedReviewId(dossier(root))).toBe(reviewId);
        expect(deliveryAuthorization(dossier(root))).toMatchObject({
            reviewId,
            approvalReviewId: reviewId,
            unresolvedThreads: 0,
        });
        expect(dossier(root).events.slice(0, before.events.length)).toEqual(before.events);
        expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).toBeUndefined();
        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(bound);
        expect(publishReview(number, port(root, github.gh))).toBe(reviewId);
        expect(github.state.posts).toBe(0);
    });

    it.each(['missing', 'null-id'] as const)(
        'waits for a complete %s reviewer identity before binding the same approval',
        async (reviewerVisibility) => {
            const { root, ownerOid } = fixture();
            const github = remote({ reviewerVisibility });
            const before = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');

            await expect(recover(root, ownerOid, github.gh)).rejects.toThrow(/incomplete reviewer approval identity/);

            expect(github.state.reviewStateReads).toBe(2);
            expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(before);
            expect(github.state.posts).toBe(0);
            github.showCompleteReview();

            await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

            const bound = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
            expect(publishedReviewId(dossier(root))).toBe(reviewId);
            expect(dossier(root).events.filter((event) => event.kind === 'review-published')).toHaveLength(1);
            expect(dossier(root).events.filter((event) => event.kind === 'delivery-authorized')).toHaveLength(1);
            expect(deliveryAuthorization(dossier(root))).toMatchObject({ reviewId, approvalReviewId: reviewId });
            await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);
            expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(bound);
            expect(publishReview(number, port(root, github.gh))).toBe(reviewId);
            expect(github.state.posts).toBe(0);
        }
    );

    it('binds a merged historical approval without adding delivery authority', async () => {
        const { root, ownerOid } = fixture();
        const github = remote({ state: 'MERGED' });

        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

        expect(publishedReviewId(dossier(root))).toBe(reviewId);
        expect(deliveryAuthorization(dossier(root))).toBeUndefined();
        expect(github.state.inspections).toBeGreaterThanOrEqual(2);
    });

    it('binds a stale-head approval without adding delivery authority', async () => {
        const { root, ownerOid } = fixture();
        const github = remote({ liveHead: 'c'.repeat(40) });

        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

        expect(publishedReviewId(dossier(root))).toBe(reviewId);
        expect(deliveryAuthorization(dossier(root))).toBeUndefined();
    });

    it.each([
        { label: 'merged', remoteInput: { stateAfterInspections: 'MERGED' } },
        { label: 'closed', remoteInput: { stateAfterInspections: 'CLOSED' } },
        { label: 'moved-head', remoteInput: { liveHeadAfterInspections: 'c'.repeat(40) } },
    ])(
        'binds publication without authority when the pull request is $label after exact inspections',
        async ({ remoteInput }) => {
            const { root, ownerOid } = fixture();
            const github = remote(remoteInput);
            const before = dossier(root);

            await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

            const bound = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
            expect(publishedReviewId(dossier(root))).toBe(reviewId);
            expect(deliveryAuthorization(dossier(root))).toBeUndefined();
            expect(github.state.inspections).toBeGreaterThanOrEqual(3);
            expect(dossier(root).events.slice(0, before.events.length)).toEqual(before.events);
            await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);
            expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(bound);
            expect(github.state.posts).toBe(0);
        }
    );

    it('binds an open approval with unresolved threads without granting delivery authority', async () => {
        const { root, ownerOid } = fixture();
        const github = remote({ unresolvedThreads: 1 });

        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

        expect(publishedReviewId(dossier(root))).toBe(reviewId);
        expect(deliveryAuthorization(dossier(root))).toBeUndefined();
    });

    it.each([
        { label: 'a change request', laterReviewerState: 'CHANGES_REQUESTED' },
        { label: 'a comment', laterReviewerState: 'COMMENTED' },
        { label: 'a dismissal', laterReviewerState: 'DISMISSED' },
        { label: 'another same-head approval', laterReviewerState: 'APPROVED' },
        {
            label: 'a newer approval on another head',
            laterReviewerState: 'APPROVED',
            laterReviewerHead: 'c'.repeat(40),
        },
    ])('binds an old approval after $label without new delivery authority', async (input) => {
        const { root, ownerOid } = fixture();
        const github = remote(input);
        const before = dossier(root);

        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

        const bound = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        expect(publishedReviewId(dossier(root))).toBe(reviewId);
        expect(deliveryAuthorization(dossier(root))).toBeUndefined();
        expect(dossier(root).events.slice(0, before.events.length)).toEqual(before.events);
        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(bound);
        expect(publishReview(number, port(root, github.gh))).toBe(reviewId);
        expect(github.state.posts).toBe(0);
    });

    it.each([
        {
            label: 'head',
            fixtureInput: { receiptHead: 'c'.repeat(40) },
            remoteInput: {},
            message: /receipt does not attest the original owner/,
        },
        {
            label: 'payload',
            fixtureInput: { receiptDigest: 'd'.repeat(64) },
            remoteInput: {},
            message: /receipt does not attest the original owner/,
        },
        {
            label: 'actor',
            fixtureInput: {},
            remoteInput: { actor: 'BOT_foreign' },
            message: /unauthorized landed review evidence/,
        },
        { label: 'body', fixtureInput: {}, remoteInput: { body: 'changed' }, message: /ambiguous or non-exact/ },
        { label: 'comments', fixtureInput: {}, remoteInput: { extraComment: true }, message: /ambiguous or non-exact/ },
    ])('refuses a changed $label without mutating its dossier', async ({ fixtureInput, remoteInput, message }) => {
        const { root, ownerOid } = fixture(fixtureInput);
        const before = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        const github = remote(remoteInput);

        await expect(recover(root, ownerOid, github.gh)).rejects.toThrow(message);

        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(before);
        expect(github.state.posts).toBe(0);
        expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).toBeUndefined();
    });

    it('refuses a foreign current lock and does not bind the receipt', async () => {
        const { root, ownerOid } = fixture();
        const before = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        const foreignOwnerOid = writePullRequestMutationLockOwner(
            root,
            { version: 1, pid: 999_998, token: '33333333-3333-4333-8333-333333333333' },
            number
        );
        git(root, ['update-ref', pullRequestMutationLockRef(number), foreignOwnerOid]);
        const github = remote();

        await expect(recover(root, ownerOid, github.gh)).rejects.toThrow(/ownership changed before recovery/);

        expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).toBe(foreignOwnerOid);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(before);
        expect(github.state.inspections).toBe(0);
    });

    it('refuses a review changed between the two inspections', async () => {
        const { root, ownerOid } = fixture();
        const before = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        const github = remote({ driftAfterFirst: true });

        await expect(recover(root, ownerOid, github.gh)).rejects.toThrow(/remote state changed during reconciliation/);

        expect(github.state.inspections).toBe(2);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(before);
    });

    it('refuses an approval dismissed between the two inspections on a head that moved before both', async () => {
        const { root, ownerOid } = fixture();
        const before = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        const github = remote({ liveHead: 'c'.repeat(40), dismissAfterFirst: true });

        await expect(recover(root, ownerOid, github.gh)).rejects.toThrow(/remote state changed during reconciliation/);

        expect(github.state.inspections).toBe(2);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(before);
        expect(github.state.posts).toBe(0);
    });

    it('refuses a still-live original owner before inspecting or binding', async () => {
        const { root, ownerOid } = fixture();
        const before = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        const github = remote();

        await expect(recover(root, ownerOid, github.gh, { isOwnerLive: () => true })).rejects.toThrow(
            /still held by a live process/
        );

        expect(github.state.inspections).toBe(0);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(before);
    });

    it('replays the already-written binding after an interrupted bundle write', async () => {
        const { root, ownerOid } = fixture();
        const github = remote();
        const publication = port(root, github.gh);
        const write = publication.writeBundleText!;

        await expect(
            recover(root, ownerOid, github.gh, {
                publicationPort: () => ({
                    ...publication,
                    writeBundleText: (path, contents) => {
                        write(path, contents);
                        throw new Error('injected interruption after binding');
                    },
                }),
            })
        ).rejects.toThrow(/injected interruption after binding/);

        const bound = readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
        expect(publishedReviewId(dossier(root))).toBe(reviewId);
        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);
        expect(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')).toBe(bound);
        expect(github.state.posts).toBe(0);
    });

    it('keeps a genuinely planless landed receipt on its historical replay path', async () => {
        const { root, ownerOid } = fixture({ planCarrying: false });
        const github = remote();

        await expect(recover(root, ownerOid, github.gh)).resolves.toBe(0);

        expect(github.state.inspections).toBe(0);
        expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).toBeUndefined();
    });

    it('refuses a modern dossier whose risk plan disappeared', async () => {
        const { root, ownerOid, bundle } = fixture();
        const before = readFileSync(join(bundle, 'dossier.json'), 'utf8');
        rmSync(join(bundle, 'risk-plan.json'));
        const github = remote();

        await expect(recover(root, ownerOid, github.gh)).rejects.toThrow(/dossier without its risk plan/);

        expect(github.state.inspections).toBe(0);
        expect(readFileSync(join(bundle, 'dossier.json'), 'utf8')).toBe(before);
    });
});
