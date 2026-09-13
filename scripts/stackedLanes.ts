import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type LaneStack = {
    version: 1;
    childBranch: string;
    parentBranch: string;
    forkHead: string;
    parentHead: string;
    parentPullRequest?: number;
};

export type StackParent = {
    number: number;
    branch: string;
    headSha: string;
    state: 'OPEN' | 'MERGED' | 'CLOSED';
    authorId: string;
    repository: string;
    mergeCommit?: string;
};

const shaPattern = /^[0-9a-f]{40,64}$/;
const branchPattern = /^agent\/[a-z0-9][a-z0-9/-]*$/;

export function parseLaneStack(value: unknown): LaneStack {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid lane stack descriptor');
    }
    const row = value as Record<string, unknown>;
    const keys = ['version', 'childBranch', 'parentBranch', 'forkHead', 'parentHead', 'parentPullRequest'];
    if (
        Object.keys(row).some((key) => !keys.includes(key)) ||
        row.version !== 1 ||
        typeof row.childBranch !== 'string' ||
        !branchPattern.test(row.childBranch) ||
        typeof row.parentBranch !== 'string' ||
        !branchPattern.test(row.parentBranch) ||
        row.childBranch === row.parentBranch ||
        typeof row.forkHead !== 'string' ||
        !shaPattern.test(row.forkHead) ||
        typeof row.parentHead !== 'string' ||
        !shaPattern.test(row.parentHead) ||
        (row.parentPullRequest !== undefined &&
            (typeof row.parentPullRequest !== 'number' ||
                !Number.isSafeInteger(row.parentPullRequest) ||
                row.parentPullRequest <= 0))
    ) {
        fail('invalid lane stack descriptor');
    }
    const descriptor: LaneStack = {
        version: 1,
        childBranch: row.childBranch,
        parentBranch: row.parentBranch,
        forkHead: row.forkHead,
        parentHead: row.parentHead,
    };
    if (row.parentPullRequest !== undefined) {
        descriptor.parentPullRequest = row.parentPullRequest;
    }
    return descriptor;
}

function descriptorPath(primaryRoot: string, branch: string): string {
    return join(primaryRoot, '.agents', 'lane-stacks', `${createHash('sha256').update(branch).digest('hex')}.json`);
}

export function readLaneStack(primaryRoot: string, branch: string): LaneStack | undefined {
    const path = descriptorPath(primaryRoot, branch);
    if (!existsSync(path)) {
        return undefined;
    }
    const descriptor = parseLaneStack(JSON.parse(readFileSync(path, 'utf8')));
    if (descriptor.childBranch !== branch) {
        fail('lane stack descriptor belongs to another branch');
    }
    return descriptor;
}

export function writeLaneStack(primaryRoot: string, descriptor: LaneStack): void {
    const validated = parseLaneStack(descriptor);
    const existing = readLaneStack(primaryRoot, validated.childBranch);
    if (
        existing !== undefined &&
        (existing.parentBranch !== validated.parentBranch ||
            existing.forkHead !== validated.forkHead ||
            (existing.parentPullRequest !== undefined && existing.parentPullRequest !== validated.parentPullRequest))
    ) {
        fail('refusing to replace recorded stack lineage or parent pull request');
    }
    const path = descriptorPath(primaryRoot, validated.childBranch);
    mkdirSync(join(path, '..'), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
}

export function readRegisteredLaneStack(
    primaryRoot: string,
    branch: string,
    forkMarker: string
): LaneStack | undefined {
    const descriptor = readLaneStack(primaryRoot, branch);
    if (forkMarker !== '' && descriptor === undefined) {
        fail('stack descriptor missing; restore the recorded descriptor before publication');
    }
    if (descriptor !== undefined && descriptor.forkHead !== forkMarker) {
        fail('stack descriptor does not match the branch lineage marker');
    }
    return descriptor;
}

export function assertStackAcyclic(descriptor: LaneStack, read: (branch: string) => LaneStack | undefined): void {
    const seen = new Set([descriptor.childBranch]);
    let parent: string | undefined = descriptor.parentBranch;
    while (parent !== undefined) {
        if (seen.has(parent)) {
            fail('lane stack cycle');
        }
        seen.add(parent);
        parent = read(parent)?.parentBranch;
    }
}

export type StackReadPort = {
    parents: (branch: string) => StackParent[];
    isAncestor: (ancestor: string, descendant: string) => boolean;
};

export function stackParentQuery(branch: string): string[] {
    return [
        'api',
        '--paginate',
        '--slurp',
        `repos/${REQUIRED_REPOSITORY}/pulls?state=all&head=${encodeURIComponent(`${REQUIRED_REPOSITORY.split('/')[0]}:${branch}`)}&per_page=100`,
    ];
}

function parentState(state: 'open' | 'closed', mergedAt: string | null): StackParent['state'] {
    if (mergedAt !== null) {
        return 'MERGED';
    }
    return state === 'open' ? 'OPEN' : 'CLOSED';
}

export function parseStackParents(raw: string): StackParent[] {
    const pages: unknown = JSON.parse(raw);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        fail('incomplete stack parent query');
    }
    return pages.flat().map((value: unknown): StackParent => {
        if (value === null || typeof value !== 'object') {
            fail('invalid stack parent response');
        }
        const row = value as Record<string, unknown>;
        const head = row.head as { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } } | undefined;
        const user = row.user as { node_id?: unknown } | undefined;
        if (
            typeof row.number !== 'number' ||
            !Number.isSafeInteger(row.number) ||
            row.number <= 0 ||
            typeof head?.ref !== 'string' ||
            typeof head.sha !== 'string' ||
            !shaPattern.test(head.sha) ||
            typeof head.repo?.full_name !== 'string' ||
            typeof user?.node_id !== 'string' ||
            (row.state !== 'open' && row.state !== 'closed') ||
            (row.merged_at !== null && typeof row.merged_at !== 'string')
        ) {
            fail('invalid stack parent response');
        }
        const parent: StackParent = {
            number: row.number,
            branch: head.ref,
            headSha: head.sha,
            state: parentState(row.state, row.merged_at),
            authorId: user.node_id,
            repository: head.repo.full_name,
        };
        if (typeof row.merge_commit_sha === 'string') {
            parent.mergeCommit = row.merge_commit_sha;
        }
        return parent;
    });
}

export function stackParentCandidates(descriptor: LaneStack, parents: StackParent[]): StackParent[] {
    return parents.filter((parent) => {
        if (
            parent.branch !== descriptor.parentBranch ||
            parent.repository !== REQUIRED_REPOSITORY ||
            parent.authorId !== AUTHOR_BOT_NODE_ID
        ) {
            return false;
        }
        if (descriptor.parentPullRequest !== undefined) {
            return parent.number === descriptor.parentPullRequest;
        }
        return true;
    });
}

export function resolveStackParent(descriptor: LaneStack, port: StackReadPort): StackParent {
    const candidates = stackParentCandidates(descriptor, port.parents(descriptor.parentBranch));
    const matches = candidates.filter((parent) => port.isAncestor(descriptor.forkHead, parent.headSha));
    if (matches.length !== 1) {
        fail('stack parent must resolve to exactly one published author pull request');
    }
    const parent = matches[0];
    if (parent === undefined || !shaPattern.test(parent.headSha)) {
        fail('invalid stack parent head');
    }
    if (!port.isAncestor(descriptor.parentHead, parent.headSha)) {
        fail('stack parent history no longer contains its admitted head');
    }
    if (parent.state === 'CLOSED') {
        fail('stack parent closed without merging');
    }
    return parent;
}

export function assertLandedStackParent(
    descriptor: LaneStack,
    childHead: string,
    mainHead: string,
    port: StackReadPort
): StackParent {
    const parent = resolveStackParent(descriptor, port);
    if (
        descriptor.parentPullRequest === undefined ||
        parent.state !== 'MERGED' ||
        parent.mergeCommit === undefined ||
        !shaPattern.test(parent.mergeCommit) ||
        !port.isAncestor(parent.mergeCommit, mainHead) ||
        !port.isAncestor(parent.mergeCommit, childHead) ||
        !port.isAncestor(descriptor.forkHead, childHead)
    ) {
        fail('stack child requires landed parent reconciliation before approval');
    }
    return parent;
}

export function stackPublicationBase(
    descriptor: LaneStack,
    childHead: string,
    mainHead: string,
    port: StackReadPort
): {
    branch: string;
    head: string;
    parent: StackParent;
} {
    const parent = resolveStackParent(descriptor, port);
    if (!port.isAncestor(descriptor.forkHead, childHead)) {
        fail('stack child no longer contains its fork head');
    }
    if (parent.state === 'OPEN') {
        if (parent.headSha !== descriptor.parentHead || !port.isAncestor(parent.headSha, childHead)) {
            fail('stack parent moved: run lane:sync-parent before publishing');
        }
        return { branch: parent.branch, head: parent.headSha, parent };
    }
    assertLandedStackParent({ ...descriptor, parentPullRequest: parent.number }, childHead, mainHead, port);
    return { branch: 'main', head: mainHead, parent };
}
