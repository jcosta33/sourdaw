import {
    GITHUB_HTTPS_REMOTE,
    REQUIRED_REPOSITORY,
    REQUIRED_BASE_BRANCH,
    trustedChildExecutable,
    parseJson,
    posixSingleQuote,
    type GhSession,
    type spawnCapture,
    spawnCaptureBytes,
} from './githubAppIdentity.ts';
import { fail, PR_STATE } from './prContract.ts';
import { readReviewBundleContext, reviewBundlePath, type ReviewBundleContext } from './prepareReview.ts';
import {
    assertLandedStackParent,
    parseStackParents,
    readRegisteredLaneStack,
    stackParentCandidates,
    stackParentQuery,
} from './stackedLanes.ts';

import type { PublishReviewPort, ReviewDocument } from './publishReview.ts';
import type { AuthorshipLabel } from './reviewerModelDiversity.ts';

export function assertSameApprovalContext(
    expected: ReviewBundleContext | undefined,
    actual: ReviewBundleContext
): void {
    if (
        expected === undefined ||
        expected.pr !== actual.pr ||
        expected.baseRefName !== actual.baseRefName ||
        expected.baseSha !== actual.baseSha ||
        expected.headSha !== actual.headSha
    ) {
        fail('approval context does not match the prepared review bundle');
    }
}

export function publicationApprovalContext(
    number: number,
    head: string,
    document: ReviewDocument,
    port: PublishReviewPort
): ReviewBundleContext | undefined {
    if (document.event !== 'APPROVE') {
        return undefined;
    }
    if (port.assertApprovalContext === undefined) {
        fail('fresh APPROVE requires an approval context reader');
    }
    const context = port.assertApprovalContext(number, head, reviewBundlePath(port.primaryRoot(), number, head));
    if (
        context.pr !== number ||
        context.headSha !== head ||
        context.baseRefName !== REQUIRED_BASE_BRANCH ||
        context.baseSha === ''
    ) {
        fail('fresh APPROVE requires the matching main approval context');
    }
    return { pr: context.pr, baseRefName: context.baseRefName, baseSha: context.baseSha, headSha: context.headSha };
}

function liveCommands(primaryRoot: string, session: GhSession, capture: typeof spawnCapture) {
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    const git = (args: string[]) => capture('git', args, { cwd: primaryRoot, env: session.env });
    const gitUntrimmed = (args: string[]) => capture('git', args, { cwd: primaryRoot, env: session.env, trim: false });
    const ghExecutable = posixSingleQuote(trustedChildExecutable('gh', session.env));
    const fetch = (shas: string[]) =>
        git([
            '-c',
            'credential.helper=',
            '-c',
            `credential.helper=!${ghExecutable} auth git-credential`,
            'fetch',
            '--no-write-fetch-head',
            GITHUB_HTTPS_REMOTE,
            ...shas,
        ]);
    return { gh, git, gitUntrimmed, fetch };
}

/**
 * The comparison a fresh publication binds its bundle to, read from live pull-request facts and git
 * objects rather than from caller-editable bundle files. The patch and numstat use exactly the
 * arguments `review:prepare` writes `diff.patch` and the risk plan from. Any base branch is
 * accepted: a stack child is reviewed against its parent's head.
 */
export type LiveReviewComparison = { mergeBase: string; patch: string | Buffer; numstat: Buffer };

export function readLiveReviewComparison(
    primaryRoot: string,
    number: number,
    head: string,
    session: GhSession,
    capture: typeof spawnCapture
): LiveReviewComparison {
    const { gh, git, gitUntrimmed, fetch } = liveCommands(primaryRoot, session, capture);
    const pr = parseJson<{ headRefOid?: unknown; baseRefOid?: unknown }>(
        gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'headRefOid,baseRefOid']),
        'live review comparison'
    );
    if (
        pr.headRefOid !== head ||
        !/^[0-9a-f]{40,64}$/.test(head) ||
        typeof pr.baseRefOid !== 'string' ||
        !/^[0-9a-f]{40,64}$/.test(pr.baseRefOid)
    ) {
        fail(`fresh review publication requires pull request #${number} to stand at head ${head}`);
    }
    fetch([pr.baseRefOid, head]);
    const mergeBase = git(['merge-base', pr.baseRefOid, head]);
    return {
        mergeBase,
        patch: spawnCaptureBytes('git', ['diff', `${mergeBase}...${head}`], {
            cwd: primaryRoot,
            env: session.env,
            maxBufferBytes: 512 * 1024 * 1024,
        }),
        numstat: Buffer.from(gitUntrimmed(['diff', '--numstat', '-z', `${mergeBase}...${head}`])),
    };
}

export function readLiveApprovalContext(
    primaryRoot: string,
    number: number,
    head: string,
    bundle: string,
    session: GhSession,
    capture: typeof spawnCapture
): ReviewBundleContext {
    const { gh, git, fetch } = liveCommands(primaryRoot, session, capture);
    const pr = parseJson<{
        number?: unknown;
        state?: unknown;
        headRefOid?: unknown;
        headRefName?: unknown;
        baseRefName?: unknown;
        baseRefOid?: unknown;
    }>(
        gh([
            'pr',
            'view',
            String(number),
            '--repo',
            REQUIRED_REPOSITORY,
            '--json',
            'number,state,headRefOid,headRefName,baseRefName,baseRefOid',
        ]),
        'approval context'
    );
    if (
        pr.number !== number ||
        pr.state !== PR_STATE.OPEN ||
        pr.headRefOid !== head ||
        pr.baseRefName !== REQUIRED_BASE_BRANCH ||
        typeof pr.baseRefOid !== 'string' ||
        !/^[0-9a-f]{40,64}$/.test(pr.baseRefOid) ||
        typeof pr.headRefName !== 'string' ||
        pr.headRefName === '' ||
        !/^[0-9a-f]{40,64}$/.test(head)
    ) {
        fail('fresh APPROVE requires an open current-head pull request based on main');
    }
    fetch([pr.baseRefOid, head]);
    const context = {
        pr: number,
        headSha: head,
        baseRefName: pr.baseRefName,
        baseSha: git(['merge-base', pr.baseRefOid, head]),
    };
    assertSameApprovalContext(readReviewBundleContext(bundle), context);
    const descriptor = readRegisteredLaneStack(primaryRoot, pr.headRefName, git);
    if (descriptor !== undefined) {
        if (descriptor.parentPullRequest === undefined) {
            fail('approval requires a pinned stack parent pull request');
        }
        assertLandedStackParent(descriptor, head, pr.baseRefOid, {
            parents: (branch) => {
                const parents = parseStackParents(gh(stackParentQuery(branch)));
                for (const parent of stackParentCandidates(descriptor, parents)) {
                    const shas = [parent.headSha];
                    if (parent.mergeCommit !== undefined) {
                        if (!/^[0-9a-f]{40,64}$/.test(parent.mergeCommit)) {
                            fail('invalid stack parent merge commit');
                        }
                        shas.push(parent.mergeCommit);
                    }
                    fetch(shas);
                }
                return parents;
            },
            isAncestor: (ancestor, descendant) => git(['merge-base', ancestor, descendant]) === ancestor,
        });
    }
    return context;
}

/** The live pull request a publication reads: state, head, authorship labels and creation time. */
export function readPublicationPullRequest(
    number: number,
    gh: (args: string[]) => string
): ReturnType<PublishReviewPort['pullRequest']> {
    const pullRequest = parseJson<{
        state?: unknown;
        headRefOid?: unknown;
        labels?: unknown;
        createdAt?: unknown;
    }>(
        gh([
            'pr',
            'view',
            String(number),
            '--repo',
            REQUIRED_REPOSITORY,
            '--json',
            'state,headRefOid,labels,createdAt',
        ]),
        'review publication pull request'
    );
    if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
        fail('review publication pull request is unreadable');
    }
    return {
        state: pullRequest.state,
        head: pullRequest.headRefOid,
        labels: readAuthorshipLabels(pullRequest.labels),
        createdAt: typeof pullRequest.createdAt === 'string' ? pullRequest.createdAt : undefined,
    };
}

/**
 * `gh pr view --json labels` answers [{name, description}]; the diversity check identifies the
 * authorship label by its `Authored by ` description fence, so both fields travel together. Absent
 * labels mean not-comparable, never fatal.
 */
function readAuthorshipLabels(labels: unknown): AuthorshipLabel[] | undefined {
    if (!Array.isArray(labels)) {
        return undefined;
    }
    return labels.flatMap((label): AuthorshipLabel[] => {
        if (typeof label !== 'object' || label === null) {
            return [];
        }
        const name = (label as Record<string, unknown>).name;
        if (typeof name !== 'string') {
            return [];
        }
        const description = (label as Record<string, unknown>).description;
        const entry: AuthorshipLabel = { name };
        if (typeof description === 'string') {
            entry.description = description;
        }
        return [entry];
    });
}
