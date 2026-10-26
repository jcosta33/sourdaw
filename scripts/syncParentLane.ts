#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    assertTrustedExecutingBlob,
    authenticateRole,
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
    'usage: pnpm lane:sync-parent --lane <absolute-child-lane> [--admit-historical --child-pr <number> --parent-pr <number> --expected-head <sha>]';

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

function parseHistoricalPullRequest(value: unknown): HistoricalPullRequest {
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
    return {
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
}

export function parseHistoricalStackObservation(
    raw: string,
    children: StackParent[],
    parents: StackParent[]
): HistoricalStackObservation {
    const response = object(JSON.parse(raw));
    if (response.errors !== undefined) {
        fail('historical stack query returned errors');
    }
    const repository = object(object(response.data).repository);
    const child = parseHistoricalPullRequest(repository.child);
    const parent = parseHistoricalPullRequest(repository.parent);
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

function historicalStackQuery(child: number, parent: number): string[] {
    const fields = `id number createdAt state author { id } repository { id nameWithOwner } headRepository { id nameWithOwner } headRefName headRefOid headRef { name target { oid } } baseRefName baseRef { name target { oid } } timelineItems(first:100,itemTypes:[BASE_REF_CHANGED_EVENT,HEAD_REF_FORCE_PUSHED_EVENT,HEAD_REF_DELETED_EVENT,HEAD_REF_RESTORED_EVENT,CLOSED_EVENT,REOPENED_EVENT]) { pageInfo { hasNextPage } nodes { __typename } }`;
    return [
        'api',
        'graphql',
        '-f',
        `query=query { repository(owner:"${REQUIRED_REPOSITORY.split('/')[0]}",name:"${REQUIRED_REPOSITORY.split('/')[1]}") { child:pullRequest(number:${child}) { ${fields} } parent:pullRequest(number:${parent}) { ${fields} } } }`,
    ];
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
    const stored = port.readDescriptor();
    const initialMarkers = port.markers();
    let receiptSnapshot = JSON.stringify(prior);
    let markerSnapshot = JSON.stringify(initialMarkers);
    const descriptorSnapshot = JSON.stringify(stored);
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
    const receipt: HistoricalAdmissionReceipt = {
        version: 1,
        childPullRequest: input.childPullRequest,
        expectedChildHead: input.expectedHead,
        descriptor,
    };
    revalidate();
    if (prior === undefined) {
        port.saveReceipt(receipt);
    }
    receiptSnapshot = JSON.stringify(receipt);
    if (JSON.stringify(port.readReceipt()) !== JSON.stringify(receipt)) {
        fail('historical admission receipt changed');
    }
    revalidate();
    if (port.markers().length === 0) {
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
        args.length !== 9 ||
        args[2] !== '--admit-historical' ||
        args[3] !== '--child-pr' ||
        args[5] !== '--parent-pr' ||
        args[7] !== '--expected-head'
    ) {
        fail(SYNC_PARENT_USAGE);
    }
    const child = args[4];
    const parent = args[6];
    const head = args[8];
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
    return {
        lane,
        admission: { childPullRequest: Number(child), parentPullRequest: Number(parent), expectedHead: head },
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
        if (statSync(path).size > 1024 * 1024) {
            fail('native branch history exceeds admission bound');
        }
        return readFileSync(path, 'utf8');
    };
    const readDescriptor = () => readLaneStack(primaryRoot, branch);
    return {
        head: base.head,
        clean: base.clean,
        isAncestor: base.isAncestor,
        observe: () => {
            const raw = capture(ghPath, historicalStackQuery(admission.childPullRequest, admission.parentPullRequest), {
                cwd: primaryRoot,
                env: session.env,
            });
            const repository = object(object(object(JSON.parse(raw)).data).repository);
            const parent = parseHistoricalPullRequest(repository.parent);
            parentBranch = parent.branch;
            const children = parseStackParents(
                capture(ghPath, stackParentQuery(branch), { cwd: primaryRoot, env: session.env })
            );
            const parents = parseStackParents(
                capture(ghPath, stackParentQuery(parent.branch), { cwd: primaryRoot, env: session.env })
            );
            const observation = parseHistoricalStackObservation(raw, children, parents);
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
        markers: () => {
            const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // The repository-format key guarantees a successful read even when no marker exists.
            return local(['config', '--null', '--get-regexp', `^(core\\.repositoryformatversion|${escaped})$`])
                .split('\0')
                .filter((entry) => entry.startsWith(`${key}\n`))
                .map((entry) => entry.slice(key.length + 1));
        },
        saveReceipt: (receipt) => installExclusiveJson(`${laneStackPath(primaryRoot, branch)}.admission.json`, receipt),
        // Matching resumptions replace only their exact value; foreign values and duplicates remain visible.
        addMarker: (fork) => run(gitPath, ['config', '--fixed-value', key, fork, fork], { cwd: lane, env: localEnv }),
        installDescriptor: (descriptor) => installExclusiveJson(laneStackPath(primaryRoot, branch), descriptor),
        readStack: (ref) =>
            readRegisteredLaneStack(
                primaryRoot,
                ref,
                local(['config', '--get', '--default', '', `branch.${ref}.sourdaw-stack-fork`])
            ),
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
    const marker = local(['config', '--get', '--default', '', `branch.${lane.branch}.sourdaw-stack-fork`]);
    const descriptor =
        parsed.admission === undefined ? readRegisteredLaneStack(runtime.primaryRoot, lane.branch, marker) : undefined;
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
        };
        if (parsed.admission !== undefined) {
            admitHistoricalStack(
                { ...parsed.admission, branch: lane.branch },
                historicalAdmissionShellPort(shell, parsed.admission)
            );
            console.log(
                `admitted historical parent for ${lane.branch}; synchronize through lane:sync-parent --lane ${lane.path}`
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
