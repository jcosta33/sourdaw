#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
    accessSync,
    constants,
    closeSync,
    linkSync,
    mkdirSync,
    openSync,
    readFileSync,
    readSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    assertTrustedExecutingBlob,
    authenticateRole,
    AUTHOR_BOT_NODE_ID,
    GITHUB_HTTPS_REMOTE,
    gitAuthenticatedArgs,
    githubAuthorizationGitEnv,
    originMainBlob,
    spawnCapture,
    spawnRun,
    REQUIRED_REPOSITORY,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail, PR_STATE } from './prContract.ts';
import { isAncestorCommit, parsePublishWorktrees, resolveAuthorLane, trustedPublishRuntime } from './publishLane.ts';
import {
    assertHistoricalPullRequestCandidates,
    assertStackAcyclic,
    descriptorForHistoricalReplay,
    historicalDescriptor,
    historicalRegisteredDescriptor,
    laneStackPath,
    parseStackParents,
    readLaneStackForkMarkers,
    readLaneStack,
    readHistoricalAdmissionReceipt,
    readRegisteredLaneStack,
    resolveStackParent,
    stackParentCandidates,
    stackParentQuery,
    writeLaneStack,
    type HistoricalAdmissionInput,
    type HistoricalAdmissionPort,
    type HistoricalPullRequest,
    type HistoricalStackObservation,
    type LaneStack,
    type HistoricalAdmissionReceipt,
    type StackReadPort,
    type StackParent,
} from './stackedLanes.ts';

export type {
    HistoricalAdmissionInput,
    HistoricalAdmissionPort,
    HistoricalAdmissionReceipt,
    HistoricalStackObservation,
} from './stackedLanes.ts';

// @see ../.agents/skills/delivery-orchestration/historical-stack-admission.md
export const SYNC_PARENT_USAGE =
    'usage: pnpm lane:sync-parent --lane <absolute-child-lane> [--admit-historical --child-pr <number> --parent-pr <number> --expected-head <sha> [--legacy-fork <sha> | --superseded-parent-replacement <number> [--parent-origin-main]]]';

const fullSha = /^[0-9a-f]{40}$/;

function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('incomplete historical stack proof');
    }
    return value as Record<string, unknown>;
}

function textField(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (typeof value !== 'string' || value.trim() !== value || value === '') {
        fail(`invalid historical ${key}`);
    }
    return value;
}

function parseHistoricalPullRequest(value: unknown, closedMode = false): HistoricalPullRequest {
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

function historicalStackQuery(child: number, parent: number, closedMode = false): string[] {
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

function assertLegacyFork(input: HistoricalAdmissionInput, descriptor: LaneStack, markers: string[]): void {
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

export function admitHistoricalStack(input: HistoricalAdmissionInput, port: HistoricalAdmissionPort): LaneStack {
    if (!port.clean() || port.head() !== input.expectedHead) {
        fail('historical child is dirty, foreign or changed');
    }
    const observation = port.observe();
    const childLog = port.childLog();
    const parentLog = port.parentLog();
    const parentHead = port.parentLocalHead();
    let descriptor = historicalDescriptor(input, observation, childLog, parentLog, parentHead, port);
    const currentParentHead = descriptor.parentHead;
    const prior = port.readReceipt();
    if (input.closedParent !== undefined) {
        if (
            observation.closedParentCompletion === undefined ||
            (prior !== undefined &&
                (prior.version !== 2 ||
                    JSON.stringify(prior.closedParent) !==
                        JSON.stringify({ ...input.closedParent, proof: observation.closedParentCompletion })))
        ) {
            fail('historical closed parent admission proof or flags changed');
        }
    } else if (prior?.version === 2) {
        fail('historical closed parent admission requires the exact original flags');
    }
    const stored = port.readDescriptor();
    const initialMarkers = port.markers();
    assertLegacyFork(input, descriptor, initialMarkers);
    let receiptSnapshot = JSON.stringify(prior);
    let markerSnapshot = JSON.stringify(initialMarkers);
    let descriptorSnapshot = JSON.stringify(stored);
    descriptor = descriptorForHistoricalReplay(input, descriptor, prior, stored, initialMarkers, port);
    const registered = historicalRegisteredDescriptor(
        descriptor,
        stored,
        initialMarkers,
        currentParentHead,
        input.expectedHead,
        port
    );
    assertStackAcyclic(descriptor, port.readStack);
    const revalidate = () => {
        if (
            !port.clean() ||
            port.head() !== input.expectedHead ||
            JSON.stringify(port.observe()) !== JSON.stringify(observation) ||
            port.childLog() !== childLog ||
            port.parentLog() !== parentLog ||
            port.parentLocalHead() !== parentHead ||
            JSON.stringify(port.readReceipt()) !== receiptSnapshot ||
            JSON.stringify(port.markers()) !== markerSnapshot ||
            JSON.stringify(port.readDescriptor()) !== descriptorSnapshot
        ) {
            fail('historical stack proof changed during admission');
        }
        assertStackAcyclic(descriptor, port.readStack);
    };
    const identity = {
        childPullRequest: input.childPullRequest,
        expectedChildHead: input.expectedHead,
        descriptor,
    };
    const receipt: HistoricalAdmissionReceipt =
        input.closedParent === undefined
            ? { version: 1, ...identity }
            : {
                  version: 2,
                  ...identity,
                  closedParent: {
                      ...input.closedParent,
                      proof: observation.closedParentCompletion ?? fail('native parent completion is missing'),
                  },
              };
    if (Buffer.byteLength(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8') > 65536) {
        fail('historical admission receipt exceeds bound');
    }
    revalidate();
    if (prior === undefined) {
        port.saveReceipt(receipt);
    }
    receiptSnapshot = JSON.stringify(receipt);
    if (JSON.stringify(port.readReceipt()) !== JSON.stringify(receipt)) {
        fail('historical admission receipt changed');
    }
    revalidate();
    if (input.legacyFork === undefined && port.markers().length === 0) {
        port.addMarker(descriptor.forkHead);
    }
    markerSnapshot = JSON.stringify([descriptor.forkHead]);
    if (JSON.stringify(port.markers()) !== JSON.stringify([descriptor.forkHead])) {
        fail('historical admission marker changed');
    }
    revalidate();
    if (
        JSON.stringify(port.readReceipt()) !== JSON.stringify(receipt) ||
        JSON.stringify(port.markers()) !== JSON.stringify([descriptor.forkHead])
    ) {
        fail('historical admission records changed');
    }
    const current = port.readDescriptor();
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(registered)) {
        fail('historical admission descriptor changed');
    }
    // The descriptor is the commit point: marker-only crashes are refused by every ordinary reader.
    if (current === undefined) {
        port.installDescriptor(registered);
    }
    if (
        JSON.stringify(port.readDescriptor()) !== JSON.stringify(registered) ||
        JSON.stringify(port.readReceipt()) !== JSON.stringify(receipt) ||
        JSON.stringify(port.markers()) !== JSON.stringify([descriptor.forkHead])
    ) {
        fail('historical descriptor installation failed');
    }
    descriptorSnapshot = JSON.stringify(registered);
    revalidate();
    // Return the immutable admission; synchronization owns later registered parent-head progress.
    return descriptor;
}

function installExclusiveJson(path: string, value: unknown): void {
    mkdirSync(join(path, '..'), { recursive: true });
    const raw = `${JSON.stringify(value, null, 2)}\n`;
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, raw, { flag: 'wx', mode: 0o600 });
    try {
        linkSync(temporary, path);
    } catch (error) {
        if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'EEXIST' ||
            readFileSync(path, 'utf8') !== raw
        ) {
            throw error;
        }
    }
}

function parseHistoricalAdmissionArgs(args: string[]): Omit<HistoricalAdmissionInput, 'branch'> {
    const child = args[4];
    const parent = args[6];
    const head = args[8];
    const closedMode = args[9] === '--superseded-parent-replacement';
    const legacyFork = closedMode ? undefined : args[10];
    if (
        args.length > 9 &&
        !closedMode &&
        (args.length !== 11 || args[9] !== '--legacy-fork' || legacyFork === undefined || !fullSha.test(legacyFork))
    ) {
        fail(SYNC_PARENT_USAGE);
    }
    if (
        child === undefined ||
        parent === undefined ||
        !/^[1-9][0-9]*$/.test(child) ||
        !/^[1-9][0-9]*$/.test(parent) ||
        !Number.isSafeInteger(Number(child)) ||
        !Number.isSafeInteger(Number(parent)) ||
        child === parent ||
        head === undefined ||
        !fullSha.test(head)
    ) {
        fail(SYNC_PARENT_USAGE);
    }
    const admission: Omit<HistoricalAdmissionInput, 'branch'> = {
        childPullRequest: Number(child),
        parentPullRequest: Number(parent),
        expectedHead: head,
    };
    if (legacyFork !== undefined) {
        admission.legacyFork = legacyFork;
    }
    if (closedMode) {
        const replacement = args[10];
        if (
            (args.length !== 11 && args.length !== 12) ||
            (args.length === 12 && args[11] !== '--parent-origin-main') ||
            !/^[1-9][0-9]*$/.test(replacement ?? '') ||
            !Number.isSafeInteger(Number(replacement)) ||
            replacement === child ||
            replacement === parent
        ) {
            fail(SYNC_PARENT_USAGE);
        }
        admission.closedParent = { replacementPullRequest: Number(replacement), parentOriginMain: args.length === 12 };
    }
    return admission;
}

export function parseSyncParentArgs(args: string[]): {
    lane: string;
    admission?: Omit<HistoricalAdmissionInput, 'branch'>;
} {
    const lane = args[1];
    if (args[0] !== '--lane' || lane === undefined || !isAbsolute(lane)) {
        fail(SYNC_PARENT_USAGE);
    }
    if (args.length === 2) {
        return { lane };
    }
    if (
        (args.length !== 9 && args.length !== 11 && args.length !== 12) ||
        args[2] !== '--admit-historical' ||
        args[3] !== '--child-pr' ||
        args[5] !== '--parent-pr' ||
        args[7] !== '--expected-head'
    ) {
        fail(SYNC_PARENT_USAGE);
    }
    return { lane, admission: parseHistoricalAdmissionArgs(args) };
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
    const row = object(JSON.parse(proof));
    if (
        JSON.stringify(row) !== proof ||
        Object.keys(row).sort().join(',') !== 'findingIds,lineage,parent,receipt,replacement,sourceCommit,version' ||
        row.version !== 1 ||
        row.sourceCommit !== sourceCommit
    ) {
        fail('native parent completion wire or source changed');
    }
    const expectedCoreKeys =
        'base,baseRefOid,closedAt,head,headRefName,headRepository,mergeCommit,merged,number,repository,state';
    const original = object(row.parent);
    const successor = object(row.replacement);
    for (const core of [original, successor]) {
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
        original.baseRefOid !== parent.baseRefOid ||
        successor.number !== replacement ||
        successor.state !== PR_STATE.MERGED ||
        successor.merged !== true ||
        successor.base !== 'main' ||
        typeof successor.mergeCommit !== 'string' ||
        !fullSha.test(successor.mergeCommit)
    ) {
        fail('native parent completion does not match historical identities');
    }
    for (const value of [row.receipt, row.lineage]) {
        const marker = object(value);
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
    if (
        !Array.isArray(row.findingIds) ||
        row.findingIds.some((id) => typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id)) ||
        new Set(row.findingIds).size !== row.findingIds.length
    ) {
        fail('invalid native parent completion root envelope');
    }
    return proof;
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
    env.PATH = [...new Set([dirname(input.gitPath), dirname(input.ghPath), dirname(process.execPath), '/bin'])].join(
        delimiter
    );
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

export function historicalAdmissionShellPort(
    input: Parameters<typeof syncParentShellPort>[0],
    admission: Omit<HistoricalAdmissionInput, 'branch'>
): HistoricalAdmissionPort {
    const { lane, branch, primaryRoot, gitPath, ghPath, session, localEnv } = input;
    const capture = input.capture ?? spawnCapture;
    const run = input.run ?? spawnRun;
    const local = (args: string[]) => capture(gitPath, args, { cwd: lane, env: localEnv });
    const base = syncParentShellPort(input);
    const key = `branch.${branch}.sourdaw-stack-fork`;
    const queriedHeads = new Set<string>();
    let parentBranch: string | undefined;
    const requiredParentBranch = () => {
        if (parentBranch === undefined) {
            fail('historical parent proof must precede native history reads');
        }
        return parentBranch;
    };
    const nativeLog = (ref: string) => {
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
    };
    const readDescriptor = () => readLaneStack(primaryRoot, branch);
    return {
        head: base.head,
        clean: base.clean,
        isAncestor: base.isAncestor,
        observe: () => {
            const closedMode = admission.closedParent !== undefined;
            const query = historicalStackQuery(admission.childPullRequest, admission.parentPullRequest, closedMode);
            const raw = capture(ghPath, query, {
                cwd: primaryRoot,
                env: session.env,
            });
            const repository = object(object(object(JSON.parse(raw)).data).repository);
            const parent = parseHistoricalPullRequest(repository.parent, closedMode);
            parentBranch = parent.branch;
            const children = parseStackParents(
                capture(ghPath, stackParentQuery(branch), { cwd: primaryRoot, env: session.env })
            );
            const parents = parseStackParents(
                capture(ghPath, stackParentQuery(parent.branch), { cwd: primaryRoot, env: session.env })
            );
            const observation = parseHistoricalStackObservation(raw, children, parents, closedMode);
            if (admission.closedParent !== undefined) {
                const invocation = nativeParentInspectionInvocation(input, admission.closedParent, parent);
                const completion = capture(invocation.command, invocation.args, {
                    cwd: invocation.cwd,
                    env: invocation.env,
                    trim: false,
                });
                observation.closedParentCompletion = checkedNativeParentCompletion(
                    completion,
                    parent,
                    admission.closedParent.replacementPullRequest,
                    input.originCommit ?? fail('native admission source pin is missing')
                );
                // A child mutation while the independent parent process reads must not inherit its earlier snapshot.
                const final = object(JSON.parse(capture(ghPath, query, { cwd: primaryRoot, env: session.env })));
                if (final.errors !== undefined) {
                    fail('historical final child query returned errors');
                }
                const terminal = parseHistoricalStackObservation(JSON.stringify(final), children, parents, true);
                if (
                    JSON.stringify(terminal.child) !== JSON.stringify(observation.child) ||
                    JSON.stringify(terminal.parent) !== JSON.stringify(observation.parent)
                ) {
                    fail('historical child changed during native parent inspection');
                }
            }
            if (!queriedHeads.has(parent.headSha)) {
                base.fetchParent(parent.branch, parent.headSha);
                queriedHeads.add(parent.headSha);
            }
            return observation;
        },
        childLog: () => nativeLog(branch),
        parentLog: () => nativeLog(requiredParentBranch()),
        parentLocalHead: () => local(['rev-parse', '--verify', `refs/heads/${requiredParentBranch()}^{commit}`]),
        readDescriptor,
        readReceipt: () => readHistoricalAdmissionReceipt(primaryRoot, branch),
        markers: () => readLaneStackForkMarkers(branch, local),
        saveReceipt: (receipt) => installExclusiveJson(`${laneStackPath(primaryRoot, branch)}.admission.json`, receipt),
        // Matching resumptions replace only their exact value; foreign values and duplicates remain visible.
        addMarker: (fork) => run(gitPath, ['config', '--fixed-value', key, fork, fork], { cwd: lane, env: localEnv }),
        installDescriptor: (descriptor) => installExclusiveJson(laneStackPath(primaryRoot, branch), descriptor),
        readStack: (ref) => readRegisteredLaneStack(primaryRoot, ref, local),
    };
}

export type SyncParentPort = StackReadPort & {
    head: () => string;
    clean: () => boolean;
    main: () => string;
    fetchParent: (branch: string, head: string) => void;
    merge: (head: string) => void;
    conflicts: () => string[];
    save: (descriptor: LaneStack) => void;
};

function assertParentUnchanged(descriptor: LaneStack, parent: StackParent, port: StackReadPort): void {
    const currentParent = resolveStackParent(descriptor, port);
    if (JSON.stringify(currentParent) !== JSON.stringify(parent)) {
        fail('stack parent changed during synchronization');
    }
}

function mergeStackTarget(target: string, previousHead: string, port: SyncParentPort): string {
    try {
        if (!port.isAncestor(target, previousHead)) {
            port.merge(target);
        }
    } catch (error) {
        const conflicts = port.conflicts();
        if (conflicts.length > 0) {
            fail(
                `stack synchronization conflict; resolve and commit in this child, then rerun lane:sync-parent:\n${conflicts.join('\n')}`
            );
        }
        throw error;
    }
    const head = port.head();
    if (!port.isAncestor(previousHead, head) || !port.isAncestor(target, head) || !port.clean()) {
        fail('stack synchronization did not preserve the child and parent histories');
    }
    return head;
}

export function syncParentLane(descriptor: LaneStack, port: SyncParentPort): string {
    if (!port.clean()) {
        fail('stack child has uncommitted changes; resolve and commit before synchronizing');
    }
    const previousHead = port.head();
    if (!port.isAncestor(descriptor.forkHead, previousHead)) {
        fail('stack child no longer contains its fork head');
    }
    const parents = port.parents(descriptor.parentBranch);
    for (const candidate of stackParentCandidates(descriptor, parents)) {
        port.fetchParent(candidate.branch, candidate.headSha);
    }
    const parent = resolveStackParent(descriptor, { ...port, parents: () => parents });
    const pinned = { ...descriptor, parentPullRequest: parent.number };
    // Persist the PR identity before a possible conflict so a retry cannot adopt a reused branch.
    port.save(pinned);
    const targets = [parent.headSha];
    if (parent.state === PR_STATE.MERGED) {
        const main = port.main();
        if (parent.mergeCommit === undefined || !port.isAncestor(parent.mergeCommit, main)) {
            fail('stack parent landed commit is not on main');
        }
        // A squash omits parent ancestry: merge its final history first so later parent deletions
        // and reversions cannot survive as apparent child changes when main is merged.
        // Establish the squash baseline before later main edits or reversions are applied.
        targets.push(parent.mergeCommit, main);
    }
    let head = previousHead;
    for (const target of targets) {
        assertParentUnchanged(pinned, parent, port);
        if (port.head() !== head || !port.clean()) {
            fail('stack child changed before synchronization');
        }
        head = mergeStackTarget(target, head, port);
    }
    assertParentUnchanged(pinned, parent, port);
    port.save({ ...pinned, parentHead: parent.headSha });
    return head;
}

export function syncParentShellPort(input: {
    lane: string;
    branch: string;
    primaryRoot: string;
    gitPath: string;
    ghPath: string;
    session: GhSession;
    localEnv: NodeJS.ProcessEnv;
    capture?: typeof spawnCapture;
    run?: typeof spawnRun;
    originCommit?: string;
}): SyncParentPort {
    const { lane, primaryRoot, gitPath, ghPath, session, localEnv } = input;
    const capture = input.capture ?? spawnCapture;
    const run = input.run ?? spawnRun;
    const local = (args: string[]) => capture(gitPath, args, { cwd: lane, env: localEnv });
    const fetch = (ref: string) =>
        run(
            gitPath,
            gitAuthenticatedArgs(session.env.GH_TOKEN ?? '', session.configDir, ['fetch', GITHUB_HTTPS_REMOTE, ref]),
            { cwd: primaryRoot, env: session.env }
        );
    const disabledHooks = join(session.configDir, 'disabled-hooks');
    mkdirSync(disabledHooks, { recursive: true });
    return {
        head: () => local(['rev-parse', '--verify', 'HEAD^{commit}']),
        clean: () => {
            const trees = parsePublishWorktrees(
                capture(gitPath, ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot, env: localEnv })
            );
            const selected = resolveAuthorLane(undefined, trees, lane);
            if (selected.branch !== input.branch || realpathSync(selected.path) !== realpathSync(lane)) {
                fail('stack child ownership changed during synchronization');
            }
            return local(['status', '--porcelain=v1', '--untracked-files=all']) === '';
        },
        main: () => {
            fetch('+refs/heads/main:refs/remotes/origin/main');
            return local(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
        },
        parents: (branch) =>
            parseStackParents(capture(ghPath, stackParentQuery(branch), { cwd: primaryRoot, env: session.env })),
        isAncestor: (ancestor, descendant) => isAncestorCommit(lane, ancestor, descendant, localEnv, gitPath),
        fetchParent: (_branch, expectedHead) => {
            fetch(expectedHead);
            const fetched = capture(gitPath, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], {
                cwd: primaryRoot,
                env: localEnv,
            });
            if (fetched !== expectedHead) {
                fail('stack parent moved during fetch');
            }
        },
        merge: (target) =>
            run(gitPath, ['-c', `core.hooksPath=${disabledHooks}`, 'merge', '--no-edit', '--no-ff', target], {
                cwd: lane,
                env: localEnv,
            }),
        conflicts: () => local(['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean),
        save: (next) => writeLaneStack(primaryRoot, next),
    };
}

export async function runSyncParentCli(args: string[]): Promise<number> {
    if (args.length === 1 && args[0] === '--help') {
        console.log(SYNC_PARENT_USAGE);
        return 0;
    }
    const parsed = parseSyncParentArgs(args);
    const lanePath = parsed.lane;
    const runtime = trustedPublishRuntime();
    if (realpathSync(process.cwd()) !== realpathSync(runtime.primaryRoot)) {
        fail('lane:sync-parent requires the protected primary checkout');
    }
    const env = githubAuthorizationGitEnv();
    assertTrustedExecutingBlob(
        'scripts/syncParentLane.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/syncParentLane.ts', runtime.primaryRoot, env, runtime.gitPath, runtime.originCommit)
    );
    const trees = parsePublishWorktrees(
        spawnCapture(runtime.gitPath, ['worktree', 'list', '--porcelain', '-z'], { cwd: runtime.primaryRoot, env })
    );
    const lane = resolveAuthorLane(undefined, trees, lanePath);
    if (lane.legacy || realpathSync(lane.path) !== realpathSync(lanePath)) {
        fail('--lane must name the exact conforming author child root');
    }
    const local = (commandArgs: string[]) => spawnCapture(runtime.gitPath, commandArgs, { cwd: lane.path, env });
    const descriptor =
        parsed.admission === undefined ? readRegisteredLaneStack(runtime.primaryRoot, lane.branch, local) : undefined;
    if (parsed.admission === undefined && descriptor === undefined) {
        fail('lane has no recorded parent');
    }
    if (descriptor !== undefined) {
        assertStackAcyclic(descriptor, (branch) => readLaneStack(runtime.primaryRoot, branch));
    }
    if (local(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
        fail('stack child has uncommitted changes');
    }
    const auth = await authenticateRole({ primaryRoot: runtime.primaryRoot, role: 'author' });
    try {
        const shell = {
            lane: lane.path,
            branch: lane.branch,
            primaryRoot: runtime.primaryRoot,
            gitPath: runtime.gitPath,
            ghPath: runtime.ghPath,
            session: auth.session,
            localEnv: env,
            originCommit: runtime.originCommit,
        };
        if (parsed.admission !== undefined) {
            admitHistoricalStack(
                { ...parsed.admission, branch: lane.branch },
                historicalAdmissionShellPort(shell, parsed.admission)
            );
            console.log(
                parsed.admission.closedParent === undefined
                    ? `admitted historical parent for ${lane.branch}; synchronize through lane:sync-parent --lane ${lane.path}`
                    : `admitted historical superseded parent for ${lane.branch}; original parent retained`
            );
            return 0;
        }
        if (descriptor === undefined) {
            fail('lane has no recorded parent');
        }
        const head = syncParentLane(descriptor, syncParentShellPort(shell));
        console.log(`synchronized ${lane.branch} at ${head}; publish through lane:publish`);
        return 0;
    } finally {
        auth.session.dispose();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void runSyncParentCli(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
