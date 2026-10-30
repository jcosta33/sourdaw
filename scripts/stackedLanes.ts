import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY } from './githubAppIdentity.ts';
import {
    readLaneStackForkMarkers,
    assertOriginalHistoricalParent,
    assertHistoricalActorsAndLifecycle,
    historicalCreationAnchor,
    historicalRecord as object,
    historicalTextField as textField,
    type GitConfigReader,
    type HistoricalClosedParent,
    type HistoricalPullRequest,
    type HistoricalStackObservation,
    type HistoricalAdmissionInput,
} from './laneStackForkMarkers.ts';
import { fail, isLaneBranch, PR_STATE, type PullRequestState } from './prContract.ts';

export { readLaneStackForkMarkers } from './laneStackForkMarkers.ts';
export type {
    HistoricalClosedParent,
    HistoricalPullRequest,
    HistoricalStackObservation,
    HistoricalAdmissionInput,
} from './laneStackForkMarkers.ts';

export type LaneStack = {
    version: 1;
    childBranch: string;
    parentBranch: string;
    forkHead: string;
    parentHead: string;
    parentPullRequest?: number;
};

type HistoricalAdmissionIdentity = {
    childPullRequest: number;
    expectedChildHead: string;
    descriptor: LaneStack;
};

export type HistoricalAdmissionReceipt = HistoricalAdmissionIdentity &
    ({ version: 1 } | { version: 2; closedParent: HistoricalClosedParent & { proof: string } });

function parseHistoricalClosedReceipt(
    value: unknown,
    childPullRequest: number,
    parentPullRequest: number
): HistoricalClosedParent & { proof: string } {
    const closed = value;
    if (closed === null || typeof closed !== 'object' || Array.isArray(closed)) {
        fail('invalid historical closed parent receipt');
    }
    const proof = closed as Record<string, unknown>;
    if (
        Object.keys(proof).sort().join(',') !== 'parentOriginMain,proof,replacementPullRequest' ||
        typeof proof.replacementPullRequest !== 'number' ||
        !Number.isSafeInteger(proof.replacementPullRequest) ||
        proof.replacementPullRequest <= 0 ||
        [parentPullRequest, childPullRequest].includes(proof.replacementPullRequest) ||
        typeof proof.parentOriginMain !== 'boolean' ||
        typeof proof.proof !== 'string' ||
        proof.proof === '' ||
        Buffer.byteLength(proof.proof, 'utf8') > 32768
    ) {
        fail('invalid historical closed parent receipt');
    }
    return {
        replacementPullRequest: proof.replacementPullRequest,
        parentOriginMain: proof.parentOriginMain,
        proof: proof.proof,
    };
}

export function parseHistoricalAdmissionReceipt(value: unknown): HistoricalAdmissionReceipt {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid historical admission receipt');
    }
    const row = value as Record<string, unknown>;
    if (
        Object.keys(row).sort().join(',') !==
            (row.version === 2
                ? 'childPullRequest,closedParent,descriptor,expectedChildHead,version'
                : 'childPullRequest,descriptor,expectedChildHead,version') ||
        (row.version !== 1 && row.version !== 2) ||
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
    const identity = {
        childPullRequest: row.childPullRequest,
        expectedChildHead: row.expectedChildHead,
        descriptor,
    };
    if (row.version === 2) {
        return {
            version: 2,
            ...identity,
            closedParent: parseHistoricalClosedReceipt(
                row.closedParent,
                row.childPullRequest,
                descriptor.parentPullRequest
            ),
        };
    }
    return { version: 1, ...identity };
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
    git: GitConfigReader
): LaneStack | undefined {
    const forkMarkers = readLaneStackForkMarkers(branch, git);
    if (forkMarkers.length > 1) {
        fail('branch lineage marker must have exactly one value');
    }
    const forkMarker = forkMarkers[0] ?? '';
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

export function historicalDescriptor(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation,
    childLog: string,
    parentLog: string,
    parentLocalHead: string,
    port: HistoricalAdmissionPort
): LaneStack {
    assertOriginalHistoricalParent(input, observation);
    assertHistoricalActorsAndLifecycle(input, observation);
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

export function descriptorForHistoricalReplay(
    input: HistoricalAdmissionInput,
    descriptor: LaneStack,
    prior: HistoricalAdmissionReceipt | undefined,
    stored: LaneStack | undefined,
    initialMarkers: string[],
    port: HistoricalAdmissionPort
): LaneStack {
    const unjournaledMarker = initialMarkers.length > 0 && input.legacyFork === undefined;
    if (prior === undefined && (stored !== undefined || unjournaledMarker)) {
        fail('historical admission refuses unjournaled partial or existing lineage');
    }
    if (prior !== undefined) {
        const receipt = parseHistoricalAdmissionReceipt(prior);
        if (
            receipt.childPullRequest !== input.childPullRequest ||
            receipt.expectedChildHead !== input.expectedHead ||
            JSON.stringify({ ...receipt.descriptor, parentHead: descriptor.parentHead }) !==
                JSON.stringify(descriptor) ||
            !port.isAncestor(receipt.descriptor.parentHead, descriptor.parentHead)
        ) {
            fail('historical admission receipt conflicts with original identity');
        }
        return receipt.descriptor;
    }
    return descriptor;
}

export function historicalRegisteredDescriptor(
    admitted: LaneStack,
    stored: LaneStack | undefined,
    markers: string[],
    currentParentHead: string,
    childHead: string,
    port: HistoricalAdmissionPort
): LaneStack {
    if (
        markers.length > 1 ||
        (markers.length === 1 && markers[0] !== admitted.forkHead) ||
        (stored !== undefined &&
            (markers.length !== 1 ||
                JSON.stringify({ ...stored, parentHead: admitted.parentHead }) !== JSON.stringify(admitted)))
    ) {
        fail('historical admission has conflicting descriptor or marker');
    }
    if (stored === undefined) {
        return admitted;
    }
    if (
        !port.isAncestor(admitted.parentHead, stored.parentHead) ||
        !port.isAncestor(stored.parentHead, currentParentHead) ||
        (stored.parentHead !== admitted.parentHead && !port.isAncestor(stored.parentHead, childHead))
    ) {
        fail('historical admission descriptor progress conflicts with verified histories');
    }
    return stored;
}

export function parseHistoricalPullRequest(value: unknown, closedMode = false): HistoricalPullRequest {
    const row = object(value);
    const repo = object(row.repository);
    const headRepo = object(row.headRepository);
    const ref = object(row.headRef);
    const base = object(row.baseRef);
    const timeline = object(row.timelineItems);
    if (object(timeline.pageInfo).hasNextPage !== false || !Array.isArray(timeline.nodes)) {
        fail('incomplete historical timeline');
    }
    const headSha = textField(row, 'headRefOid');
    const branch = textField(row, 'headRefName');
    const baseBranch = textField(row, 'baseRefName');
    if (
        !fullSha.test(headSha) ||
        ref.name !== branch ||
        object(ref.target).oid !== headSha ||
        base.name !== baseBranch ||
        typeof row.number !== 'number' ||
        !Number.isSafeInteger(row.number) ||
        row.number <= 0
    ) {
        fail('historical ref identity changed');
    }
    const pr: HistoricalPullRequest = {
        number: row.number,
        id: textField(row, 'id'),
        branch,
        headSha,
        baseBranch,
        createdAt: textField(row, 'createdAt'),
        repository: textField(repo, 'nameWithOwner'),
        repositoryId: textField(repo, 'id'),
        headRepository: textField(headRepo, 'nameWithOwner'),
        headRepositoryId: textField(headRepo, 'id'),
        authorId: textField(object(row.author), 'id'),
        state: textField(row, 'state'),
        events: timeline.nodes.map((event) => textField(object(event), '__typename')),
    };
    if (closedMode) {
        if (typeof row.merged !== 'boolean' || (row.closedAt !== null && typeof row.closedAt !== 'string')) {
            fail('incomplete historical closure identity');
        }
        pr.merged = row.merged;
        pr.closedAt = row.closedAt;
        pr.baseRefOid = textField(row, 'baseRefOid');
        pr.closures = timeline.nodes
            .filter((event) => object(event).__typename === 'ClosedEvent')
            .map((event) => {
                const closed = object(event);
                return {
                    id: textField(closed, 'id'),
                    createdAt: textField(closed, 'createdAt'),
                    authorId: textField(object(closed.actor), 'id'),
                };
            });
    }
    return pr;
}

export function parseHistoricalStackObservation(
    raw: string,
    children: StackParent[],
    parents: StackParent[],
    closedMode = false
): HistoricalStackObservation {
    const response = object(JSON.parse(raw));
    if (response.errors !== undefined) {
        fail('historical stack query returned errors');
    }
    const repository = object(object(response.data).repository);
    const child = parseHistoricalPullRequest(repository.child, closedMode);
    const parent = parseHistoricalPullRequest(repository.parent, closedMode);
    assertHistoricalPullRequestCandidates(child, children);
    assertHistoricalPullRequestCandidates(parent, parents);
    if (
        object(object(repository.child).baseRef).target === null ||
        object(object(object(repository.child).baseRef).target).oid !== parent.headSha
    ) {
        fail('historical parent ref changed');
    }
    return {
        child,
        parent,
        childPullRequests: children.map((pr) => pr.number),
        parentPullRequests: parents.map((pr) => pr.number),
    };
}

export function historicalStackQuery(child: number, parent: number, closedMode = false): string[] {
    const closure = closedMode
        ? '... on ClosedEvent { id createdAt actor { ... on Bot { id } ... on User { id } } }'
        : '';
    const fields = `id number createdAt state ${closedMode ? 'merged closedAt baseRefOid' : ''} author { ... on Bot { id } ... on User { id } } repository { id nameWithOwner } headRepository { id nameWithOwner } headRefName headRefOid headRef { name target { oid } } baseRefName baseRef { name target { oid } } timelineItems(first:100,itemTypes:[BASE_REF_CHANGED_EVENT,HEAD_REF_FORCE_PUSHED_EVENT,HEAD_REF_DELETED_EVENT,HEAD_REF_RESTORED_EVENT,CLOSED_EVENT,REOPENED_EVENT]) { pageInfo { hasNextPage } nodes { __typename ${closure} } }`;
    return [
        'api',
        'graphql',
        '-f',
        `query=query { repository(owner:"${REQUIRED_REPOSITORY.split('/')[0]}",name:"${REQUIRED_REPOSITORY.split('/')[1]}") { child:pullRequest(number:${child}) { ${fields} } parent:pullRequest(number:${parent}) { ${fields} } } }`,
    ];
}
