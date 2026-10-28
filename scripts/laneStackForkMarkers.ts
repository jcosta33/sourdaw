import { accessSync, constants, closeSync, openSync, readSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
    githubAuthorizationGitEnv,
} from './githubAppIdentity.ts';
import { fail, PR_STATE } from './prContract.ts';

export type GitConfigReader = (args: string[]) => string;

export function readLaneStackForkMarkers(branch: string, git: GitConfigReader): string[] {
    const key = `branch.${branch}.sourdaw-stack-fork`;
    const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A scalar config read hides earlier values. Include the repository-format key so absence is a successful read.
    return git(['config', '--null', '--get-regexp', `^(core\\.repositoryformatversion|${escaped})$`])
        .split('\0')
        .filter((entry) => entry.startsWith(`${key}\n`))
        .map((entry) => entry.slice(key.length + 1));
}

export type HistoricalClosedParent = { replacementPullRequest: number; parentOriginMain: boolean };
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
    closedAt?: string | null;
    merged?: boolean;
    baseRefOid?: string;
    closures?: Array<{ id: string; createdAt: string; authorId: string }>;
};

export type HistoricalStackObservation = {
    child: HistoricalPullRequest;
    parent: HistoricalPullRequest;
    childPullRequests: number[];
    parentPullRequests: number[];
    closedParentCompletion?: string;
};

export type HistoricalAdmissionInput = {
    childPullRequest: number;
    parentPullRequest: number;
    expectedHead: string;
    branch: string;
    legacyFork?: string;
    closedParent?: HistoricalClosedParent;
};

type NativeHistoryPort = { isAncestor: (ancestor: string, descendant: string) => boolean };

const fullSha = /^[0-9a-f]{40}$/;

export function historicalRecord(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('incomplete historical stack proof');
    }
    return value as Record<string, unknown>;
}

export function historicalTextField(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (typeof value !== 'string' || value.trim() !== value || value === '') {
        fail(`invalid historical ${key}`);
    }
    return value;
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
    port: NativeHistoryPort
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

function nativeRefHistory(raw: string, port: NativeHistoryPort, originMain = false): NativeRefEntry[] {
    if (raw.length > 1024 * 1024 || !raw.endsWith('\n')) {
        fail('incomplete native branch history');
    }
    const lines = raw.slice(0, -1).split('\n');
    const entries: NativeRefEntry[] = [];
    for (const [index, line] of lines.entries()) {
        const { old, head, time, message } = parseNativeRefEntry(line);
        const previous = entries.at(-1);
        if (index === 0) {
            const nativeCreation =
                message === `branch: Created from ${head}` ||
                (originMain && message === 'branch: Created from origin/main');
            if (old !== '0'.repeat(40) || !nativeCreation) {
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

export function assertOriginalHistoricalParent(
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

function assertHistoricalActors(input: HistoricalAdmissionInput, observation: HistoricalStackObservation): void {
    const { child, parent } = observation;
    for (const pr of [child, parent]) {
        if (
            pr.repository !== REQUIRED_REPOSITORY ||
            pr.headRepository !== REQUIRED_REPOSITORY ||
            pr.repositoryId !== child.repositoryId ||
            pr.headRepositoryId !== child.repositoryId ||
            pr.authorId !== AUTHOR_BOT_NODE_ID ||
            pr.state !== (pr === parent && input.closedParent !== undefined ? PR_STATE.CLOSED : PR_STATE.OPEN) ||
            !fullSha.test(pr.headSha)
        ) {
            fail('historical admission requires same-repository open author pull requests');
        }
    }
}

function assertHistoricalClosedIdentity(child: HistoricalPullRequest, parent: HistoricalPullRequest): void {
    if (
        parent.baseBranch !== 'main' ||
        parent.merged !== false ||
        child.merged !== false ||
        child.closedAt !== null ||
        typeof parent.closedAt !== 'string' ||
        !Number.isFinite(Date.parse(parent.closedAt))
    ) {
        fail('historical closed parent requires an exact native main supersession');
    }
}

function assertHistoricalClosure(child: HistoricalPullRequest, parent: HistoricalPullRequest): void {
    const closure = parent.closures?.[0];
    if (
        parent.closures?.length !== 1 ||
        closure === undefined ||
        closure.authorId !== AUTHOR_BOT_NODE_ID ||
        closure.createdAt !== parent.closedAt ||
        Date.parse(closure.createdAt) <= Date.parse(child.createdAt) ||
        parent.events.filter((event) => event === 'ClosedEvent').length !== 1
    ) {
        fail('historical closed parent requires an exact native main supersession');
    }
}

function assertHistoricalClosedSelection(
    closed: HistoricalClosedParent,
    observation: HistoricalStackObservation
): void {
    if (
        observation.closedParentCompletion === undefined ||
        [observation.child.number, observation.parent.number].includes(closed.replacementPullRequest) ||
        !Number.isSafeInteger(closed.replacementPullRequest) ||
        closed.replacementPullRequest <= 0 ||
        typeof closed.parentOriginMain !== 'boolean'
    ) {
        fail('historical closed parent requires an exact native main supersession');
    }
}

export function assertHistoricalActorsAndLifecycle(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation
): void {
    assertHistoricalActors(input, observation);
    const { child, parent } = observation;
    if (input.closedParent !== undefined) {
        assertHistoricalClosedIdentity(child, parent);
        assertHistoricalClosure(child, parent);
        assertHistoricalClosedSelection(input.closedParent, observation);
    }
    if (
        child.events.length > 0 ||
        parent.events.some(
            (event) => event !== 'BaseRefChangedEvent' && !(input.closedParent !== undefined && event === 'ClosedEvent')
        )
    ) {
        fail('historical ref has retargeting, reuse or lifecycle ambiguity');
    }
}

export function historicalCreationAnchor(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation,
    childLog: string,
    parentLog: string,
    parentLocalHead: string,
    port: NativeHistoryPort
): NativeRefEntry {
    const { child, parent } = observation;
    const children = nativeRefHistory(childLog, port);
    const parents = nativeRefHistory(parentLog, port, input.closedParent?.parentOriginMain === true);
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
    assertHistoricalCachedBase(input, observation, port);
    return birth;
}

function assertHistoricalCachedBase(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation,
    port: NativeHistoryPort
): void {
    const { child, parent } = observation;
    if (
        input.closedParent !== undefined &&
        (child.baseRefOid === undefined ||
            !fullSha.test(child.baseRefOid) ||
            !port.isAncestor(child.baseRefOid, child.headSha) ||
            !port.isAncestor(child.baseRefOid, parent.headSha))
    ) {
        fail('historical cached child base is not retained in both histories');
    }
}

export function assertLegacyHistoricalFork(
    input: HistoricalAdmissionInput,
    descriptor: { forkHead: string },
    markers: string[]
): void {
    if (
        input.legacyFork !== undefined &&
        (!fullSha.test(input.legacyFork) ||
            input.legacyFork !== descriptor.forkHead ||
            markers.length !== 1 ||
            markers[0] !== input.legacyFork)
    ) {
        fail('historical legacy fork must match the proven creation anchor and sole existing marker');
    }
}

export function readNativeForkHistory(ref: string, local: GitConfigReader): string {
    const path = local(['rev-parse', '--path-format=absolute', '--git-path', `logs/refs/heads/${ref}`]);
    const descriptor = openSync(path, 'r');
    try {
        const byteLimit = 1024 * 1024;
        // The extra byte detects growth without trusting a separate path or size observation.
        const contents = Buffer.alloc(byteLimit + 1);
        let size = 0;
        while (size < contents.length) {
            const bytesRead = readSync(descriptor, contents, size, contents.length - size, size);
            if (bytesRead === 0) {
                break;
            }
            size += bytesRead;
        }
        if (size > byteLimit) {
            fail('native branch history exceeds admission bound');
        }
        return contents.subarray(0, size).toString('utf8');
    } finally {
        closeSync(descriptor);
    }
}

function assertCompletionCore(core: Record<string, unknown>): void {
    const expectedCoreKeys =
        'base,baseRefOid,closedAt,head,headRefName,headRepository,mergeCommit,merged,number,repository,state';
    if (
        Object.keys(core).sort().join(',') !== expectedCoreKeys ||
        core.repository !== REQUIRED_REPOSITORY ||
        typeof core.head !== 'string' ||
        !fullSha.test(core.head) ||
        typeof core.headRefName !== 'string' ||
        core.headRefName === '' ||
        typeof core.closedAt !== 'string' ||
        !Number.isFinite(Date.parse(core.closedAt))
    ) {
        fail('invalid native parent completion identity');
    }
}

function assertOriginalCompletion(original: Record<string, unknown>, parent: HistoricalPullRequest): void {
    if (
        original.number !== parent.number ||
        original.head !== parent.headSha ||
        original.headRefName !== parent.branch ||
        original.base !== 'main' ||
        original.state !== PR_STATE.CLOSED ||
        original.merged !== false ||
        original.mergeCommit !== null ||
        original.closedAt !== parent.closedAt ||
        original.headRepository !== parent.headRepository ||
        original.baseRefOid !== parent.baseRefOid
    ) {
        fail('native parent completion does not match historical identities');
    }
}

function assertCompletedSuccessor(successor: Record<string, unknown>, replacement: number): void {
    if (
        successor.number !== replacement ||
        successor.state !== PR_STATE.MERGED ||
        successor.merged !== true ||
        successor.base !== 'main' ||
        typeof successor.mergeCommit !== 'string' ||
        !fullSha.test(successor.mergeCommit)
    ) {
        fail('native parent completion does not match historical identities');
    }
}

function assertCompletionMarkers(row: Record<string, unknown>): void {
    for (const value of [row.receipt, row.lineage]) {
        const marker = historicalRecord(value);
        if (
            Object.keys(marker).sort().join(',') !== 'authorNodeId,authorType,body,fullDatabaseId,id' ||
            ['id', 'body', 'fullDatabaseId', 'authorNodeId', 'authorType'].some(
                (key) => typeof marker[key] !== 'string' || marker[key] === ''
            ) ||
            marker.authorNodeId !== AUTHOR_BOT_NODE_ID ||
            marker.authorType !== 'Bot'
        ) {
            fail('invalid native parent completion marker envelope');
        }
    }
}

function assertCompletionRoots(row: Record<string, unknown>): void {
    if (
        !Array.isArray(row.findingIds) ||
        row.findingIds.some((id) => typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id)) ||
        new Set(row.findingIds).size !== row.findingIds.length
    ) {
        fail('invalid native parent completion root envelope');
    }
}

/** Decode only the native wire envelope. Marker authority is decided in pr:supersede, never here. */
export function checkedNativeParentCompletion(
    raw: string,
    parent: HistoricalPullRequest,
    replacement: number,
    sourceCommit: string
): string {
    if (!raw.endsWith('\n') || Buffer.byteLength(raw, 'utf8') > 32769) {
        fail('invalid native parent completion output bound');
    }
    const proof = raw.slice(0, -1);
    const row = historicalRecord(JSON.parse(proof));
    if (
        JSON.stringify(row) !== proof ||
        Object.keys(row).sort().join(',') !== 'findingIds,lineage,parent,receipt,replacement,sourceCommit,version' ||
        row.version !== 1 ||
        row.sourceCommit !== sourceCommit
    ) {
        fail('native parent completion wire or source changed');
    }
    const original = historicalRecord(row.parent);
    const successor = historicalRecord(row.replacement);
    assertCompletionCore(original);
    assertCompletionCore(successor);
    assertOriginalCompletion(original, parent);
    assertCompletedSuccessor(successor, replacement);
    assertCompletionMarkers(row);
    assertCompletionRoots(row);
    return proof;
}

function assertNativeInspectionExecutable(name: string, expected: string, directories: readonly string[]): void {
    if (realpathSync(expected) !== expected) {
        fail(`native inspection ${name} executable is no longer the selected identity`);
    }
    let selected: string | undefined;
    for (const directory of directories) {
        const candidate = join(directory, name);
        try {
            accessSync(candidate, constants.X_OK);
            selected = realpathSync(candidate);
            break;
        } catch {
            // The native launcher also skips candidates it cannot execute or resolve.
        }
    }
    if (selected !== expected) {
        fail(`native inspection ${name} executable does not retain the selected identity`);
    }
}

export function nativeParentInspectionInvocation(
    input: { primaryRoot: string; gitPath: string; ghPath: string; localEnv: NodeJS.ProcessEnv },
    admission: NonNullable<HistoricalAdmissionInput['closedParent']>,
    parent: HistoricalPullRequest,
    platform: NodeJS.Platform = process.platform,
    systemPs: () => void = () => {
        accessSync('/bin/ps', constants.X_OK);
    }
): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
    if (platform !== 'darwin') {
        fail('closed parent native inspection is supported only on Darwin');
    }
    systemPs();
    if (
        ![input.primaryRoot, input.gitPath, input.ghPath].every(isAbsolute) ||
        !Number.isSafeInteger(parent.number) ||
        parent.number <= 0 ||
        !fullSha.test(parent.headSha) ||
        !Number.isSafeInteger(admission.replacementPullRequest) ||
        admission.replacementPullRequest <= 0
    ) {
        fail('invalid native parent inspection selection');
    }
    const env = githubAuthorizationGitEnv(input.localEnv);
    for (const key of Object.keys(env)) {
        if (key.toUpperCase().startsWith('SOURDAW_TRUSTED_')) {
            delete env[key];
        }
    }
    const directories = [
        ...new Set([dirname(input.gitPath), dirname(input.ghPath), dirname(process.execPath), '/bin']),
    ];
    env.PATH = directories.join(delimiter);
    assertNativeInspectionExecutable('git', input.gitPath, directories);
    assertNativeInspectionExecutable('gh', input.ghPath, directories);
    assertNativeInspectionExecutable('node', process.execPath, directories);
    assertNativeInspectionExecutable('ps', realpathSync('/bin/ps'), directories);
    return {
        command: process.execPath,
        cwd: input.primaryRoot,
        env,
        args: [
            join(input.primaryRoot, 'scripts/trustedGithubWriteBootstrap.ts'),
            'pr:supersede',
            '--inspect-parent-completion',
            '--parent-pr',
            String(parent.number),
            '--expected-head',
            parent.headSha,
            '--replacement',
            String(admission.replacementPullRequest),
        ],
    };
}
