#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_LOCK_REASON,
    assertTrustedExecutingBlob,
    isAuthorBotNodeId,
    originMainBlob,
    removalLockPid,
    resolvePrimaryRoot,
} from './githubAppIdentity.ts';
import { supersessionReplacement } from './prContract.ts';

export type Worktree = {
    path: string;
    head: string;
    branch?: string;
    bare: boolean;
    detached: boolean;
    locked: boolean;
    lockReason?: string;
    prunable: boolean;
};

export type PullRequest = {
    number: number;
    state: string;
    isDraft: boolean;
    headRefName: string;
    headRefOid: string;
    headRepository: string | null;
    mergedAt: string | null;
};

export type IssueComment = {
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};

export type ReplacementPullRequest = {
    number: number;
    state: string;
    mergedAt: string | null;
};

export type LaneRemovalPort = {
    fetch: () => void;
    repository: () => string;
    currentDirectory: () => string;
    worktrees: () => Worktree[];
    active: (path: string) => boolean;
    processAlive: (pid: number) => boolean;
    dirty: (path: string) => boolean;
    ignored: (path: string) => string[];
    operation: (path: string) => string | undefined;
    remoteHead: (branch: string) => string | undefined;
    pullRequests: (branch: string) => PullRequest[];
    comments: (number: number) => IssueComment[];
    replacement: (number: number) => ReplacementPullRequest;
    lock: (path: string, reason?: string) => void;
    unlock: (path: string) => void;
    remove: (path: string) => void;
};

export type ShellRunner = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};

function fail(message: string): never {
    throw new Error(message);
}

export function inside(parent: string, candidate: string): boolean {
    const path = relative(parent, candidate);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function canonicalPath(path: string): string {
    const absolute = resolve(path);
    try {
        return realpathSync(absolute);
    } catch {
        return absolute;
    }
}

function matchingWorktrees(target: string, worktrees: Worktree[]): Worktree[] {
    const canonicalTarget = canonicalPath(target);
    return worktrees.filter((worktree) => canonicalPath(worktree.path) === canonicalTarget);
}

/**
 * The one shared definition of ignored output that is safe to discard: regenerable build and test
 * products, nothing else. Removal refuses a lane carrying ignored data that is not this, and
 * pruning (`lane:prune`) deletes exactly what this admits — the same contract read from both ends.
 */
export function disposableIgnored(path: string): boolean {
    const normalized = path.replaceAll('\\', '/');
    return (
        normalized === '.DS_Store' ||
        normalized.endsWith('/.DS_Store') ||
        /(?:^|\/)(?:node_modules|dist|coverage|target|playwright-report|test-results)(?:\/|$)/.test(normalized) ||
        /^\.agents\/ui-scripts\/[^/]+\.png$/.test(normalized)
    );
}

export function parseWorktrees(value: string): Worktree[] {
    return value
        .split('\0\0')
        .filter((record) => record !== '')
        .map((record) => {
            const fields = record.split('\0');
            const worktree = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
            const head = fields.find((field) => field.startsWith('HEAD '))?.slice('HEAD '.length);
            if (worktree === undefined || head === undefined) {
                fail('git returned malformed worktree state');
            }
            const branch = fields.find((field) => field.startsWith('branch '))?.slice('branch refs/heads/'.length);
            const locked = fields.find((field) => field === 'locked' || field.startsWith('locked '));
            return {
                path: worktree,
                head,
                branch,
                bare: fields.includes('bare'),
                detached: fields.includes('detached'),
                locked: locked !== undefined,
                lockReason: locked?.slice('locked '.length) || undefined,
                prunable: fields.some((field) => field === 'prunable' || field.startsWith('prunable ')),
            };
        });
}

function locateAgentWorktree(target: string, verb: string, port: LaneRemovalPort): Worktree {
    const worktrees = port.worktrees();
    const root = worktrees[0];
    if (root === undefined) {
        fail('repository has no worktree state');
    }
    const canonicalRoot = canonicalPath(root.path);
    const canonicalTarget = canonicalPath(target);
    const matches = matchingWorktrees(target, worktrees);
    if (matches.length === 0) {
        fail(`${target} is not a registered worktree`);
    }
    if (matches.length !== 1) {
        fail(`${target} does not identify one registered worktree`);
    }
    const [lane] = matches;
    if (lane === undefined) {
        fail(`${target} does not identify one registered worktree`);
    }
    if (canonicalTarget === canonicalRoot) {
        fail(`refusing to ${verb} the primary worktree`);
    }
    const agentRoot = canonicalPath(join(canonicalRoot, '.agents', 'worktrees'));
    if (canonicalTarget === agentRoot || !inside(agentRoot, canonicalTarget)) {
        fail(`${target} is not an agent worktree`);
    }
    if (inside(canonicalTarget, canonicalPath(port.currentDirectory()))) {
        fail(`refusing to ${verb} the active worktree`);
    }
    if (port.active(target)) {
        fail('worktree is active in another process');
    }
    return lane;
}

/**
 * Lock admission shared by both exits. A dead `lane-remove:<pid>` lock is stale leftover and is
 * cleared before retrying; the author lock marks the lane's owner and callers handle it themselves;
 * anything else is a foreign tool's claim on the worktree.
 */
function admitLaneLock(target: string, lane: Worktree, port: LaneRemovalPort, retry: () => Worktree): Worktree {
    if (!lane.locked) {
        return lane;
    }
    const stalePid = removalLockPid(lane.lockReason);
    if (stalePid !== undefined && !port.processAlive(stalePid)) {
        port.unlock(target);
        return retry();
    }
    if (lane.lockReason === AUTHOR_LOCK_REASON) {
        return lane;
    }
    return fail('worktree is locked or shared');
}

function identifyLane(target: string, port: LaneRemovalPort): Worktree {
    const lane = locateAgentWorktree(target, 'remove', port);
    if (lane.bare || lane.detached || lane.branch === undefined || lane.prunable) {
        fail('worktree ownership is unknown');
    }
    return admitLaneLock(target, lane, port, () => identifyLane(target, port));
}

/**
 * Stranding has no ownership to prove — an unproven head or a missing branch is exactly why a lane
 * ends up stranded — so this admits what `identifyLane` refuses: detached and branchless lanes.
 */
function identifyStrandLane(target: string, port: LaneRemovalPort): Worktree {
    const lane = locateAgentWorktree(target, 'strand', port);
    if (lane.bare || lane.prunable) {
        fail('worktree holds no directory to strand');
    }
    return admitLaneLock(target, lane, port, () => identifyStrandLane(target, port));
}

type OwnershipSnapshot = {
    head: string;
    branch: string;
    ignored: string[];
    pullRequest: number;
    supersededBy?: number;
    remoteHead?: string;
};

/**
 * A lane is spent once the work it holds is on `main`. Merging is the ordinary way there; being
 * superseded is the other one, and `pr:supersede` closes the old pull request unmerged, so state
 * alone cannot tell that lane from an abandoned one — and removing an abandoned lane discards
 * unmerged work.
 *
 * The receipt is what separates them. `pr:supersede` posts exactly one author-bot comment naming
 * the replacement before it closes anything. This function does not itself establish that
 * invariant — that guarantee lives in `supersedePullRequest.ts`, which refuses to post a receipt
 * onto a pull request already carrying a non-matching author-bot comment. What this function does
 * independently is count only the author-bot comments that actually parse as a receipt, so a
 * closed pull request carrying exactly one parsed receipt is trusted, and one carrying zero or
 * more than one — whether from unrelated author-bot chatter or genuinely conflicting receipts — is
 * refused. Reading the receipt back is not enough on its own: it says where the work went, not
 * that it arrived, so the named replacement must itself be merged before this lane counts as
 * spent.
 */
function supersededReplacement(number: number, port: LaneRemovalPort): number {
    const receipts = port
        .comments(number)
        .filter((comment) => comment.authorType === 'Bot' && isAuthorBotNodeId(comment.authorNodeId))
        .map((comment) => supersessionReplacement(comment.body))
        .filter((parsed): parsed is number => parsed !== undefined);
    const [replacement] = receipts;
    if (receipts.length !== 1 || replacement === undefined) {
        fail(`PR #${number} is closed without a supersession receipt`);
    }
    if (replacement === number) {
        fail(`PR #${number} names itself as its replacement`);
    }
    const landed = port.replacement(replacement);
    if (landed.number !== replacement || landed.state !== 'MERGED' || landed.mergedAt === null) {
        fail(`PR #${number} was superseded by #${replacement}, which is not merged`);
    }
    return replacement;
}

function validateOwnership(
    target: string,
    expected: Worktree,
    repository: string,
    port: LaneRemovalPort
): OwnershipSnapshot {
    const matches = matchingWorktrees(target, port.worktrees());
    const [current] = matches;
    if (
        matches.length !== 1 ||
        current === undefined ||
        current.path !== expected.path ||
        current.head !== expected.head ||
        current.branch !== expected.branch ||
        current.bare ||
        current.detached ||
        current.prunable ||
        !current.locked
    ) {
        fail('worktree identity changed during removal');
    }
    if (port.dirty(target)) {
        fail('worktree is dirty');
    }
    if (port.active(target)) {
        fail('worktree is active in another process');
    }
    const ignored = port.ignored(target);
    const unsafeIgnored = ignored.filter((path) => !disposableIgnored(path));
    if (unsafeIgnored.length > 0) {
        fail(`worktree contains ignored data: ${unsafeIgnored.slice(0, 3).join(', ')}`);
    }
    const operation = port.operation(target);
    if (operation !== undefined) {
        fail(`worktree has an active ${operation}`);
    }

    const branch = expected.branch;
    if (branch === undefined) {
        fail('worktree ownership is unknown');
    }
    const pullRequests = port.pullRequests(branch);
    if (pullRequests.length !== 1) {
        fail(`branch ${branch} does not identify one pull request`);
    }
    const pullRequest = pullRequests[0];
    if (pullRequest === undefined) {
        fail(`branch ${branch} has no pull request`);
    }
    if (pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()) {
        fail(`PR #${pullRequest.number} is foreign`);
    }
    const merged = pullRequest.state === 'MERGED' && pullRequest.mergedAt !== null;
    // The draft flag says nothing about whether the work landed: an OPEN draft is already refused
    // below because it is neither merged nor closed, and GitHub cannot merge a pull request while
    // it is still a draft, so a MERGED pull request is never a draft either. A CLOSED draft is the
    // one state a standalone `isDraft` refusal here would wrongly block — `pr:supersede` can close
    // a draft pull request against a genuinely merged replacement, and that lane must still be able
    // to prove it through the receipt path below.
    if (!merged && pullRequest.state !== 'CLOSED') {
        fail(`PR #${pullRequest.number} is still active`);
    }
    const supersededBy = merged ? undefined : supersededReplacement(pullRequest.number, port);
    const remoteHead = port.remoteHead(branch);
    if (
        pullRequest.headRefName !== branch ||
        pullRequest.headRefOid !== expected.head ||
        (remoteHead !== undefined && remoteHead !== expected.head)
    ) {
        fail(`branch ${branch} head ownership is unproven`);
    }
    if (port.dirty(target) || port.active(target)) {
        fail('worktree changed during removal');
    }
    return {
        head: current.head,
        branch,
        ignored: [...ignored].sort(),
        pullRequest: pullRequest.number,
        supersededBy,
        remoteHead,
    };
}

export function removeLane(target: string, port: LaneRemovalPort): void {
    port.fetch();
    const repository = port.repository();
    const lane = identifyLane(target, port);
    const authorLocked = lane.locked && lane.lockReason === AUTHOR_LOCK_REASON;
    if (!authorLocked) {
        port.lock(target);
    }
    let releaseOnFailure = !authorLocked;
    try {
        const initial = validateOwnership(target, lane, repository, port);
        const final = validateOwnership(target, lane, repository, port);
        if (JSON.stringify(initial) !== JSON.stringify(final)) {
            fail('worktree authority changed during removal');
        }
        port.unlock(target);
        releaseOnFailure = false;
        port.remove(target);
    } finally {
        if (releaseOnFailure) {
            port.unlock(target);
        }
    }
}

export function resolveLaneTarget(arg: string, primaryRoot: string): string {
    return realpathSync(isAbsolute(arg) ? arg : resolve(primaryRoot, arg));
}

export const STRAND_USAGE = 'usage: pnpm lane:strand <worktree-path> --reason "<why this lane is being abandoned>"';

/**
 * Where strand receipts live: under the primary root, not under the lane. A receipt written inside
 * the worktree would be destroyed with it, and the whole point of the receipt is to outlive the
 * lane it records. `.agents/lane-strands/` is gitignored operational state, like review bundles.
 * Receipts are keyed by lane directory name, which is deterministic — the conflict rule in
 * `refuseReceiptConflict` is what keeps a reused name from spending another lane's record.
 */
export const STRAND_RECEIPTS_DIR = '.agents/lane-strands';

export type LaneStrandPort = LaneRemovalPort & {
    readReceipt: (laneName: string) => string | undefined;
    writeReceipt: (laneName: string, body: string) => void;
    deleteBranch: (branch: string) => void;
    log: (message: string) => void;
};

export type StrandArgs = { target: string; reason: string };

export function parseStrandArgs(args: string[]): StrandArgs {
    // `args` starts at `--strand`; a reason that is missing, empty, or blank is no reason.
    const target = args[1];
    if (args.length !== 4 || args[2] !== '--reason' || args[3] === undefined || target === undefined) {
        fail(STRAND_USAGE);
    }
    if (target.startsWith('--')) {
        fail(STRAND_USAGE);
    }
    const reason = args[3].trim();
    if (reason === '') {
        fail('stranding a lane requires a non-empty --reason recording why its work is being abandoned');
    }
    return { target, reason };
}

type StrandSnapshot = {
    head: string;
    branch: string | null;
    ignored: string[];
};

/**
 * The strand gate: everything that keeps the act safe, nothing that proves the work landed —
 * proving that is `removeLane`'s job, and a lane whose proof cannot exist is why `lane:strand`
 * was called. Clean, idle, no ignored data of record, no operation in flight, and no open pull
 * request on the branch: an open pull request means the work is still live, and stranding it would
 * strand a review. Merged and closed pull requests pass: closed-without-receipt is exactly the
 * backlog this path exists to drain.
 */
function validateStrand(target: string, expected: Worktree, port: LaneRemovalPort): StrandSnapshot {
    const matches = matchingWorktrees(target, port.worktrees());
    const [current] = matches;
    if (
        matches.length !== 1 ||
        current === undefined ||
        current.path !== expected.path ||
        current.head !== expected.head ||
        current.branch !== expected.branch ||
        current.bare ||
        current.prunable ||
        !current.locked
    ) {
        fail('worktree identity changed during stranding');
    }
    if (port.dirty(target)) {
        fail('worktree is dirty');
    }
    if (port.active(target)) {
        fail('worktree is active in another process');
    }
    const ignored = port.ignored(target);
    const unsafeIgnored = ignored.filter((path) => !disposableIgnored(path));
    if (unsafeIgnored.length > 0) {
        fail(`worktree contains ignored data: ${unsafeIgnored.slice(0, 3).join(', ')}`);
    }
    const operation = port.operation(target);
    if (operation !== undefined) {
        fail(`worktree has an active ${operation}`);
    }
    if (expected.branch === undefined) {
        return { head: current.head, branch: null, ignored: [...ignored].sort() };
    }
    const open = port
        .pullRequests(expected.branch)
        .find((pullRequest) => pullRequest.state !== 'MERGED' && pullRequest.state !== 'CLOSED');
    if (open !== undefined) {
        fail(`PR #${open.number} is still active`);
    }
    if (port.dirty(target) || port.active(target)) {
        fail('worktree changed during stranding');
    }
    return { head: current.head, branch: expected.branch, ignored: [...ignored].sort() };
}

function recordedReceiptHead(existing: string): string | undefined {
    try {
        const parsed = JSON.parse(existing) as { head?: unknown };
        return typeof parsed.head === 'string' ? parsed.head : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Lane directory names are deterministic, so a new lane can reuse a name the receipts already
 * record. Overwriting on a differing head would silently erase the earlier abandonment's audit
 * record — including the head that makes its branch recoverable — so that is a hard refusal naming
 * both heads: a human decides which record is real, because appending or timestamping would fork
 * the trail instead of settling it. An identical head is the idempotent retry of a stranding whose
 * removal failed, and an unreadable receipt cannot prove either case, so it refuses too.
 */
function refuseReceiptConflict(laneName: string, head: string, port: LaneStrandPort): void {
    const existing = port.readReceipt(laneName);
    if (existing === undefined) {
        return;
    }
    const prior = recordedReceiptHead(existing);
    if (prior === undefined) {
        fail(`strand receipt for ${laneName} exists but records no readable head; refusing to overwrite it`);
    }
    if (prior !== head) {
        fail(`strand receipt for ${laneName} already records head ${prior}; refusing to overwrite it for head ${head}`);
    }
}

/**
 * The receipted exit for lanes the strict gate can never prove: a branch whose head ownership is
 * unproven (late push), a closed pull request without a supersession receipt, a lane with no
 * branch at all. The strict gates stay untouched — this path is weaker by design, and the reason
 * the caller must supply is the price: it is written, with the branch and head, into a receipt
 * under the primary root before anything is destroyed (the `pr:supersede` ordering), so the
 * abandonment is auditable and the branch tip stays recoverable from the recorded head after the
 * force-delete.
 */
export function strandLane(target: string, reason: string, port: LaneStrandPort): void {
    port.fetch();
    const lane = identifyStrandLane(target, port);
    const authorLocked = lane.locked && lane.lockReason === AUTHOR_LOCK_REASON;
    if (!authorLocked) {
        port.lock(target);
    }
    let releaseOnFailure = !authorLocked;
    try {
        const initial = validateStrand(target, lane, port);
        const final = validateStrand(target, lane, port);
        if (JSON.stringify(initial) !== JSON.stringify(final)) {
            fail('worktree authority changed during stranding');
        }
        const laneName = basename(target);
        refuseReceiptConflict(laneName, final.head, port);
        const receipt = `${JSON.stringify(
            {
                lane: laneName,
                path: target,
                branch: final.branch,
                head: final.head,
                reason,
                strandedAt: new Date().toISOString(),
            },
            null,
            2
        )}\n`;
        port.writeReceipt(laneName, receipt);
        port.unlock(target);
        releaseOnFailure = false;
        port.remove(target);
        if (final.branch !== null) {
            port.deleteBranch(final.branch);
        }
        port.log(`stranded ${laneName}; receipt in ${STRAND_RECEIPTS_DIR}/${laneName}.json`);
    } finally {
        if (releaseOnFailure) {
            port.unlock(target);
        }
    }
}

function capture(command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout.trim();
}

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit ${result.status ?? 'signal'}`);
    }
}

function parseJson<Value>(value: string, label: string): Value {
    try {
        return JSON.parse(value) as Value;
    } catch (error) {
        throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
}

export function shellPort(shell: ShellRunner = { capture, run }): LaneStrandPort {
    let cachedRepository: string | undefined;
    const repository = () => {
        cachedRepository ??= shell.capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
        return cachedRepository;
    };
    return {
        fetch: () => shell.run('git', ['fetch', '--prune', 'origin']),
        repository,
        currentDirectory: () => realpathSync(process.cwd()),
        worktrees: () => parseWorktrees(shell.capture('git', ['worktree', 'list', '--porcelain', '-z'])),
        active: (path) => {
            const canonicalTarget = canonicalPath(path);
            let pid: number | undefined;
            for (const line of shell.capture('lsof', ['-a', '-d', 'cwd', '-F', 'pn']).split('\n')) {
                if (line.startsWith('p')) {
                    pid = Number(line.slice(1));
                    continue;
                }
                if (
                    line.startsWith('n') &&
                    pid !== process.pid &&
                    inside(canonicalTarget, canonicalPath(line.slice(1)))
                ) {
                    return true;
                }
            }
            return false;
        },
        processAlive: (pid) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch (error) {
                return error instanceof Error && 'code' in error && error.code !== 'ESRCH';
            }
        },
        dirty: (path) => shell.capture('git', ['-C', path, 'status', '--porcelain=v1', '--untracked-files=all']) !== '',
        ignored: (path) =>
            shell
                .capture('git', ['-C', path, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])
                .split('\n')
                .filter((candidate) => candidate !== ''),
        operation: (path) => {
            const candidates = [
                ['merge', 'MERGE_HEAD'],
                ['rebase', 'rebase-merge'],
                ['rebase', 'rebase-apply'],
                ['cherry-pick', 'CHERRY_PICK_HEAD'],
                ['revert', 'REVERT_HEAD'],
                ['bisect', 'BISECT_LOG'],
            ] as const;
            for (const [name, marker] of candidates) {
                const markerPath = shell.capture('git', ['-C', path, 'rev-parse', '--git-path', marker]);
                const absoluteMarker = isAbsolute(markerPath) ? markerPath : resolve(path, markerPath);
                if (existsSync(absoluteMarker)) {
                    return name;
                }
            }
            return undefined;
        },
        remoteHead: (branch) => {
            const head = shell.capture('git', [
                'for-each-ref',
                '--format=%(objectname)',
                `refs/remotes/origin/${branch}`,
            ]);
            return head === '' ? undefined : head;
        },
        pullRequests: (branch) => {
            const nameWithOwner = repository();
            const [owner] = nameWithOwner.split('/');
            if (owner === undefined || owner === '') {
                fail('cannot identify the repository owner');
            }
            const pages = parseJson<
                Array<
                    Array<{
                        number: number;
                        state: string;
                        draft: boolean;
                        head: { ref: string; sha: string; repo: { full_name: string } | null };
                        merged_at: string | null;
                    }>
                >
            >(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${nameWithOwner}/pulls?state=all&head=${owner}%3A${encodeURIComponent(branch)}&per_page=100`,
                ]),
                'pull-request query'
            );
            return pages.flat().map((pullRequest) => ({
                number: pullRequest.number,
                state: pullRequest.merged_at === null ? pullRequest.state.toUpperCase() : 'MERGED',
                isDraft: pullRequest.draft,
                headRefName: pullRequest.head.ref,
                headRefOid: pullRequest.head.sha,
                headRepository: pullRequest.head.repo?.full_name ?? null,
                mergedAt: pullRequest.merged_at,
            }));
        },
        comments: (number) => {
            const pages = parseJson<
                Array<Array<{ body: string; user: { node_id: string; login: string; type: string } | null }>>
            >(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repository()}/issues/${number}/comments?per_page=100`,
                ]),
                'pull-request comment query'
            );
            return pages.flat().map((comment) => ({
                body: comment.body,
                authorNodeId: comment.user?.node_id ?? null,
                authorLogin: comment.user?.login ?? null,
                authorType: comment.user?.type ?? null,
            }));
        },
        replacement: (number) => {
            const pullRequest = parseJson<{ number: number; state: string; merged_at: string | null }>(
                shell.capture('gh', ['api', `repos/${repository()}/pulls/${number}`]),
                `PR #${number} query`
            );
            return {
                number: pullRequest.number,
                state: pullRequest.merged_at === null ? pullRequest.state.toUpperCase() : 'MERGED',
                mergedAt: pullRequest.merged_at,
            };
        },
        lock: (path, reason = `lane-remove:${process.pid}`) =>
            shell.run('git', ['worktree', 'lock', '--reason', reason, path]),
        unlock: (path) => shell.run('git', ['worktree', 'unlock', path]),
        remove: (path) => shell.run('git', ['worktree', 'remove', path]),
        readReceipt: (laneName) => {
            const path = join(resolvePrimaryRoot(), STRAND_RECEIPTS_DIR, `${laneName}.json`);
            return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
        },
        writeReceipt: (laneName, body) => {
            const directory = join(resolvePrimaryRoot(), STRAND_RECEIPTS_DIR);
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, `${laneName}.json`), body);
        },
        deleteBranch: (branch) => shell.run('git', ['branch', '-D', branch]),
        log: (message) => {
            console.log(message);
        },
    };
}

function main(): number {
    try {
        const args = process.argv.slice(2);
        if (args[0] === '--help' && args.length === 1) {
            console.log('Usage: node scripts/removeLane.ts <worktree-path>');
            console.log('       pnpm lane:strand <worktree-path> --reason "<why this lane is being abandoned>"');
            console.log('');
            console.log('Removes a spent agent worktree. The lane must be clean, unlocked, idle, and');
            console.log('hold the head of exactly one pull request in this repository that either');
            console.log('merged, or was superseded by a pull request that merged.');
            console.log('');
            console.log('--strand is the receipted exit for lanes that gate can never prove (unproven');
            console.log('head ownership, a closed pull request without a supersession receipt, no');
            console.log('branch at all). It refuses a lane holding an open pull request or uncommitted');
            console.log('work, records a receipt (reason, date, branch, head) under');
            console.log('.agents/lane-strands/ in the primary checkout, then removes the worktree and');
            console.log('force-deletes the branch; the recorded head keeps the tip recoverable. A');
            console.log('receipt already naming the same lane with a different head is refused, never');
            console.log('overwritten.');
            return 0;
        }
        const cwd = process.cwd();
        if (args[0] === '--strand') {
            const parsed = parseStrandArgs(args);
            assertTrustedExecutingBlob(
                'scripts/removeLane.ts',
                fileURLToPath(import.meta.url),
                originMainBlob('scripts/removeLane.ts', cwd)
            );
            const primaryRoot = resolvePrimaryRoot();
            strandLane(resolveLaneTarget(parsed.target, primaryRoot), parsed.reason, shellPort());
            return 0;
        }
        if (args.length !== 1 || args[0] === undefined || args[0].startsWith('--')) {
            fail('usage: node scripts/removeLane.ts <worktree-path>');
        }
        assertTrustedExecutingBlob(
            'scripts/removeLane.ts',
            fileURLToPath(import.meta.url),
            originMainBlob('scripts/removeLane.ts', cwd)
        );
        const primaryRoot = resolvePrimaryRoot();
        const target = resolveLaneTarget(args[0], primaryRoot);
        removeLane(target, shellPort());
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
