#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
    type GhSession,
} from './githubAppIdentity.ts';
import {
    checkedNativeParentCompletion,
    nativeParentInspectionInvocation,
    assertLegacyHistoricalFork,
    readNativeForkHistory,
    historicalRecord as object,
} from './laneStackForkMarkers.ts';
import { fail, PR_STATE } from './prContract.ts';
import { isAncestorCommit, parsePublishWorktrees, resolveAuthorLane, trustedPublishRuntime } from './publishLane.ts';
import {
    assertStackAcyclic,
    parseHistoricalPullRequest,
    parseHistoricalStackObservation,
    historicalStackQuery,
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
    type HistoricalStackObservation,
    type LaneStack,
    type HistoricalAdmissionReceipt,
    type StackReadPort,
    type StackParent,
} from './stackedLanes.ts';

export { checkedNativeParentCompletion, nativeParentInspectionInvocation } from './laneStackForkMarkers.ts';
export { parseHistoricalStackObservation } from './stackedLanes.ts';

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

function assertHistoricalReceiptMode(
    input: HistoricalAdmissionInput,
    observation: HistoricalStackObservation,
    prior: HistoricalAdmissionReceipt | undefined
): void {
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
}

function historicalAdmissionReceipt(
    input: HistoricalAdmissionInput,
    descriptor: LaneStack,
    observation: HistoricalStackObservation
): HistoricalAdmissionReceipt {
    const identity = {
        childPullRequest: input.childPullRequest,
        expectedChildHead: input.expectedHead,
        descriptor,
    };
    let receipt: HistoricalAdmissionReceipt;
    if (input.closedParent === undefined) {
        receipt = { version: 1, ...identity };
    } else {
        receipt = {
            version: 2,
            ...identity,
            closedParent: {
                ...input.closedParent,
                proof: observation.closedParentCompletion ?? fail('native parent completion is missing'),
            },
        };
    }
    if (Buffer.byteLength(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8') > 65536) {
        fail('historical admission receipt exceeds bound');
    }
    return receipt;
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
    assertHistoricalReceiptMode(input, observation, prior);
    const stored = port.readDescriptor();
    const initialMarkers = port.markers();
    assertLegacyHistoricalFork(input, descriptor, initialMarkers);
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
    const receipt = historicalAdmissionReceipt(input, descriptor, observation);
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

function historicalPullRequestArgument(value: string | undefined): number {
    if (value === undefined || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        fail(SYNC_PARENT_USAGE);
    }
    return Number(value);
}

function historicalLegacyArgument(args: string[]): string | undefined {
    if (args.length === 9 || args[9] === '--superseded-parent-replacement') {
        return undefined;
    }
    const fork = args[10];
    if (args.length !== 11 || args[9] !== '--legacy-fork' || fork === undefined || !fullSha.test(fork)) {
        fail(SYNC_PARENT_USAGE);
    }
    return fork;
}

function historicalClosedArgument(
    args: string[],
    child: number,
    parent: number
): NonNullable<HistoricalAdmissionInput['closedParent']> {
    const replacement = historicalPullRequestArgument(args[10]);
    if (
        (args.length !== 11 && args.length !== 12) ||
        (args.length === 12 && args[11] !== '--parent-origin-main') ||
        replacement === child ||
        replacement === parent
    ) {
        fail(SYNC_PARENT_USAGE);
    }
    return { replacementPullRequest: replacement, parentOriginMain: args.length === 12 };
}

function parseHistoricalAdmissionArgs(args: string[]): Omit<HistoricalAdmissionInput, 'branch'> {
    const legacyFork = historicalLegacyArgument(args);
    const child = historicalPullRequestArgument(args[4]);
    const parent = historicalPullRequestArgument(args[6]);
    const head = args[8];
    if (child === parent || head === undefined || !fullSha.test(head)) {
        fail(SYNC_PARENT_USAGE);
    }
    const admission: Omit<HistoricalAdmissionInput, 'branch'> = {
        childPullRequest: child,
        parentPullRequest: parent,
        expectedHead: head,
    };
    if (legacyFork !== undefined) {
        admission.legacyFork = legacyFork;
    }
    if (args[9] === '--superseded-parent-replacement') {
        admission.closedParent = historicalClosedArgument(args, child, parent);
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
        childLog: () => readNativeForkHistory(branch, local),
        parentLog: () => readNativeForkHistory(requiredParentBranch(), local),
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
