import {
    GITHUB_HTTPS_REMOTE,
    REQUIRED_REPOSITORY,
    REQUIRED_BASE_BRANCH,
    trustedChildExecutable,
    parseJson,
    type GhSession,
    type spawnCapture,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { readReviewBundleContext, reviewBundlePath, type ReviewBundleContext } from './prepareReview.ts';
import {
    assertLandedStackParent,
    parseStackParents,
    readRegisteredLaneStack,
    stackParentCandidates,
    stackParentQuery,
} from './stackedLanes.ts';

import type { PublishReviewPort, ReviewDocument } from './publishReview.ts';

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

export function readLiveApprovalContext(
    primaryRoot: string,
    number: number,
    head: string,
    bundle: string,
    session: GhSession,
    capture: typeof spawnCapture
): ReviewBundleContext {
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    const git = (args: string[]) => capture('git', args, { cwd: primaryRoot, env: session.env });
    const ghExecutable = trustedChildExecutable('gh', session.env).replaceAll("'", "'\\''");
    const fetch = (shas: string[]) =>
        git([
            '-c',
            'credential.helper=',
            '-c',
            `credential.helper=!'${ghExecutable}' auth git-credential`,
            'fetch',
            '--no-write-fetch-head',
            GITHUB_HTTPS_REMOTE,
            ...shas,
        ]);
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
        pr.state !== 'OPEN' ||
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
    const marker = git(['config', '--get', '--default', '', `branch.${pr.headRefName}.sourdaw-stack-fork`]);
    const descriptor = readRegisteredLaneStack(primaryRoot, pr.headRefName, marker);
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
