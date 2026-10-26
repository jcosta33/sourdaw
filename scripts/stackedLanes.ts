import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
} from './githubAppIdentity.ts';
import { fail, isLaneBranch, PR_STATE, type PullRequestState } from './prContract.ts';

export type LaneStack = {
    version: 1;
    childBranch: string;
    parentBranch: string;
    forkHead: string;
    parentHead: string;
    parentPullRequest?: number;
};

export type HistoricalAdmissionReceipt = {
    version: 1;
    childPullRequest: number;
    expectedChildHead: string;
    descriptor: LaneStack;
};

export function parseHistoricalAdmissionReceipt(value: unknown): HistoricalAdmissionReceipt {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid historical admission receipt');
    }
    const row = value as Record<string, unknown>;
    if (
        Object.keys(row).sort().join(',') !== 'childPullRequest,descriptor,expectedChildHead,version' ||
        row.version !== 1 ||
        typeof row.childPullRequest !== 'number' ||
        !Number.isSafeInteger(row.childPullRequest) ||
        row.childPullRequest <= 0 ||
        typeof row.expectedChildHead !== 'string' ||
        !/^[0-9a-f]{40}$/.test(row.expectedChildHead)
    ) {
        fail('invalid historical admission receipt');
    }
    const descriptor = parseLaneStack(row.descriptor);
    if (descriptor.parentPullRequest === undefined || descriptor.parentPullRequest === row.childPullRequest) {
        fail('historical admission receipt requires a distinct pinned parent');
    }
    return {
        version: 1,
        childPullRequest: row.childPullRequest,
        expectedChildHead: row.expectedChildHead,
        descriptor,
    };
}

export function readHistoricalAdmissionReceipt(
    primaryRoot: string,
    branch: string
): HistoricalAdmissionReceipt | undefined {
    const path = `${laneStackPath(primaryRoot, branch)}.admission.json`;
    if (!existsSync(path)) {
        return undefined;
    }
    const raw = readFileSync(path, 'utf8');
    if (raw.length > 65536) {
        fail('invalid historical admission receipt');
    }
    return parseHistoricalAdmissionReceipt(JSON.parse(raw));
}

export type StackParent = {
    number: number;
    branch: string;
    headSha: string;
    state: PullRequestState;
    authorId: string;
    repository: string;
    mergeCommit?: string;
};

const shaPattern = /^[0-9a-f]{40,64}$/;

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
        !isLaneBranch(row.childBranch) ||
        typeof row.parentBranch !== 'string' ||
        !isLaneBranch(row.parentBranch) ||
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

export function laneStackPath(primaryRoot: string, branch: string): string {
    return join(primaryRoot, '.agents', 'lane-stacks', `${createHash('sha256').update(branch).digest('hex')}.json`);
}

export function readLaneStack(primaryRoot: string, branch: string): LaneStack | undefined {
    const path = laneStackPath(primaryRoot, branch);
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
    const path = laneStackPath(primaryRoot, validated.childBranch);
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
    const receipt = readHistoricalAdmissionReceipt(primaryRoot, branch);
    if (
        receipt !== undefined &&
        (descriptor === undefined ||
            receipt.descriptor.childBranch !== branch ||
            receipt.descriptor.forkHead !== forkMarker ||
            JSON.stringify({ ...receipt.descriptor, parentHead: descriptor.parentHead }) !== JSON.stringify(descriptor))
    ) {
        fail(
            'historical admission is incomplete or conflicts with registered lineage; resume the exact native admission'
        );
    }
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
        return PR_STATE.MERGED;
    }
    return state === 'open' ? PR_STATE.OPEN : PR_STATE.CLOSED;
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
    if (parent.state === PR_STATE.CLOSED) {
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
        parent.state !== PR_STATE.MERGED ||
        parent.mergeCommit === undefined ||
        !shaPattern.test(parent.mergeCommit) ||
        !port.isAncestor(parent.mergeCommit, mainHead) ||
        !port.isAncestor(parent.mergeCommit, childHead) ||
        !port.isAncestor(parent.headSha, childHead) ||
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
    if (parent.state === PR_STATE.OPEN) {
        if (parent.headSha !== descriptor.parentHead || !port.isAncestor(parent.headSha, childHead)) {
            fail('stack parent moved: run lane:sync-parent before publishing');
        }
        return { branch: parent.branch, head: parent.headSha, parent };
    }
    assertLandedStackParent({ ...descriptor, parentPullRequest: parent.number }, childHead, mainHead, port);
    return { branch: 'main', head: mainHead, parent };
}

export type HistoricalPullRequest = {
    number: number;
    id: string;
    branch: string;
    headSha: string;
    baseBranch: string;
    createdAt: string;
    repository: string;
    repositoryId: string;
    headRepository: string;
    headRepositoryId: string;
    authorId: string;
    state: string;
    events: string[];
};

export type HistoricalStackObservation = {
    child: HistoricalPullRequest;
    parent: HistoricalPullRequest;
    childPullRequests: number[];
    parentPullRequests: number[];
};

export type HistoricalAdmissionInput = {
    childPullRequest: number;
    parentPullRequest: number;
    expectedHead: string;
    branch: string;
};

export type HistoricalAdmissionPort = {
    head: () => string;
    clean: () => boolean;
    observe: () => HistoricalStackObservation;
    childLog: () => string;
    parentLog: () => string;
    parentLocalHead: () => string;
    isAncestor: (ancestor: string, descendant: string) => boolean;
    readDescriptor: () => LaneStack | undefined;
    readReceipt: () => HistoricalAdmissionReceipt | undefined;
    markers: () => string[];
    saveReceipt: (receipt: HistoricalAdmissionReceipt) => void;
    addMarker: (fork: string) => void;
    installDescriptor: (descriptor: LaneStack) => void;
    readStack: (branch: string) => LaneStack | undefined;
};

const fullSha = /^[0-9a-f]{40}$/;

export function assertHistoricalPullRequestCandidates(pr: HistoricalPullRequest, candidates: StackParent[]): void {
    if (
        candidates.length !== 1 ||
        candidates[0]?.number !== pr.number ||
        candidates[0]?.branch !== pr.branch ||
        candidates[0]?.headSha !== pr.headSha ||
        candidates[0]?.repository !== pr.repository ||
        candidates[0]?.authorId !== pr.authorId ||
        candidates[0]?.state !== pr.state
    ) {
        fail('historical head ref must have exactly one unchanged original pull request');
    }
}

type NativeRefEntry = { old: string; head: string; time: number };

function parseNativeRefEntry(line: string): NativeRefEntry & { message: string } {
    const match = /^([0-9a-f]{40}) ([0-9a-f]{40}) (.+) <([^<>]+)> ([0-9]+) [+-][0-9]{4}\t(.+)$/.exec(line);
    if (match === null) {
        fail('invalid native branch history');
    }
    const [, old, head, name, email, seconds, message] = match;
    if (
        old === undefined ||
        head === undefined ||
        seconds === undefined ||
        message === undefined ||
        name !== AUTHOR_BOT_COMMIT_NAME ||
        email !== AUTHOR_BOT_COMMIT_EMAIL
    ) {
        fail('native branch history is not bound to the author App');
    }
    const time = Number(seconds);
    if (!Number.isSafeInteger(time) || time <= 0 || /^0+$/.test(head)) {
        fail('invalid native branch timestamp or head');
    }
    return { old, head, time, message };
}

function assertNativeRefContinuation(
    entry: NativeRefEntry & { message: string },
    previous: NativeRefEntry | undefined,
    port: HistoricalAdmissionPort
): void {
    if (
        previous === undefined ||
        entry.old !== previous.head ||
        entry.time < previous.time ||
        !/^(commit(?: \(merge\))?: |merge .+: )/.test(entry.message) ||
        !port.isAncestor(entry.old, entry.head)
    ) {
        fail('native branch history is discontinuous or rewritten');
    }
}

function nativeRefHistory(raw: string, port: HistoricalAdmissionPort): NativeRefEntry[] {
    if (raw.length > 1024 * 1024 || !raw.endsWith('\n')) {
        fail('incomplete native branch history');
    }
    const lines = raw.slice(0, -1).split('\n');
    const entries: NativeRefEntry[] = [];
    for (const [index, line] of lines.entries()) {
        const { old, head, time, message } = parseNativeRefEntry(line);
        const previous = entries.at(-1);
        if (index === 0) {
            if (old !== '0'.repeat(40) || message !== `branch: Created from ${head}`) {
                fail('native branch creation record missing');
            }
        } else {
            assertNativeRefContinuation({ old, head, time, message }, previous, port);
        }
        entries.push({ old, head, time });
    }
    if (entries.length === 0) {
        fail('native branch creation record missing');
    }
    return entries;
}

function assertOriginalHistoricalParent(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation
): void {
    const { child, parent } = observation;
    if (
        child.number !== input.childPullRequest ||
        parent.number !== input.parentPullRequest ||
        child.number === parent.number ||
        child.id === parent.id ||
        child.branch !== input.branch ||
        child.headSha !== input.expectedHead ||
        child.baseBranch !== parent.branch ||
        observation.childPullRequests.length !== 1 ||
        observation.childPullRequests[0] !== child.number ||
        observation.parentPullRequests.length !== 1 ||
        observation.parentPullRequests[0] !== parent.number
    ) {
        fail('historical original parent identity does not match');
    }
}

function assertHistoricalActorsAndLifecycle(observation: HistoricalStackObservation): void {
    const { child, parent } = observation;
    for (const pr of [child, parent]) {
        if (
            pr.repository !== REQUIRED_REPOSITORY ||
            pr.headRepository !== REQUIRED_REPOSITORY ||
            pr.repositoryId !== child.repositoryId ||
            pr.headRepositoryId !== child.repositoryId ||
            pr.authorId !== AUTHOR_BOT_NODE_ID ||
            pr.state !== PR_STATE.OPEN ||
            !fullSha.test(pr.headSha)
        ) {
            fail('historical admission requires same-repository open author pull requests');
        }
    }
    if (child.events.length > 0 || parent.events.some((event) => event !== 'BaseRefChangedEvent')) {
        fail('historical ref has retargeting, reuse or lifecycle ambiguity');
    }
}

function historicalCreationAnchor(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation,
    childLog: string,
    parentLog: string,
    parentLocalHead: string,
    port: HistoricalAdmissionPort
): NativeRefEntry {
    const { child, parent } = observation;
    const children = nativeRefHistory(childLog, port);
    const parents = nativeRefHistory(parentLog, port);
    const birth = children[0];
    if (
        birth === undefined ||
        children.at(-1)?.head !== input.expectedHead ||
        parents.at(-1)?.head !== parentLocalHead
    ) {
        fail('native branch head changed or history incomplete');
    }
    const parentCreated = Date.parse(parent.createdAt) / 1000;
    const childCreated = Date.parse(child.createdAt) / 1000;
    if (
        !Number.isFinite(parentCreated) ||
        !Number.isFinite(childCreated) ||
        !(parentCreated < birth.time && birth.time < childCreated)
    ) {
        fail('parent identity did not precede native child creation');
    }
    if (parents.some((entry) => entry.time === birth.time)) {
        fail('ambiguous native creation timestamp');
    }
    const atBirth = parents.findLast((entry) => entry.time < birth.time);
    if (
        atBirth?.head !== birth.head ||
        !port.isAncestor(birth.head, child.headSha) ||
        !port.isAncestor(birth.head, parent.headSha) ||
        !port.isAncestor(parentLocalHead, parent.headSha)
    ) {
        fail('native original parent did not hold the creation anchor');
    }
    return birth;
}

export function historicalDescriptor(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation,
    childLog: string,
    parentLog: string,
    parentLocalHead: string,
    port: HistoricalAdmissionPort
): LaneStack {
    assertOriginalHistoricalParent(input, observation);
    assertHistoricalActorsAndLifecycle(observation);
    const birth = historicalCreationAnchor(input, observation, childLog, parentLog, parentLocalHead, port);
    const { child, parent } = observation;
    return parseLaneStack({
        version: 1,
        childBranch: child.branch,
        parentBranch: parent.branch,
        forkHead: birth.head,
        parentHead: parent.headSha,
        parentPullRequest: parent.number,
    });
}
