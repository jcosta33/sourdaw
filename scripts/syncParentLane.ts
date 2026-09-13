#!/usr/bin/env node
import { mkdirSync, realpathSync } from 'node:fs';
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
import { fail } from './prContract.ts';
import { isAncestorCommit, parsePublishWorktrees, resolveAuthorLane, trustedPublishRuntime } from './publishLane.ts';
import {
    assertStackAcyclic,
    parseStackParents,
    readLaneStack,
    readRegisteredLaneStack,
    resolveStackParent,
    stackParentCandidates,
    stackParentQuery,
    writeLaneStack,
    type LaneStack,
    type StackReadPort,
    type StackParent,
} from './stackedLanes.ts';

export const SYNC_PARENT_USAGE = 'usage: pnpm lane:sync-parent --lane <absolute-child-lane>';

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
    if (parent.state === 'MERGED') {
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
    const lanePath = args[1];
    if (args.length !== 2 || args[0] !== '--lane' || lanePath === undefined || !isAbsolute(lanePath)) {
        fail(SYNC_PARENT_USAGE);
    }
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
    const descriptor = readRegisteredLaneStack(runtime.primaryRoot, lane.branch, marker);
    if (descriptor === undefined) {
        fail('lane has no recorded parent');
    }
    assertStackAcyclic(descriptor, (branch) => readLaneStack(runtime.primaryRoot, branch));
    if (local(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
        fail('stack child has uncommitted changes');
    }
    const auth = await authenticateRole({ primaryRoot: runtime.primaryRoot, role: 'author' });
    try {
        const head = syncParentLane(
            descriptor,
            syncParentShellPort({
                lane: lane.path,
                branch: lane.branch,
                primaryRoot: runtime.primaryRoot,
                gitPath: runtime.gitPath,
                ghPath: runtime.ghPath,
                session: auth.session,
                localEnv: env,
            })
        );
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
