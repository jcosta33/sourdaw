#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_LOCK_REASON,
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
    githubAuthorizationGitEnv,
    assertTrustedExecutingBlob,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import {
    nodeModulesLinkTarget as resolveNodeModulesLinkTarget,
    outsideSymlinkRefusal,
} from './pnpmModulesPreflight.ts';
import {
    LANE_CHANGE_TYPES,
    assertIssueNumber,
    assertLaneChangeType,
    assertLaneSlug,
    fail,
    isIssueArgument,
    isLaneBranch,
    laneBranchName,
    type LaneChangeType,
    readLaneAdoptionRecord,
    saveLaneAdoptionRecord,
    observeAdoptedPullRequest,
    assertAdoptedPullRequest,
    assertNoAdoptionGuardFailure,
    type LaneAdoption,
    type AdoptionPort,
    adoptPresentPullRequest,
    verifyAdoptionSources,
    parseLaneAdoptionArgs,
    adoptionPathExists,
} from './prContract.ts';
import {
    assertStackAcyclic,
    readLaneStack,
    readRegisteredLaneStack,
    writeLaneStack,
    type LaneStack,
} from './stackedLanes.ts';

export const OPEN_LANE_USAGE =
    'usage: pnpm lane:open [issue-number] [slug] --type <type> --model <model> [--stack-on <absolute-parent-lane>]\n       pnpm lane:open --adopt-pr <pr> --expected-head <full-sha> --model <model> (read-only GitHub opt-in; present custody, never historical birth)';

const DEFAULT_LANE_SLUG = 'work';

export const AUTHOR_MODEL_PATTERN = /^[a-z0-9][a-z0-9.+-]{0,39}$/;

/**
 * The token names the model, not the family: capability variants within one family
 * (glm-5.3-flash versus glm-5.3) are distinct models, and collapsing them to the family would
 * make the bare authorship labels misattribute pull requests. Only deployment-routing prefixes
 * and date snapshots are dropped, because they change under the same model.
 */
export const AUTHOR_MODEL_RULE =
    'the lowercase public name of the model itself, keeping every qualifier that distinguishes capability or edition within the family (flash, mini, pro, air, codex, thinking) and dropping only deployment-routing prefixes and date-snapshot suffixes, e.g. glm-5.3-flash, glm-5.3, claude-sonnet-4.5, gpt-5.2-codex, kimi-k2.5';

export function normalizeAuthorModel(token: string): string {
    const normalized = token.trim().toLowerCase();
    if (!AUTHOR_MODEL_PATTERN.test(normalized)) {
        fail(`--model must be ${AUTHOR_MODEL_RULE}`);
    }
    return normalized;
}

/**
 * The config writes that aim a lane worktree's commits at the author App. `extensions.worktreeConfig`
 * must be on before any `--worktree` read or write works; it lives in the primary checkout's common
 * config, shared by every worktree, so enabling it from one lane covers them all and the write is
 * idempotent. The rest land in the lane's own `config.worktree`. `commit.gpgsign false` is
 * deliberate: the App holds no signing key, and the operator's personal key must never sign
 * bot-authored commits, so the lane disables signing rather than inheriting it — no signingkey is set.
 */
export function authorIdentityExtensionArgs(): string[] {
    return ['config', 'extensions.worktreeConfig', 'true'];
}

export function authorIdentityWorktreeArgs(): string[][] {
    return [
        ['config', '--worktree', 'user.name', AUTHOR_BOT_COMMIT_NAME],
        ['config', '--worktree', 'user.email', AUTHOR_BOT_COMMIT_EMAIL],
        ['config', '--worktree', 'commit.gpgsign', 'false'],
    ];
}

/** Applies the whole stamp to one lane through the caller's runner. */
export function runAuthorIdentityStamp(
    lanePath: string,
    run: (command: string, args: string[], options: { cwd: string }) => void
): void {
    run('git', authorIdentityExtensionArgs(), { cwd: lanePath });
    for (const args of authorIdentityWorktreeArgs()) {
        run('git', args, { cwd: lanePath });
    }
}

export type OpenLanePort = {
    primaryRoot: () => string;
    pathExists: (path: string) => boolean;
    assertUnusedStackNamespace: (branch: string) => void;
    ensureWorktreeParent: (path: string) => void;
    fetchMain: () => void;
    worktreeAdd: (path: string, branch: string, reservedBranch?: boolean) => void;
    /** Stamps the lane worktree's git config so its commits author as the author App. */
    stampAuthorIdentity: (lanePath: string) => void;
    /** Records `branch.<branch>.sourdaw-author-model` in the primary checkout's git config. */
    saveAuthorModel: (branch: string, model: string) => void;
    stackParent?: (path: string, childBranch: string) => LaneStack;
    saveStack?: (descriptor: LaneStack) => void;
    reserveStackBranch?: (branch: string, head: string) => void;
    /** Realpath of the lane's node_modules when it is a symlink; undefined when absent or a real directory. */
    nodeModulesLinkTarget: (lanePath: string) => string | undefined;
    lock: (path: string) => void;
    log: (message: string) => void;
};

/** Removes `--type <type>` at `typeIndex` from `args`, validating the type and refusing a repeat. */
function takeTypeOption(args: string[], typeIndex: number): { type: LaneChangeType; rest: string[] } {
    const token = args[typeIndex + 1];
    if (token === undefined || token.startsWith('--')) {
        fail(`--type requires the conventional-commit type of the change, one of ${LANE_CHANGE_TYPES.join(', ')}`);
    }
    const rest = [...args.slice(0, typeIndex), ...args.slice(typeIndex + 2)];
    if (rest.includes('--type')) {
        fail(OPEN_LANE_USAGE);
    }
    return { type: assertLaneChangeType(token), rest };
}

export function parseOpenLaneArgs(args: string[]): {
    issue?: number;
    slug: string;
    help: boolean;
    stackOn?: string;
    model?: string;
    type?: LaneChangeType;
    adoptPr?: number;
    expectedHead?: string;
} {
    const adoption = parseLaneAdoptionArgs(args, OPEN_LANE_USAGE);
    if (adoption !== undefined) {
        return { ...adoption, model: normalizeAuthorModel(adoption.model), help: false, slug: DEFAULT_LANE_SLUG };
    }
    const selector = args.indexOf('--stack-on');
    if (selector !== -1) {
        const parent = args[selector + 1];
        if (parent === undefined || !isAbsolute(parent)) {
            fail('--stack-on requires an absolute parent lane path');
        }
        const rest = [...args.slice(0, selector), ...args.slice(selector + 2)];
        if (rest.includes('--stack-on') || rest.includes('--help')) {
            fail(OPEN_LANE_USAGE);
        }
        return { ...parseOpenLaneArgs(rest), stackOn: parent };
    }
    const modelIndex = args.indexOf('--model');
    if (modelIndex !== -1) {
        const token = args[modelIndex + 1];
        if (token === undefined || token.startsWith('--')) {
            fail('--model requires the authoring model, e.g. glm-5.3-flash');
        }
        const rest = [...args.slice(0, modelIndex), ...args.slice(modelIndex + 2)];
        if (rest.includes('--model')) {
            fail(OPEN_LANE_USAGE);
        }
        return { ...parseOpenLaneArgs(rest), model: normalizeAuthorModel(token) };
    }
    const typeIndex = args.indexOf('--type');
    if (typeIndex !== -1) {
        const { type, rest } = takeTypeOption(args, typeIndex);
        return { ...parseOpenLaneArgs(rest), type };
    }
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true, slug: DEFAULT_LANE_SLUG };
    }
    const first = args[0];
    if (first === undefined) {
        return { slug: DEFAULT_LANE_SLUG, help: false };
    }
    if (isIssueArgument(first)) {
        if (args.length > 2) {
            fail(`unknown option: ${args[2] ?? ''}`);
        }
        const slug = args[1] ?? DEFAULT_LANE_SLUG;
        assertLaneSlug(slug);
        return { issue: assertIssueNumber(first, OPEN_LANE_USAGE), slug, help: false };
    }
    if (args.length > 1) {
        fail(`unknown option: ${args[1] ?? ''}`);
    }
    assertLaneSlug(first);
    return { slug: first, help: false };
}

/**
 * One directory per branch, both ways. `fix/12/beat` and `fix/12-beat` are different lanes, so
 * flattening both to `fix-12-beat` would make the second `lane:open` fail as "lane already
 * exists". A slug never contains a doubled dash and the issue form always puts a digit straight
 * after `<type>-`, so the doubled dash is free to mark the issueless form. The type leads the name
 * because the directory follows its branch: the same slug under two types is two lanes. Lanes
 * opened before types existed keep their `agent-` directories; nothing parses a directory name.
 */
export function laneDirectoryName(type: LaneChangeType, issue: number | undefined, slug: string): string {
    return issue === undefined ? `${type}--${slug}` : `${type}-${issue}-${slug}`;
}

function createStackWorktree(stack: LaneStack, lanePath: string, port: OpenLanePort): void {
    if (port.reserveStackBranch === undefined || port.saveStack === undefined) {
        fail('stack creation unavailable');
    }
    // Git's non-force branch creation is the ownership boundary; a preflight ref read cannot reserve it.
    port.reserveStackBranch(stack.childBranch, stack.forkHead);
    try {
        port.saveStack(stack);
        port.worktreeAdd(lanePath, stack.childBranch, true);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(
            `stack creation failed; reserved branch ${stack.childBranch} remains at ${stack.forkHead}; preserve its evidence and choose a new slug: ${message}`
        );
    }
}

export function openLane(
    type: LaneChangeType,
    issue: number | undefined,
    slug: string,
    model: string,
    port: OpenLanePort,
    stackOn?: string
): string {
    const branch = laneBranchName(type, issue, slug);
    const lanePath = join(port.primaryRoot(), '.agents', 'worktrees', laneDirectoryName(type, issue, slug));
    if (port.pathExists(lanePath)) {
        fail(`lane already exists: ${lanePath}`);
    }
    port.assertUnusedStackNamespace(branch);
    port.ensureWorktreeParent(lanePath);
    port.fetchMain();
    const stack = stackOn === undefined ? undefined : port.stackParent?.(stackOn, branch);
    if (stackOn !== undefined && (stack === undefined || port.saveStack === undefined)) {
        fail('stack creation unavailable');
    }
    if (stack !== undefined) {
        createStackWorktree(stack, lanePath, port);
    } else {
        port.worktreeAdd(lanePath, branch);
    }
    // The stamp precedes the model record and the lock, so a failure here leaves the worktree
    // created but unlocked — the same refusal-before-lock shape as the node_modules check below.
    port.stampAuthorIdentity(lanePath);
    // The branch records its authoring model the same way it records stack lineage: in the primary
    // checkout's git config, where lane:publish reads it back at publication time.
    port.saveAuthorModel(branch, model);
    // Issue #4118: a lane node_modules that symlinks into another checkout makes every pnpm run
    // through it rewrite that checkout's install metadata, which later aborts every trusted
    // delivery script. Refusing before the lock leaves the created worktree unlocked, so the fix
    // (the lane's own install) or `git worktree remove` stays uncomplicated; a link created after
    // opening is caught by the guard preflight instead.
    const linkTarget = port.nodeModulesLinkTarget(lanePath);
    if (linkTarget !== undefined) {
        const refusal = outsideSymlinkRefusal({
            laneRoot: lanePath,
            linkPath: join(lanePath, 'node_modules'),
            linkTarget,
        });
        if (refusal !== undefined) {
            fail(refusal);
        }
    }
    port.lock(lanePath);
    // The declaring session sees its own attribution; the path stays the final line because
    // consumers parse it from the tail of the output.
    port.log(`authoring model: ${model}`);
    // lane:open stays offline by design — no credential is minted or read here — so the claim is
    // the trusted script the operator runs next, from the protected primary checkout this command
    // itself ran in.
    if (issue !== undefined) {
        port.log(`claim the issue before starting work: pnpm issue:claim ${issue}`);
    }
    port.log(lanePath);
    return lanePath;
}

export function shellPort(
    capture: typeof spawnCapture = spawnCapture,
    run: typeof spawnRun = spawnRun,
    cwd: string = process.cwd()
): OpenLanePort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    return {
        primaryRoot: () => primaryRoot,
        pathExists: (path) => existsSync(path),
        assertUnusedStackNamespace: (branch) => {
            const refusal = `${branch} has retained stack evidence; preserve it and choose a new slug`;
            let descriptor: LaneStack | undefined;
            try {
                descriptor = readLaneStack(primaryRoot, branch);
            } catch {
                fail(refusal);
            }
            const keys = capture('git', ['config', '--name-only', '--list'], { cwd: primaryRoot }).split('\n');
            if (descriptor !== undefined || keys.includes(`branch.${branch}.sourdaw-stack-fork`)) {
                fail(refusal);
            }
        },
        ensureWorktreeParent: (path) => {
            mkdirSync(join(path, '..'), { recursive: true });
        },
        fetchMain: () => {
            run('git', ['fetch', 'origin', 'main'], { cwd: primaryRoot });
        },
        worktreeAdd: (path, branch, reservedBranch = false) => {
            if (reservedBranch) {
                run('git', ['worktree', 'add', path, branch], { cwd: primaryRoot });
            } else {
                run('git', ['worktree', 'add', '-b', branch, path, 'origin/main'], { cwd: primaryRoot });
            }
        },
        stampAuthorIdentity: (path) => {
            runAuthorIdentityStamp(path, run);
        },
        saveAuthorModel: (branch, model) => {
            run('git', ['config', `branch.${branch}.sourdaw-author-model`, model], { cwd: primaryRoot });
        },
        reserveStackBranch: (branch, head) => {
            run('git', ['branch', branch, head], { cwd: primaryRoot });
        },
        stackParent: (path, childBranch) => {
            if (!isAbsolute(path)) {
                fail('--stack-on requires an absolute parent lane path');
            }
            const parentPath = realpathSync(path);
            const worktrees = capture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot });
            const record = worktrees
                .split('\0\0')
                .find((entry) => entry.split('\0').includes(`worktree ${parentPath}`));
            const fields = record?.split('\0') ?? [];
            const parentBranch = fields
                .find((field) => field.startsWith('branch refs/heads/'))
                ?.slice('branch refs/heads/'.length);
            if (
                parentPath === realpathSync(primaryRoot) ||
                parentBranch === undefined ||
                !isLaneBranch(parentBranch) ||
                !fields.includes(`locked ${AUTHOR_LOCK_REASON}`)
            ) {
                fail('stack parent must be an exact author-locked lane in this primary repository');
            }
            if (capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: parentPath }) !== '') {
                fail('stack parent has uncommitted changes');
            }
            const forkHead = capture('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: parentPath });
            if (
                capture('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: parentPath }) !== parentBranch ||
                capture('git', ['rev-parse', '--verify', `refs/heads/${parentBranch}^{commit}`], {
                    cwd: primaryRoot,
                }) !== forkHead
            ) {
                fail('stack parent branch changed during creation');
            }
            const descriptor: LaneStack = { version: 1, childBranch, parentBranch, forkHead, parentHead: forkHead };
            assertStackAcyclic(descriptor, (branch) => readLaneStack(primaryRoot, branch));
            return descriptor;
        },
        saveStack: (descriptor) => {
            writeLaneStack(primaryRoot, descriptor);
            run('git', ['config', `branch.${descriptor.childBranch}.sourdaw-stack-fork`, descriptor.forkHead], {
                cwd: primaryRoot,
            });
        },
        nodeModulesLinkTarget: (path) => resolveNodeModulesLinkTarget(path),
        lock: (path) => {
            run('git', ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, path], { cwd: primaryRoot });
        },
        log: (message) => {
            console.log(message);
        },
    };
}

/**
 * Everything `lane:open` does that leaves the process. `verifyTrustedBlob` reads `origin/main`
 * through git and `createPort` resolves the primary root the same way, so a test that imported the
 * real pair would run git for real; taking them as a parameter is what gives a test a whole CLI
 * with no path outward at all.
 */
export type OpenLaneCli = {
    verifyTrustedBlob: (cwd: string) => void;
    createPort: (cwd: string) => OpenLanePort;
    adopt?: (pr: number, head: string, model: string, cwd: string) => void;
};

export const shellCli: OpenLaneCli = {
    verifyTrustedBlob: (cwd) => {
        const executingFile = fileURLToPath(import.meta.url);
        assertTrustedExecutingBlob('scripts/openLane.ts', executingFile, originMainBlob('scripts/openLane.ts', cwd));
        const helper = fileURLToPath(new URL('./stackedLanes.ts', import.meta.url));
        const helperBlob = originMainBlob('scripts/stackedLanes.ts', cwd);
        if (helperBlob === undefined) {
            fail('scripts/stackedLanes.ts is not available from origin/main');
        }
        assertTrustedExecutingBlob('scripts/stackedLanes.ts', helper, helperBlob);
        const markerReader = fileURLToPath(new URL('./laneStackForkMarkers.ts', import.meta.url));
        const markerReaderBlob = originMainBlob('scripts/laneStackForkMarkers.ts', cwd);
        if (markerReaderBlob === undefined) {
            fail('scripts/laneStackForkMarkers.ts is not available from origin/main');
        }
        assertTrustedExecutingBlob('scripts/laneStackForkMarkers.ts', markerReader, markerReaderBlob);
    },
    createPort: (cwd) => shellPort(spawnCapture, spawnRun, cwd),
    adopt: (pr, head, model, cwd) => {
        adoptPresentPullRequest(pr, head, model, shellAdoptionPort(cwd));
    },
};

export function runCli(argv: string[], cli: OpenLaneCli = shellCli, cwd: string = process.cwd()): number {
    try {
        const parsed = parseOpenLaneArgs(argv);
        if (parsed.help) {
            console.log(OPEN_LANE_USAGE.replace('usage:', 'Usage:'));
            return 0;
        }
        if (parsed.adoptPr !== undefined) {
            if (cli.adopt === undefined || parsed.expectedHead === undefined || parsed.model === undefined) {
                fail('adoption mode unavailable');
            }
            cli.adopt(parsed.adoptPr, parsed.expectedHead, parsed.model, cwd);
            return 0;
        }
        // Refused before the port exists, so a missing type or model can leave no worktree or branch behind.
        const type = assertLaneChangeType(parsed.type);
        if (parsed.model === undefined) {
            fail(`lane:open requires --model <model>: ${AUTHOR_MODEL_RULE}`);
        }
        cli.verifyTrustedBlob(cwd);
        openLane(type, parsed.issue, parsed.slug, parsed.model, cli.createPort(cwd), parsed.stackOn);
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

function adoptionShellContext(cwd: string) {
    const env = githubAuthorizationGitEnv();
    const capture = (args: string[], directory = cwd) => spawnCapture('git', args, { cwd: directory, env });
    const primaryRoot = resolvePrimaryRoot((_command, args, directory) => capture(args, directory), cwd);
    if (
        realpathSync(cwd) !== primaryRoot ||
        realpathSync(fileURLToPath(new URL('..', import.meta.url))) !== primaryRoot
    ) {
        fail('present adoption runs only from the protected primary checkout');
    }
    const sourceCommit = capture(['rev-parse', '--verify', 'origin/main^{commit}']);
    verifyAdoptionSources(
        [
            'scripts/openLane.ts',
            'scripts/prContract.ts',
            'scripts/githubAppIdentity.ts',
            'scripts/stackedLanes.ts',
            'scripts/laneStackForkMarkers.ts',
            'scripts/pnpmModulesPreflight.ts',
        ],
        sourceCommit,
        (path, pin) => originMainBlob(path, primaryRoot, env, 'git', pin),
        (path) => readFileSync(join(primaryRoot, path), 'utf8')
    );
    const git = (args: string[], directory = primaryRoot) => capture(args, directory);
    const run = (args: string[], directory = primaryRoot) => spawnRun('git', args, { cwd: directory, env });
    return { env, primaryRoot, sourceCommit, git, run };
}

function assertAdoptionParent(path: string): void {
    if (!adoptionPathExists(path)) {
        return;
    }
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) {
        fail('adoption parent directory is redirected');
    }
}
function adoptionBirthMessage(record: LaneAdoption): string {
    return `sourdaw: present PR adoption ${record.pullRequest.id} ${record.nonce}`;
}

export function shellAdoptionPort(cwd: string): AdoptionPort {
    const { env, primaryRoot, sourceCommit, git, run } = adoptionShellContext(cwd);
    const observe = (pr: number) =>
        observeAdoptedPullRequest(pr, REQUIRED_REPOSITORY, AUTHOR_BOT_NODE_ID, (args) =>
            spawnCapture('gh', args, { cwd: primaryRoot, env })
        );
    return {
        primaryRoot,
        sourceCommit,
        repository: REQUIRED_REPOSITORY,
        authorId: AUTHOR_BOT_NODE_ID,
        lockReason: AUTHOR_LOCK_REASON,
        observe,
        receipt: (branch) => readLaneAdoptionRecord(primaryRoot, branch),
        save: (record) => saveLaneAdoptionRecord(primaryRoot, record.pullRequest.branch, record),
        assertSafe: (branch) => {
            assertAdoptionParent(join(primaryRoot, '.agents'));
            assertAdoptionParent(join(primaryRoot, '.agents', 'worktrees'));
            const common = realpathSync(join(primaryRoot, '.git'));
            if (
                adoptionPathExists(join(common, 'info', 'grafts')) ||
                git(['for-each-ref', '--format=%(refname)', 'refs/replace/']) !== ''
            ) {
                fail('adoption refuses grafts or replacement objects');
            }
            if (readRegisteredLaneStack(primaryRoot, branch, (args) => git(args)) !== undefined) {
                fail('adoption cannot replace retained stack provenance');
            }
            if (readLaneAdoptionRecord(primaryRoot, branch, true) !== undefined) {
                fail('adoption publication already began; use exact lane:publish replay');
            }
            assertNoAdoptionGuardFailure(primaryRoot, branch);
        },
        branch: (branch) => git(['for-each-ref', '--format=%(objectname)', `refs/heads/${branch}`]),
        birth: (record) => {
            const path = join(primaryRoot, '.git', 'logs', 'refs', 'heads', record.pullRequest.branch);
            if (!adoptionPathExists(path)) {
                return false;
            }
            const [first] = readFileSync(path, 'utf8').split('\n');
            return (
                first !== undefined &&
                first.startsWith(`${'0'.repeat(40)} ${record.pullRequest.head} `) &&
                first.endsWith(`\t${adoptionBirthMessage(record)}`)
            );
        },
        pathExists: adoptionPathExists,
        worktrees: () =>
            git(['worktree', 'list', '--porcelain', '-z'])
                .split('\0\0')
                .filter(Boolean)
                .map((entry) => {
                    const fields = entry.split('\0');
                    const field = (prefix: string) =>
                        fields.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? '';
                    return {
                        path: field('worktree '),
                        branch: field('branch refs/heads/'),
                        head: field('HEAD '),
                        lock: field('locked '),
                    };
                }),
        ...adoptionReservationPort(primaryRoot, git, run, observe),
        ...adoptionCheckoutPort(primaryRoot, git, run),
        now: () => new Date().toISOString(),
        nonce: randomUUID,
        log: console.log,
    };
}
type AdoptionGit = (args: string[], directory?: string) => string;
type AdoptionRun = (args: string[], directory?: string) => void;
function adoptionReservationPort(
    primaryRoot: string,
    git: AdoptionGit,
    run: AdoptionRun,
    observe: AdoptionPort['observe']
): Pick<AdoptionPort, 'reserve' | 'add'> {
    return {
        reserve: (record) => {
            run(['fetch', '--no-tags', GITHUB_ADOPTION_REMOTE, `refs/heads/${record.pullRequest.branch}`]);
            if (git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}']) !== record.pullRequest.head) {
                fail('adopted branch moved during fetch');
            }
            assertAdoptedPullRequest(observe(record.pullRequest.number), record.pullRequest, record.pullRequest.head);
            run([
                '-c',
                `user.name=${AUTHOR_BOT_COMMIT_NAME}`,
                '-c',
                `user.email=${AUTHOR_BOT_COMMIT_EMAIL}`,
                'update-ref',
                '--create-reflog',
                '-m',
                adoptionBirthMessage(record),
                `refs/heads/${record.pullRequest.branch}`,
                record.pullRequest.head,
                '0'.repeat(40),
            ]);
        },
        add: (record) => {
            const parent = join(primaryRoot, '.agents', 'worktrees');
            try {
                mkdirSync(parent);
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
                    throw error;
                }
            }
            assertAdoptionParent(parent);
            // Git accepts an existing empty directory. Reserve this destination ourselves
            // so an empty foreign path cannot silently become the adopted checkout.
            mkdirSync(record.lanePath);
            run([
                'worktree',
                'add',
                '--lock',
                '--reason',
                AUTHOR_LOCK_REASON,
                record.lanePath,
                record.pullRequest.branch,
            ]);
        },
    };
}
function adoptionCheckoutPort(
    primaryRoot: string,
    git: AdoptionGit,
    run: AdoptionRun
): Pick<AdoptionPort, 'assertCheckout' | 'clean' | 'identity' | 'stamp' | 'model' | 'saveModel'> {
    return {
        assertCheckout: (record) => {
            const path = record.lanePath;
            const common = git(['rev-parse', '--git-common-dir'], path);
            if (
                realpathSync(path) !== path ||
                realpathSync(isAbsolute(common) ? common : join(path, common)) !==
                    realpathSync(join(primaryRoot, '.git')) ||
                git(['symbolic-ref', '--quiet', '--short', 'HEAD'], path) !== record.pullRequest.branch ||
                git(['rev-parse', '--verify', 'HEAD^{commit}'], path) !== record.pullRequest.head
            ) {
                fail('adoption checkout identity or common repository changed');
            }
        },
        clean: (path) => {
            const linkTarget = resolveNodeModulesLinkTarget(path);
            if (
                linkTarget !== undefined &&
                outsideSymlinkRefusal({ laneRoot: path, linkPath: join(path, 'node_modules'), linkTarget }) !==
                    undefined
            ) {
                fail('adoption node_modules redirects to another checkout');
            }
            return git(['status', '--porcelain=v1', '--untracked-files=all'], path) === '';
        },
        identity: (path) =>
            git(['config', '--get', '--default', '', 'extensions.worktreeConfig'], path) === 'true' &&
            git(['config', '--worktree', '--get', '--default', '', 'user.email'], path) === AUTHOR_BOT_COMMIT_EMAIL &&
            git(['config', '--worktree', '--get', '--default', '', 'user.name'], path) === AUTHOR_BOT_COMMIT_NAME &&
            git(['config', '--worktree', '--get', '--default', '', 'commit.gpgsign'], path) === 'false',
        stamp: (path) => runAuthorIdentityStamp(path, (_command, args, options) => run(args, options.cwd)),
        model: (branch) => git(['config', '--get', '--default', '', `branch.${branch}.sourdaw-author-model`]),
        saveModel: (branch, model) => run(['config', `branch.${branch}.sourdaw-author-model`, model]),
    };
}
const GITHUB_ADOPTION_REMOTE = 'https://github.com/jcosta33/sourdaw.git';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(runCli(process.argv.slice(2)));
}
