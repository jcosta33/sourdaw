#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
    accessSync,
    constants,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    TRUSTED_COMMON_DIR_ENV,
    TRUSTED_GATE_WORKFLOW_ENV,
    TRUSTED_GH_PATH_ENV,
    TRUSTED_GIT_PATH_ENV,
    TRUSTED_ORIGIN_COMMIT_ENV,
    TRUSTED_POWERSHELL_PATH_ENV,
    TRUSTED_PRIMARY_ROOT_ENV,
    TRUSTED_PS_PATH_ENV,
    TRUSTED_GIT_AI_PATH_ENV,
} from './prContract.ts';

export type TrustedGithubWriteCommand =
    | 'deliver'
    | 'issue:claim'
    | 'issue:reconcile'
    | 'lane:publish'
    | 'lane:sync-parent'
    | 'review:accept'
    | 'review:publish'
    | 'review:publish:recover'
    | 'review:repair'
    | 'review:confirm'
    | 'review:resolve'
    | 'review:shadow-status'
    | 'ruleset:harden';

export const BOOTSTRAP_PATH = 'scripts/trustedGithubWriteBootstrap.ts';
export const HEALTH_GATES_WORKFLOW_PATH = '.github/workflows/health-gates.yml';

export type TrustedLauncherBinding = {
    primaryRoot: string;
    commonDir: string;
    gitPath: string;
    ghPath: string;
    psPath?: string;
    powershellPath?: string;
    gitAiPath?: string;
};

/**
 * What the health-gates workflow says about one job, carried to the gate unresolved. A `name` is
 * whatever the workflow declares — absent, null, a string, or something that is not a name at all —
 * because deciding what a declaration means is the gate's rule to apply, not the launcher's.
 * `strategy` crosses for the same reason: a matrix name inside a called workflow is only derivable
 * from the matrix values the workflow declares, and substituting them is the gate's rule too.
 */
export type TrustedWorkflowJob = { name?: unknown; needs?: unknown; uses?: unknown; strategy?: unknown };

/**
 * A workflow a gated job calls, read at the same pinned commit and carried the same way: its declared
 * `name` and its jobs, unresolved. GitHub reports a called workflow's jobs as one check per inner job
 * named `<caller job name> / <inner job name>`, so the gate cannot derive the gating set without it.
 */
export type TrustedCalledWorkflow =
    { name?: unknown; jobs: Record<string, TrustedWorkflowJob> } | { unreadable: string };

export type TrustedGateWorkflow =
    | { jobs: Record<string, TrustedWorkflowJob>; called: Record<string, TrustedCalledWorkflow> }
    | { unreadable: string };

export type TrustedSourceSnapshot = {
    commit: string;
    sources: ReadonlyMap<string, string>;
    launcher?: TrustedLauncherBinding;
    gateWorkflow?: TrustedGateWorkflow;
};

type TrustedSourcePort = {
    resolveOriginMain: () => string;
    readOriginSource: (commit: string, path: string) => string;
    executeSnapshot: (
        command: TrustedGithubWriteCommand,
        args: string[],
        snapshot: TrustedSourceSnapshot
    ) => Promise<number>;
};

type SnapshotRunner = (
    entryPath: string,
    runner: string,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    command: TrustedGithubWriteCommand
) => Promise<number>;

/**
 * These commands fence their lock owner on the process identity that holds it, so the launcher must
 * put the whole command tree in one process group: a surviving child is then what keeps the fence
 * live, and recovery can prove the crashed owner gone.
 */
function commandFencesItsLockOwner(command: TrustedGithubWriteCommand | undefined): boolean {
    return (
        command === 'deliver' ||
        command === 'review:accept' ||
        command === 'review:publish' ||
        command === 'review:publish:recover'
    );
}

export function trustedSnapshotRunsDetached(
    command: TrustedGithubWriteCommand,
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform !== 'win32' && commandFencesItsLockOwner(command);
}

export function trustedSnapshotSignalTarget(
    pid: number,
    detached: boolean,
    platform: NodeJS.Platform = process.platform
): number {
    return detached && platform !== 'win32' ? -pid : pid;
}

export function forwardTrustedSnapshotSignal(
    pid: number,
    detached: boolean,
    platform: NodeJS.Platform,
    signal: NodeJS.Signals,
    send: (target: number, signal: NodeJS.Signals) => void = (target, forwardedSignal) =>
        process.kill(target, forwardedSignal)
): void {
    try {
        send(trustedSnapshotSignalTarget(pid, detached, platform), signal);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return;
        }
        throw error;
    }
}

export const trustedDependencyGraphs: Record<TrustedGithubWriteCommand, readonly string[]> = {
    deliver: [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/deliverPullRequest.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/recoverDeliveryLock.ts',
        'scripts/deliveryLockLegacyIncidents.ts',
        'scripts/deliveryRemoteInspection.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'issue:claim': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/claimTrackerIssue.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'issue:reconcile': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'lane:publish': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishLane.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/testInstructions.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'lane:sync-parent': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/syncParentLane.ts',
        'scripts/publishLane.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/testInstructions.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:accept': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/acceptReview.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/publishReview.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/reviewCommentDiffPreflight.ts',
        'scripts/reviewDocumentParser.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewDossierPublication.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewerModelDiversity.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewPublicationRemoteInspection.ts',
        'scripts/reviewPublicationBinding.ts',
        'scripts/reviewDossierSemanticAssessment.ts',
        'scripts/prepareReview.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/reviewApprovalFormat.ts',
        'scripts/reviewApprovalContext.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:publish': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishReview.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/reviewCommentDiffPreflight.ts',
        'scripts/reviewDocumentParser.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewDossierPublication.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewerModelDiversity.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewPublicationRemoteInspection.ts',
        'scripts/reviewPublicationBinding.ts',
        'scripts/reviewDossierSemanticAssessment.ts',
        'scripts/prepareReview.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/reviewApprovalFormat.ts',
        'scripts/reviewApprovalContext.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:publish:recover': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/recoverPublishReviewLock.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/publishReview.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/reviewCommentDiffPreflight.ts',
        'scripts/reviewDocumentParser.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewDossierPublication.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewerModelDiversity.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewPublicationLegacyIncidents.ts',
        'scripts/reviewPublicationRecoveryReceipt.ts',
        'scripts/reviewPublicationRemoteInspection.ts',
        'scripts/reviewPublicationBinding.ts',
        'scripts/reviewDossierSemanticAssessment.ts',
        'scripts/prepareReview.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/reviewApprovalFormat.ts',
        'scripts/reviewApprovalContext.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:repair': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/repairReviewFinding.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:confirm': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/confirmReviewRepairs.ts',
        'scripts/reviewRepair.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:resolve': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/resolveThread.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:shadow-status': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/reviewShadowStatus.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'ruleset:harden': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/rulesetHardening.ts',
        'scripts/canonicalRecord.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
};

export const commandEntries: Record<TrustedGithubWriteCommand, { path: string; runner: string }> = {
    deliver: { path: 'scripts/deliverPullRequest.ts', runner: 'runDeliverCli' },
    'issue:claim': { path: 'scripts/claimTrackerIssue.ts', runner: 'runClaimTrackerIssueCli' },
    'issue:reconcile': { path: 'scripts/reconcileTrackerIssue.ts', runner: 'runReconcileTrackerIssueCli' },
    'lane:publish': { path: 'scripts/publishLane.ts', runner: 'runPublishLaneCli' },
    'lane:sync-parent': { path: 'scripts/syncParentLane.ts', runner: 'runSyncParentCli' },
    'review:accept': { path: 'scripts/acceptReview.ts', runner: 'runAcceptReviewCli' },
    'review:publish': { path: 'scripts/publishReview.ts', runner: 'runPublishReviewCli' },
    'review:publish:recover': { path: 'scripts/recoverPublishReviewLock.ts', runner: 'runRecoverPublishReviewLockCli' },
    'review:repair': { path: 'scripts/repairReviewFinding.ts', runner: 'runRepairReviewFindingCli' },
    'review:confirm': { path: 'scripts/confirmReviewRepairs.ts', runner: 'runConfirmReviewRepairsCli' },
    'review:resolve': { path: 'scripts/resolveThread.ts', runner: 'runResolveReviewThreadCli' },
    'review:shadow-status': { path: 'scripts/reviewShadowStatus.ts', runner: 'runReviewShadowStatusCli' },
    'ruleset:harden': { path: 'scripts/rulesetHardening.ts', runner: 'runRulesetHardeningCli' },
};

export function trustedDependencyPaths(command: TrustedGithubWriteCommand): readonly string[] {
    return trustedDependencyGraphs[command];
}

export function assertTrustedSourceGraph(
    command: TrustedGithubWriteCommand,
    sources: ReadonlyMap<string, string>
): void {
    const paths = trustedDependencyPaths(command);
    const pathSet = new Set(paths);
    for (const path of paths) {
        if (!sources.has(path)) {
            throw new Error(`trusted snapshot is missing ${path}`);
        }
    }
    for (const [path, source] of sources) {
        if (!pathSet.has(path)) {
            throw new Error(`trusted snapshot contains unexpected source ${path}`);
        }
        assertSnapshotResolvableImports(path, source, pathSet);
    }
}

/**
 * A bare specifier is the one import shape the snapshot cannot satisfy. It holds nothing but
 * `scripts/`, so Node resolves `node_modules` upward from a temporary directory, finds none, and the
 * command dies mid-delivery with `ERR_MODULE_NOT_FOUND` instead of refusing anything. Only `node:`
 * builtins and the pinned siblings are reachable there, and checking local specifiers alone left
 * that failure invisible until it happened.
 *
 * The loader carries exactly one exemption, named below, and every other source carries none. The
 * loader is the one file the launcher also runs from the protected primary checkout, where the
 * repository's packages do resolve, and it is the one source the snapshot writes and never imports —
 * which the second rule keeps true — so its `yaml` dependency never resolves from a snapshot at all.
 * What holds that parser behind a dynamic call is not this check but the reason it is written that
 * way: a static bare dependency would load for every non-delivery command too, though none reads a
 * workflow or may fail over a package it never uses. The spec pins that shape separately.
 */
function assertSnapshotResolvableImports(path: string, source: string, pathSet: ReadonlySet<string>): void {
    for (const dependency of localModuleDependencies(path, source)) {
        if (!pathSet.has(dependency)) {
            throw new Error(`${path} imports unchecked local dependency ${dependency}`);
        }
        if (dependency === BOOTSTRAP_PATH) {
            throw new Error(`${path} imports ${BOOTSTRAP_PATH}, which the trusted snapshot never executes`);
        }
    }
    for (const specifier of bareModuleSpecifiers(source)) {
        if (path === BOOTSTRAP_PATH && specifier === LOADER_EXEMPT_SPECIFIER) {
            continue;
        }
        throw new Error(`${path} imports ${specifier}, which does not resolve in the trusted snapshot`);
    }
    for (const shape of snapshotComputedDynamicSpecifiers(source)) {
        throw new Error(
            `${path} loads a module through a computed ${shape} specifier, which the trusted snapshot cannot resolve`
        );
    }
}

/** The whole of the loader's exemption: this one package, in this one file, and nothing else. */
const LOADER_EXEMPT_SPECIFIER = 'yaml';

/**
 * Every shape that names a module: a `from '...'` clause, a side-effect `import '...'` statement,
 * dynamic `import(...)` (including static template literals and parenthesized specifiers),
 * `import.meta.resolve(...)`, `require(...)` / `require.resolve(...)`, and chained
 * `createRequire(...)('...')`. Both rules below read these shapes, because a list that saw only `from`
 * accepted the others — and the dynamic call is the shape this loader itself uses, so the
 * bare-specifier rule passed vacuously on the very file it was written to hold.
 *
 * Specifiers are collected by walking syntax, not by regex over raw source. Comments and the contents
 * of string and template literals cannot contribute; only real import/require forms at code depth can.
 * That keeps an example in this comment from being refused as a dependency.
 */
export function snapshotImportSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    scanImportSpecifiers(source, 0, source.length, specifiers, false, collectLoaderBindings(source));
    return [...specifiers];
}

const COMPUTED_DYNAMIC_IMPORT_SHAPE = 'import(...)';
const COMPUTED_REQUIRE_SHAPE = 'require(...)';
const COMPUTED_CREATE_REQUIRE_SHAPE = 'createRequire(...)(...)';

/**
 * The module-loading shapes whose specifier is computed rather than a literal the snapshot can
 * satisfy: `import(expr)`, `require(expr)` / `require.resolve(expr)`, and
 * `createRequire(...)(expr)`. A literal or static-template specifier is carried by
 * `snapshotImportSpecifiers`; a computed one is exactly what the graph check must not silently
 * ignore, because the snapshot writes only the declared sources into a temporary directory and a
 * computed specifier then resolves nothing there — the command dies mid-delivery with
 * `ERR_MODULE_NOT_FOUND` while every graph check reports coverage it does not have. Each such shape
 * is refused, naming the file and the shape.
 *
 * The decided shapes above are the ones a syntax walk can resolve, including the four #4818 names
 * this file gained rules for: a `/` after a control header's `)` or after a bare `else` opens a regex,
 * a `}` provably closing an operand-position object literal divides, a wrapped or bound callee
 * (`(0, require)(expr)`, `(require)(expr)`, `const load = createRequire(import.meta.url); load(expr)`,
 * and a value `import { createRequire as load } from 'node:module'` alias) resolves, and a regex inside
 * a binding pattern is skipped.
 * Each of those rules is narrowed to the position it can prove, so a shape that only resembles one
 * keeps the merge base's reading instead of being decided wrongly: a `)` after a member named for a
 * control keyword (`this.#while(1)`, `obj.if(1)`, …) ends a call, a brace after a type's `=` or `&` or
 * `|` closes a type literal rather than an object literal, a parenthesis that continues the enclosing
 * call is that call's argument list rather than a wrapped callee, and a name redeclared in a nested
 * function, class, or parameter list names that declaration.
 *
 * The binding pass decides five more spellings of a load the merge base admitted (#4835): a member
 * reached through a bound loader (`const load = require; const r = load.resolve; r(expr)`, and the
 * `require.bind(null)` a name takes), a loader bound by a default or a class field
 * (`function f(load = require)`, `const { load = require } = opts`, and the shorthand entry reading
 * `class H { loader = require }` back from a `new H()`), a loader behind an erased assertion
 * (`const load = <NodeRequire>require`), a member whose parameter list follows a brace a statement
 * block provably opens (`function f() { require(expr)\n{ … } }`), and a regrouping of the wrapped
 * callee (`((require))(expr)`).
 *
 * The class-field read-back binds only an instance field of the class the constructor name resolves to
 * in scope: a `static` field is not on the instance, a same-named class in a nested scope owns the name
 * there, any own field, method, accessor, or string-literal computed member shadows a parent's field of
 * that name, a subclass reaches an inherited field, and a local bound to `new <Name>` reaches the same
 * field a direct construction would — resolved through the same scope chain, so a sibling rebinding or
 * a nested redeclaration or reassignment to anything else does not reach the loader.
 *
 * The walk reads a constructor parameter property — `constructor(public loader = require) {}` — as the
 * own instance field it binds: its name from the parameter, its value from the parameter's initializer
 * when it has one, and no value when it has none. A parameter with no modifier binds a local instead.
 *
 * A class the member walk cannot model whole keeps the merge base's reading on either side of the
 * read-back: a decorator on the class — written `@dec`, `@ns.dec(1)`, `@dec.x`, parenthesised `@(expr)`,
 * or any chain of those segments such as `@(dec)(arg)` — a computed member name that is not a static
 * string literal (`[key]`, `['lo' + 'ader']`, ``[`${expr}`]``), and a member name written with a
 * unicode escape (`\u006coader`, `['\u006coader']`) each mark the class unmodelled, because such a
 * member may carry the field's name without the reader being able to spell it out.
 *
 * Every shape those rules do not model also keeps the merge base's reading, and these stay undecided:
 * a callee bound to another bound name (`const a = require; const b = a; b(expr)`), a member reached
 * through a second bound name (`const a = require; const b = a; const c = b.resolve; c(expr)`), a
 * require an aliased `createRequire` creates (`const load = make(import.meta.url); load(expr)`), a
 * `.resolve` or `.bind` member behind a parenthesised callee (`(require.resolve)(expr)`), a
 * double-parenthesised `createRequire` callee, a non-null assertion on the callee rather than on a
 * binding (`require!(expr)`), an initializer wrapped in parentheses (`const load = (require);`,
 * `(require as NodeRequire)`, `(<NodeRequire>require)`, `(require)!`), a constructor aliased through a
 * bound name (`const C = H; const { loader } = new C(); loader(expr)`), and a call whose brace follows
 * a `:` or an `=>` — a labeled block and an arrow body hold statements there, while a type literal at
 * an annotation or at an arrow's return type holds a member, and the token alone cannot separate them.
 * None weakens the claim for the decided shapes.
 */
export function snapshotComputedDynamicSpecifiers(source: string): string[] {
    const shapes = new Set<string>();
    scanComputedDynamicSpecifiers(source, 0, source.length, shapes, false, collectLoaderBindings(source));
    return [...shapes];
}

function scanComputedDynamicSpecifiers(
    source: string,
    start: number,
    end: number,
    shapes: Set<string>,
    stopAtDepthZero = false,
    bindings: LoaderRead = NO_LOADER_READ
): number {
    let index = start;
    let depth = stopAtDepthZero ? 1 : null;
    while (index < end) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanComputedTemplate(source, index, end, shapes, bindings);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (depth !== null) {
            if (source[index] === '{') {
                depth += 1;
                index += 1;
                continue;
            }
            if (source[index] === '}') {
                depth -= 1;
                if (depth === 0) {
                    return index + 1;
                }
                index += 1;
                continue;
            }
        }
        const computed = readComputedDynamicLoad(source, index, bindings);
        if (computed !== undefined) {
            shapes.add(computed.shape);
            index = computed.end;
            continue;
        }
        index += 1;
    }
    return index;
}

function scanComputedTemplate(
    source: string,
    index: number,
    end: number,
    shapes: Set<string>,
    bindings: LoaderRead = NO_LOADER_READ
): number {
    let cursor = index + 1;
    while (cursor < end) {
        const character = source[cursor];
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (character === '`') {
            return cursor + 1;
        }
        if (character === '$' && source[cursor + 1] === '{') {
            cursor = scanComputedDynamicSpecifiers(source, cursor + 2, end, shapes, true, bindings);
            continue;
        }
        cursor += 1;
    }
    return end;
}

type ComputedDynamicLoad = { shape: string; end: number };

/** The module loader a name reaches: the `require` function, or the `createRequire` factory. */
type LoaderBindingKind = 'require' | 'createRequire';

/**
 * What one file's text says about the module loader: the names it binds to a loader, and whether it
 * declares `require` itself. A file that declares the name forms no loader binding through that
 * identifier, so `const load = require` resolves nothing there. The declaration stops at the binding
 * pass: the literal and computed `require(…)` callee detection is never gated on it, because a bare
 * `require(…)` call is a load.
 */
type LoaderRead = {
    readonly names: ReadonlyMap<string, LoaderBindingKind>;
    readonly requireIsFileOwnName: boolean;
};

const NO_LOADER_READ: LoaderRead = { names: new Map(), requireIsFileOwnName: false };

/**
 * The loader names this file binds. A load can be spelled through a name as well as through the
 * literal callee — `(0, require)(expr)`, `(require)(expr)`,
 * `const load = createRequire(import.meta.url); load(expr)`, and an aliased `createRequire` import —
 * and each of those hid the load from the scan. The pass is single-file and one level deep: a name
 * bound to another bound name (`const b = a; b(spec)`), a destructured binding without a default, and
 * a member a parenthesised callee reaches keep the merge base's reading. Beyond the plain loader the
 * pass resolves a member on one (`const r = load.resolve`, `const load = require.bind(null)`), a
 * default the name is bound by (`function f(load = require)`, `const { load = require } = opts`), and
 * the shorthand entry that reads a class field's loader back (#4835). The read-back binds only an
 * instance field of the class its constructor name resolves to in scope, so a `static` field binds
 * nothing, a same-named class in another scope cannot decide it, and a subclass or a local holding an
 * instance reaches the field the instance really carries. A file that declares `require` itself binds
 * nothing through that identifier, which `declaresRequireName` reads; the declaration stops here and
 * never suppresses a `require(…)` callee.
 */
function collectLoaderBindings(source: string): LoaderRead {
    const bindings = new Map<string, LoaderBindingKind>();
    const classFields = new Map<number, ClassFieldsEntry>();
    const localBindings = new Map<string, LocalInstance[]>();
    const pendingReadBacks: Array<{ name: string; sourceStart: number; nameIndex: number; end: number }> = [];
    const requireIsFileOwnName = declaresRequireName(source);
    // Register every class declaration up front so a shadow declared before a forward class can decide
    // against the whole file's class names; members and fields are still read in the pass below.
    collectClassDeclarations(source, classFields);
    const classNames = collectClassNameSets(classFields);
    let index = 0;
    while (index < source.length) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanTemplate(source, index, source.length, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        const declared = readLoaderDeclarationAt(source, index, requireIsFileOwnName, bindings);
        if (declared !== undefined && isEveryUseACallLike(source, declared)) {
            bindings.set(declared.name, declared.kind);
            index = declared.end;
            continue;
        }
        const alias = readCreateRequireImportAlias(source, index);
        if (alias !== undefined && isEveryUseACallLike(source, alias)) {
            bindings.set(alias.name, 'createRequire');
            index = alias.end;
            continue;
        }
        const declaredField = readLoaderDefaultBindingAt(source, index, requireIsFileOwnName, bindings, localBindings);
        if (declaredField !== undefined) {
            if (declaredField.ownerOpen !== undefined) {
                if (declaredField.static !== true) {
                    const entry = classEntryFromOpen(source, classFields, declaredField.ownerOpen);
                    // A field whose read back crosses a regex ending in `*` after a block comment is
                    // mis-placed: the backward walk reads the regex's closing slash as that comment's
                    // close and jumps over an unclosed method body's `{`, taking a method-local
                    // assignment for a class field. Mark the class unmodelled so the read-back keeps
                    // the merge base's reading rather than resolving that assignment to the field.
                    if (
                        fieldRegionHasMisplacedRegexClose(source, declaredField.ownerOpen + 1, declaredField.nameIndex)
                    ) {
                        entry.unmodelled = true;
                    } else {
                        entry.fields.set(declaredField.name, declaredField.kind);
                    }
                }
            } else if (declaredField.pendingSource !== undefined) {
                pendingReadBacks.push({
                    name: declaredField.name,
                    sourceStart: declaredField.pendingSource.sourceStart,
                    nameIndex: declaredField.nameIndex,
                    end: declaredField.end,
                });
            } else if (isEveryUseACallLike(source, declaredField)) {
                bindings.set(declaredField.name, declaredField.kind);
            }
            index = declaredField.end;
            continue;
        }
        const localBinding = readLocalBindingAt(source, index, classFields, localBindings);
        if (localBinding !== undefined) {
            pushLocalBinding(localBindings, localBinding);
            index = localBinding.end;
            continue;
        }
        if (localBindings.size > 0) {
            const shadow = readLocalShadowAt(source, index);
            if (shadow !== undefined && localBindings.has(shadow.name)) {
                localBindings
                    .get(shadow.name)!
                    .push({ classRef: undefined, scopeChain: enclosingScopeChain(source, index) });
                index = shadow.end;
                continue;
            }
        }
        const parameter = readParameterShadowAt(source, index, classNames);
        if (parameter !== undefined) {
            pushLocalBinding(localBindings, parameter);
            index = parameter.end;
            continue;
        }
        const functionShadow = readFunctionShadowAt(source, index, classNames);
        if (functionShadow !== undefined) {
            pushLocalBinding(localBindings, functionShadow);
            index = functionShadow.end;
            continue;
        }
        if (isKeywordAt(source, index, 'class') && !isPrecededByDotAccess(source, index)) {
            const open = classBodyOpenAfterClass(source, index);
            if (open !== undefined) {
                registerClassAt(source, classFields, open, index);
                recordClassMembers(source, classFields, open);
            }
            index += 'class'.length;
            continue;
        }
        index += 1;
    }
    // Resolve every read-back now that every class and local is registered, so a class declared after
    // the read-back still carries its field.
    for (const pending of pendingReadBacks) {
        const scopeChain = enclosingScopeChain(source, pending.nameIndex);
        const classRef = resolveReadBackClass(source, pending.sourceStart, scopeChain, classFields, localBindings);
        if (classRef === undefined) {
            continue;
        }
        const kind = resolveInstanceField(classRef, pending.name, classFields, localBindings);
        if (kind === undefined) {
            continue;
        }
        const binding = { name: pending.name, kind, nameIndex: pending.nameIndex, end: pending.end };
        if (isEveryUseACallLike(source, binding)) {
            bindings.set(pending.name, kind);
        }
    }
    return { names: bindings, requireIsFileOwnName };
}

/** Records one local binding under its name, creating the list on first use. */
function pushLocalBinding(
    localBindings: Map<string, LocalInstance[]>,
    binding: LocalInstance & { name: string }
): void {
    const entries = localBindings.get(binding.name);
    if (entries === undefined) {
        localBindings.set(binding.name, [{ classRef: binding.classRef, scopeChain: binding.scopeChain }]);
    } else {
        entries.push({ classRef: binding.classRef, scopeChain: binding.scopeChain });
    }
}

/**
 * Registers a class expression's body with an empty name, so its fields and members are reachable
 * through a local binding to the expression without the expression's own name shadowing a declaration.
 */
function registerClassExpression(classFields: Map<number, ClassFieldsEntry>, open: number): void {
    let entry = classFields.get(open);
    if (entry === undefined) {
        entry = {
            name: '',
            scopeChain: [],
            parentName: undefined,
            fields: new Map(),
            members: new Set(),
            unmodelled: false,
        };
        classFields.set(open, entry);
    }
}

/**
 * Registers the class whose keyword starts at `classKeywordIndex` — a declaration or an expression —
 * and marks it unmodelled when a decorator precedes the keyword, so a read-back through a decorated
 * class keeps the merge base's reading instead of resolving to its members.
 */
function registerClassAt(
    source: string,
    classFields: Map<number, ClassFieldsEntry>,
    open: number,
    classKeywordIndex: number
): ClassFieldsEntry {
    const entry = isClassDeclarationPosition(source, classKeywordIndex)
        ? classEntryFromOpen(source, classFields, open)
        : (registerClassExpression(classFields, open), classFields.get(open)!);
    if (decoratorOpenBefore(source, classKeywordIndex) !== undefined) {
        entry.unmodelled = true;
    }
    return entry;
}

/**
 * Registers every class body — a declaration or an expression — by its body brace, without scanning its
 * members, so the full set of declared class names is known before the binding pass. A shadow declared
 * before a forward class then decides against the whole file's names rather than only the classes seen
 * so far. The lightweight scan only acts on the `class` keyword.
 */
function collectClassDeclarations(source: string, classFields: Map<number, ClassFieldsEntry>): void {
    let index = 0;
    while (index < source.length) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanTemplate(source, index, source.length, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (isKeywordAt(source, index, 'class') && !isPrecededByDotAccess(source, index)) {
            const open = classBodyOpenAfterClass(source, index);
            if (open !== undefined) {
                registerClassAt(source, classFields, open, index);
            }
        }
        index += 1;
    }
}

/** The class names a file declares, with their first characters for a cheap membership precheck. */
function collectClassNameSets(classFields: ReadonlyMap<number, ClassFieldsEntry>): {
    names: Set<string>;
    firstChars: Set<string>;
} {
    const names = new Set<string>();
    const firstChars = new Set<string>();
    for (const entry of classFields.values()) {
        if (entry.name !== '') {
            names.add(entry.name);
            firstChars.add(entry.name.charAt(0));
        }
    }
    return { names, firstChars };
}

/**
 * Whether the file declares the name `require` as anything but the module loader — a parameter, a
 * `const`/`let`/`var` name, a `function`/`class`/`enum`/`namespace`/`module` name, a destructuring
 * target, a catch parameter, or an `import` clause binding it. The declaration stops the binding
 * pass: no name is bound to the loader through one, so `function f(require) { const load = require;
 * load(spec) }`, `const require = fake; const load = require; load(spec)`, and `const { require } =
 * box; const load = require; load(spec)` form no binding and the file keeps the merge base's reading
 * (#4828). It never reaches the callee detection, where a `require(…)` call is a load whatever the
 * file declares. Two declarations keep the loader: a name bound to a created require
 * (`const require = createRequire(import.meta.url)`), because that declares the loader itself, and a
 * parameter list inside a type (`type L = (require: string) => void`), which declares nothing at
 * runtime. The reading is the file's, not the scope's, exactly as `isEveryUseACallLike` reads a
 * redeclaration, and it errs toward the file's own shadowing.
 */
function declaresRequireName(source: string): boolean {
    let index = 0;
    while (index < source.length) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanTemplate(source, index, source.length, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (
            isKeywordAt(source, index, 'require') &&
            !isPrecededByDotAccess(source, index) &&
            isRequireDeclarationAt(source, index)
        ) {
            return true;
        }
        index += 1;
    }
    return false;
}

/**
 * Whether the `require` at `index` declares the name rather than naming the loader. A declaration
 * keyword before it, an `import` clause binding it, a runtime parameter list or catch parameter
 * around it, a rest element, or a destructuring pattern entry makes it a declaration; a name bound to
 * a created require declares the loader itself and keeps it. The parameter test is the parenthesis
 * the name sits in — a list that closes before a body, a return type, or an arrow, or that opens a
 * `catch` clause, and is no type's list — which is what keeps the comma-sequence and parenthesised
 * callees (`(0, require)(spec)`, `(require)(spec)`) reading as the loader.
 */
function isRequireDeclarationAt(source: string, index: number): boolean {
    const keyword = declarationKeywordBefore(source, index);
    if (keyword !== undefined) {
        // A name bound to a created require keeps the loader — `const require = createRequire(
        // import.meta.url)` makes the loader the file then calls — and every other declaration
        // keyword names the file's own `require` instead, an ambient one included: `declare function
        // require` declares no value at runtime, so a call through the name reaches the loader the
        // merge base read.
        return !bindsCreatedRequire(source, index);
    }
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined) {
        return false;
    }
    if (isImportBindingNameAt(source, index)) {
        return true;
    }
    const character = source.charAt(before);
    if (character === '.' && source.charAt(before - 1) === '.' && source.charAt(before - 2) === '.') {
        // A `...` binds the name only where a rest target can stand: `f(...require)` spreads an
        // expression and keeps the loader.
        return isBindingPatternEntryAt(source, index) || isParameterListNameAt(source, index);
    }
    if (character === '{' || character === '[' || character === ':') {
        return isBindingPatternEntryAt(source, index);
    }
    if (character === ',') {
        return isBindingPatternEntryAt(source, index) || isParameterListNameAt(source, index);
    }
    if (character === '(') {
        return isParameterListNameAt(source, index);
    }
    return isParameterOfSignatureAt(source, index, before);
}

/**
 * Whether the `require` name at `index` is a signature's parameter reached over the modifiers a
 * parameter may carry: a bare arrow parameter (`const f = require => {}`) and a parameter property
 * (`constructor(private require: string) {}`). The modifier is skipped and the token that then
 * precedes the name decides — an arrow makes it the parameter, a parameter list or a binding pattern
 * entry opens it (#4828). Only a parameter modifier is skipped, so `async require => {}` is no
 * parameter here and the loader keeps its reading.
 */
function isParameterOfSignatureAt(source: string, index: number, before: number): boolean {
    const modifiersStart = parameterModifiersStartBefore(source, before);
    if (modifiersStart === undefined) {
        const afterName = skipWhitespace(source, index + 'require'.length);
        return source.startsWith('=>', afterName);
    }
    const modifierBefore = previousSignificantCharacter(source, modifiersStart - 1);
    if (modifierBefore === undefined) {
        return false;
    }
    const character = source.charAt(modifierBefore);
    if (character === '(') {
        return isParameterListNameAt(source, index);
    }
    if (character === ',' || character === '{' || character === '[') {
        return isBindingPatternEntryAt(source, index) || isParameterListNameAt(source, index);
    }
    return false;
}

/**
 * The start of the run of parameter modifiers standing before the name that ends at `end` —
 * `public`, `private`, `protected`, `readonly`, `override` — or `undefined` when no modifier stands
 * there, so the caller knows the name is bare. A run is walked whole, so `private readonly require`
 * is one name's modifiers; only those words are walked, so `async require => {}` is no parameter.
 */
function parameterModifiersStartBefore(source: string, end: number): number | undefined {
    let cursor = previousSignificantCharacter(source, end);
    let start: number | undefined;
    while (cursor !== undefined && isIdentifierContinue(source[cursor])) {
        const word = readWordBackward(source, cursor);
        if (!PARAMETER_MODIFIERS.has(word)) {
            break;
        }
        start = cursor - word.length + 1;
        cursor = previousSignificantCharacter(source, start - 1);
    }
    return start;
}

/** The modifiers a parameter property may carry in front of its name. */
const PARAMETER_MODIFIERS: ReadonlySet<string> = new Set(['public', 'private', 'protected', 'readonly', 'override']);

/**
 * Whether the `require` name at `index` is bound by an `import` clause, and so declares the name in
 * the file: the default binding's own name (`import require from …`), a named specifier inside the
 * clause's braces (`import { require } from …`, `import { other, require } from …`), or an alias —
 * `import { other as require } from …` and `import * as require from …` alike. A type-only clause or
 * specifier (`import type require from …`, `import type { require } from …`, `import { type require }
 * from …`) occupies the name no less, so it declares it too. Only an `import` clause binds here:
 * `export { require } from …` re-exports without binding, a dynamic `import(…)` names nothing, and the
 * `as` of a type assertion (`value as require`) is no clause's alias. A specifier the clause aliases
 * away (`import { require as other } from …`) reads as a declaration too: the file's own shadowing is
 * the direction this test errs toward.
 */
function isImportBindingNameAt(source: string, index: number): boolean {
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined) {
        return false;
    }
    const character = source.charAt(before);
    if (character === '{' || character === ',') {
        return importClauseEncloses(source, index);
    }
    if (!isIdentifierContinue(character)) {
        return false;
    }
    const word = readWordBackward(source, before);
    if (word === 'import') {
        return true;
    }
    if (word === 'type') {
        return importClauseEncloses(source, index) || importKeywordEndsAt(source, before - word.length);
    }
    if (word !== 'as') {
        return false;
    }
    if (importClauseEncloses(source, index)) {
        return true;
    }
    const star = previousSignificantCharacter(source, before - word.length);
    return star !== undefined && source.charAt(star) === '*' && importKeywordEndsAt(source, star - 1);
}

/** Whether the braces of an `import { … }` clause — a type-only `import type { … }` included — enclose `index`. */
function importClauseEncloses(source: string, index: number): boolean {
    const open = enclosingOpenerBefore(source, index, '{');
    if (open === undefined) {
        return false;
    }
    const keywordEnd = previousSignificantCharacter(source, open - 1);
    if (keywordEnd === undefined || !isIdentifierContinue(source[keywordEnd])) {
        return false;
    }
    const word = readWordBackward(source, keywordEnd);
    return word === 'import' || (word === 'type' && importKeywordEndsAt(source, keywordEnd - word.length));
}

/** Whether the word ending at or before `end` is the `import` keyword. */
function importKeywordEndsAt(source: string, end: number): boolean {
    const wordEnd = previousSignificantCharacter(source, end);
    if (wordEnd === undefined || !isIdentifierContinue(source[wordEnd])) {
        return false;
    }
    return readWordBackward(source, wordEnd) === 'import';
}

/**
 * Whether the `require` name at `index` is an entry of a binding pattern: a `{…}` or `[…]` whose
 * opener stands where a pattern can — after `const`/`let`/`var`, or as another pattern entry, a
 * parameter, or a nested pattern. The walk inward from the entry covers nested patterns such as
 * `const { a: [require] } = box`, so only the outer opener's position is read. A pattern and an object
 * literal share their shape, so an entry this test cannot place errs toward the file's own shadowing.
 */
function isBindingPatternEntryAt(source: string, index: number): boolean {
    const open = enclosingOpenerBefore(source, index, '{[');
    if (open === undefined) {
        return false;
    }
    const beforeOpen = previousSignificantCharacter(source, open - 1);
    if (beforeOpen === undefined) {
        return false;
    }
    const character = source.charAt(beforeOpen);
    // A `[` right after a `{` is a computed property key, not an array binding pattern: `{ [H]: y }`
    // reads the property whose name `H` evaluates to, so `H` there is a reference, never a binding.
    if (source.charAt(open) === '[' && character === '{') {
        return false;
    }
    if (',([{:'.includes(character)) {
        return true;
    }
    if (!isIdentifierContinue(character)) {
        return false;
    }
    return ASSIGNMENT_DECLARATION_KEYWORDS.has(readWordBackward(source, beforeOpen));
}

/** Whether a `require` declared at the name index `index` is the target of `= createRequire(…)`. */
function bindsCreatedRequire(source: string, index: number): boolean {
    const declared = readLoaderDeclaration(source, index, false, new Map());
    return declared !== undefined && declared.name === 'require' && declared.kind === 'require';
}

/**
 * The declaration keyword that declares the name at `index`: `export const require = fake`,
 * `export default class require {}`, `export async function require() {}`, `abstract class require
 * {}`, and `const enum require {}` all declared the name and were read as no declaration, so the
 * file's own `require` was taken for the module loader and an ordinary call through it was refused
 * (#4828).
 *
 * Only the word closest to the name is read, and the prefixes and modifiers in front of it are left
 * alone: a keyword is the same declaration behind one (`async function require() {}`), a prefix
 * chain (`export default`), or nothing at all, so the word itself decides. Reading the word at its
 * own start is what does it — the character before that start being an identifier is what a prefix
 * looks like, and not what a member's looks like.
 */
function declarationKeywordBefore(source: string, index: number): string | undefined {
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined || !isIdentifierContinue(source[before])) {
        return undefined;
    }
    const word = readWordBackward(source, before);
    const wordStart = before - word.length + 1;
    if (!DECLARATION_KEYWORDS.has(word) || isKeywordMemberNameAt(source, wordStart)) {
        return undefined;
    }
    return word;
}

/**
 * Whether the keyword starting at `wordStart` is a member name rather than a declaration. A `.` or
 * a `#` in front of the keyword proves the member, and nothing else does: the identifier character
 * of a prefix (`export const require = fake`, `export namespace require {}`) is no member's, and a
 * keyword is a member only after the dot or hash that names it.
 */
function isKeywordMemberNameAt(source: string, wordStart: number): boolean {
    return isPrecededByDotAccess(source, wordStart) || source.charAt(wordStart - 1) === '#';
}

/**
 * Whether the `require` name at `index` sits in a parameter list. The innermost parenthesis enclosing
 * it decides: a list that closes before a body, a return type, or an arrow is a declaration, and a
 * `catch` clause's list is one too. A list the token before it proves to belong to a type is no
 * declaration at all, which is what keeps `type L = (require: string) => void` out of the stand-down.
 * A list closed before a call is an argument list — `(0, require)` and `(require)` are the wrapped
 * callee — and a header keyword's parenthesis is an expression.
 */
function isParameterListNameAt(source: string, index: number): boolean {
    const open = enclosingOpenerBefore(source, index, '(');
    if (open === undefined || isTypeParameterListAt(source, open)) {
        return false;
    }
    const close = skipBalancedParens(source, open);
    if (close === undefined) {
        return false;
    }
    // `skipBalancedParens` returns the position after the closing `)`, so the list's own end is where
    // the return type, the arrow, or the body begins.
    const after = skipWhitespace(source, close);
    if (source.startsWith('=>', after)) {
        return true;
    }
    if (source[after] !== '{' && source[after] !== ':') {
        return false;
    }
    const wordEnd = previousSignificantCharacter(source, open - 1);
    const word = wordEnd === undefined ? '' : readWordBackward(source, wordEnd);
    return word === 'catch' || !CONTROL_HEADER_KEYWORDS.has(word);
}

/**
 * Whether the parameter list opened at `open` belongs to a type — the function type of a `type` alias
 * or of a declaration's annotation — rather than to a runtime function. A type's parameter list
 * declares nothing at runtime, so it must not stand the loader down: only the alias's `=` and a
 * declaration keyword's annotation `:` prove it, and every other position keeps the stand-down
 * (#4828).
 */
function isTypeParameterListAt(source: string, open: number): boolean {
    const before = previousSignificantCharacter(source, open - 1);
    if (before === undefined) {
        return false;
    }
    return source.charAt(before) === '='
        ? isTypeAliasNameBefore(source, before)
        : source.charAt(before) === ':' && isDeclarationAnnotationBefore(source, before);
}

/** Whether the `=` at `equals` closes a `type <name><…> = …` clause. */
function isTypeAliasNameBefore(source: string, equals: number): boolean {
    let nameEnd = previousSignificantCharacter(source, equals - 1);
    if (nameEnd !== undefined && source.charAt(nameEnd) === '>') {
        const open = matchingOpenDelimiterBackward(source, nameEnd, '<', '>');
        nameEnd = open === undefined ? undefined : previousSignificantCharacter(source, open - 1);
    }
    if (nameEnd === undefined || !isIdentifierContinue(source[nameEnd])) {
        return false;
    }
    const name = readWordBackward(source, nameEnd);
    const keywordEnd = previousSignificantCharacter(source, nameEnd - name.length);
    return (
        keywordEnd !== undefined &&
        isIdentifierContinue(source[keywordEnd]) &&
        readWordBackward(source, keywordEnd) === 'type'
    );
}

/** Whether the `:` at `colon` annotates a declared name — a variable, function, or class one. */
function isDeclarationAnnotationBefore(source: string, colon: number): boolean {
    const nameEnd = previousSignificantCharacter(source, colon - 1);
    if (nameEnd === undefined || !isIdentifierContinue(source[nameEnd])) {
        return false;
    }
    return declarationKeywordBefore(source, nameEnd - readWordBackward(source, nameEnd).length + 1) !== undefined;
}

/**
 * The opener from `openers` that opens the innermost region containing `index`, or `undefined` when no
 * such opener encloses it. The walk skips whitespace, comments, string, template, and regex literals,
 * counts every nested delimiter as depth, and ends where a different kind of opener begins the region,
 * so the returned opener is the one that holds the name.
 */
function enclosingOpenerBefore(source: string, index: number, openers: string): number | undefined {
    let cursor = index - 1;
    let depth = 0;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/') {
            const commentOpen = cursor >= 1 && source[cursor - 1] === '*' ? source.lastIndexOf('/*', cursor - 1) : -1;
            if (commentOpen !== -1) {
                cursor = commentOpen - 1;
                continue;
            }
            const lineComment = lineCommentOpenBefore(source, cursor);
            if (lineComment !== undefined) {
                cursor = lineComment - 1;
                continue;
            }
            const regexOpen = regexLiteralOpenBackward(source, cursor);
            // Only an opener that stands at a regex position starts a literal. Two division slashes
            // otherwise pair — `1 / 2 … 3 / 4` reads as a literal from the second `/` back to the
            // first — and the walk then steps over the `{`, `(`, or `[` between them.
            if (regexOpen !== undefined && canStartRegexLiteral(source, regexOpen)) {
                cursor = regexOpen - 1;
                continue;
            }
        }
        if (character === '"' || character === "'") {
            const quoteOpen = skipQuotedBackward(source, cursor, character);
            cursor = quoteOpen === undefined ? cursor - 1 : quoteOpen - 1;
            continue;
        }
        if (character === '`') {
            const templateOpen = skipTemplateBackward(source, cursor);
            cursor = templateOpen === undefined ? cursor - 1 : templateOpen - 1;
            continue;
        }
        if (character === ')' || character === '}' || character === ']') {
            depth += 1;
            cursor -= 1;
            continue;
        }
        if (openers.includes(character)) {
            if (depth === 0) {
                return cursor;
            }
            depth -= 1;
            cursor -= 1;
            continue;
        }
        if (character === '(' || character === '{' || character === '[') {
            if (depth === 0) {
                return undefined;
            }
            depth -= 1;
            cursor -= 1;
            continue;
        }
        cursor -= 1;
    }
    return undefined;
}

/**
 * Whether every use of a bound name besides its own declaration is a call or a member access. A name
 * that is also a parameter or a local declaration (`function f(load) { load(spec) }`, `let load =
 * other`, `{ load: 1 }`) does not name the loader there, so the binding is dropped and the shape
 * keeps the merge base's reading instead of turning a shadowed name into a load. A nested declaration
 * of the same name is the same shadowing wherever it sits: `function load(s) {…}`, `class load {…}`,
 * and a `let`/`const`/`var` target inside another function each declare the name again, so the
 * binding is dropped rather than resolving the outer loader through the nested scope.
 *
 * One declaration keeps the binding: a class field of that name, whatever its initializer, because it
 * names a property the class declares, never a use of the local bound name — which is where the
 * shorthand entry that reads the field back gets its value (`class H { loader = require }`). Reading a
 * class field as a use dropped the binding the read-back made, and a same-named field in another class
 * dropped a real binding too (#4835).
 */
function isEveryUseACallLike(source: string, binding: LoaderBinding): boolean {
    let index = 0;
    while (index < source.length) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanTemplate(source, index, source.length, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (
            !source.startsWith(binding.name, index) ||
            isIdentifierContinue(source[index - 1]) ||
            isIdentifierContinue(source[index + binding.name.length])
        ) {
            index += 1;
            continue;
        }
        if (index !== binding.nameIndex) {
            if (isClassFieldNameAt(source, index, binding.name.length)) {
                index += binding.name.length;
                continue;
            }
            const after = skipWhitespace(source, index + binding.name.length);
            if (source[after] !== '(' && source[after] !== '.' && !source.startsWith('?.', after)) {
                return false;
            }
            if (isShadowingDeclaration(source, index)) {
                return false;
            }
        }
        index += binding.name.length;
    }
    return true;
}

/**
 * Whether the use at `index` declares the bound name again rather than calling the loader: a
 * `function` or `class` declaration name, or a `let`/`const`/`var` declaration target. The parameter
 * list case (`function f(load) {…}`) never reaches here, because its name is followed by `)` rather
 * than `(`, `.`, or `?.` and is refused by the call-like check above.
 */
function isShadowingDeclaration(source: string, index: number): boolean {
    return declarationKeywordBefore(source, index) !== undefined;
}

/**
 * The declaration keywords that bind a name again, which drops a loader binding of that name. The
 * TypeScript body keywords `enum`, `namespace`, and `module` are among them: each declares its name
 * as much as `function` or `class` does in the file that carries it (#4828).
 */
const DECLARATION_KEYWORDS: ReadonlySet<string> = new Set([
    'function',
    'class',
    'enum',
    'namespace',
    'module',
    'let',
    'const',
    'var',
]);

/**
 * A name the file binds to a loader or to a loader's member. `ownerOpen` marks a class field's
 * initializer with the index of the `{` that opens the declaring class's body: the field names a
 * property rather than a local, so it is remembered per class and bound only where the file reads it
 * back from an instance of that class through a shorthand pattern entry (#4835). `static` marks a
 * `static` field, which lives on the constructor rather than on an instance, so a read-back from
 * `new …()` must not bind it.
 */
type LoaderBinding = {
    name: string;
    kind: LoaderBindingKind;
    nameIndex: number;
    end: number;
    ownerOpen?: number;
    static?: boolean;
    pendingSource?: { sourceStart: number };
};

/**
 * One class declaration the field read-back can resolve: its name, the statement scope that contains it
 * (the outermost-first chain of enclosing block braces, empty at top level), the parent class a plain
 * `extends <Name>` clause names, the loader-valued instance fields it declares, and the names of every
 * own instance member. Static fields never enter `fields` or `members`, and a same-named class in
 * another scope owns its own entry, so a read-back resolves to the class its constructor name reaches
 * there rather than to whichever class declared the name first. `members` carries fields, methods,
 * accessors, and constructor parameter properties alike so any own declaration shadows the parent's
 * field of the same name.
 */
type ClassFieldsEntry = {
    name: string;
    scopeChain: number[];
    parentName: string | undefined;
    fields: Map<string, LoaderBindingKind>;
    members: Set<string>;
    /**
     * Whether the class body holds a construct the member walk does not fully consume — a decorator, a
     * static block, a computed member name that is not a static string literal, or a member name written
     * with a unicode escape — so the members it records are unreliable. A read-back through an
     * unmodelled class keeps the merge base's reading instead of resolving to a field.
     */
    unmodelled: boolean;
};

/**
 * A local name the file binds, remembered with the scope it was declared in. `classRef` is the class the
 * binding reaches — a `new <Class>()` initializer, a `class { … }` expression, or a declaration the name
 * aliases — or `undefined` when the binding names anything else: a plain value, a parameter, a
 * reassignment, or a nested redeclaration, each of which shadows any outer class or instance of the
 * same name.
 */
type LocalInstance = { classRef: number | undefined; scopeChain: number[] };

/** The loader expression a binding or a callee reads, and the position after it. */
type LoaderExpression = { kind: LoaderBindingKind; end: number };

/** The loader binding a `const`/`let`/`var` declaration at `index` makes, if any. */
function readLoaderDeclarationAt(
    source: string,
    index: number,
    requireIsFileOwnName: boolean,
    known: ReadonlyMap<string, LoaderBindingKind>
): LoaderBinding | undefined {
    const keyword = ['const', 'let', 'var'].find((candidate) => isKeywordAt(source, index, candidate));
    return keyword === undefined
        ? undefined
        : readLoaderDeclaration(source, index + keyword.length, requireIsFileOwnName, known);
}

/**
 * The loader a `const`/`let`/`var` initializer binds at `start`, or `undefined` when the initializer
 * is anything else — a loader *call* (`const load = require('yaml')`) loads rather than binds, and a
 * name bound to another name is not resolved here.
 */
function readLoaderDeclaration(
    source: string,
    start: number,
    requireIsFileOwnName: boolean,
    known: ReadonlyMap<string, LoaderBindingKind>
): LoaderBinding | undefined {
    const nameStart = skipWhitespace(source, start);
    const name = readWordForward(source, nameStart);
    if (name === undefined) {
        return undefined;
    }
    let cursor = skipWhitespace(source, nameStart + name.length);
    if (source[cursor] !== '=' || source[cursor + 1] === '=') {
        return undefined;
    }
    cursor = skipWhitespace(source, cursor + 1);
    const loader = readLoaderExpression(source, cursor, requireIsFileOwnName, known);
    return loader === undefined ? undefined : { name, kind: loader.kind, nameIndex: nameStart, end: loader.end };
}

/**
 * The loader an expression at `start` names: the `require` function, the `createRequire` factory, a
 * created require, and a `.resolve` or `.bind(…)` member on any of them. An erased angle-bracket
 * assertion in front of the initializer is crossed because it changes nothing at run time
 * (`const load = <NodeRequire>require`). An `as` or `satisfies` cast and a trailing non-null
 * assertion need no crossing of their own — each follows the loader as any other token does, so the
 * name still binds.
 *
 * A bound name resolves only as the object of such a member, so `load.resolve` reached through
 * `const load = require` is the loader's member. A bare name bound to another name is deliberately
 * not resolved (`const a = require; const b = a`), which the file keeps at the merge base's reading.
 */
function readLoaderExpression(
    source: string,
    start: number,
    requireIsFileOwnName: boolean,
    known: ReadonlyMap<string, LoaderBindingKind>
): LoaderExpression | undefined {
    let cursor = skipWhitespace(source, start);
    while (source[cursor] === '<') {
        const asserted = skipTypeArguments(source, cursor, source.length);
        if (asserted === undefined) {
            break;
        }
        cursor = skipWhitespace(source, asserted);
    }
    const literal = readLoaderLiteral(source, cursor, requireIsFileOwnName);
    const base = literal ?? readBoundLoaderBase(source, cursor, known);
    if (base === undefined) {
        return undefined;
    }
    const member = readLoaderMember(source, base.end, base.kind);
    if (member !== undefined) {
        return { kind: member.kind, end: member.end };
    }
    if (literal === undefined) {
        return undefined;
    }
    // A call (`require('yaml')`) or an unmodelled member (`require.foo`) binds the call's result or
    // an ordinary member, never the loader.
    return source[base.end] === '(' || source[base.end] === '.' || source.startsWith('?.', base.end)
        ? undefined
        : { kind: base.kind, end: base.end };
}

/** The loader the literal at `start` names, or `undefined` when the token is anything else. */
function readLoaderLiteral(source: string, start: number, requireIsFileOwnName: boolean): LoaderExpression | undefined {
    if (isKeywordAt(source, start, 'require')) {
        // A file that declares `require` itself reads this identifier as that declaration, not as the
        // loader, so nothing is bound through it.
        return requireIsFileOwnName ? undefined : { kind: 'require', end: start + 7 };
    }
    if (!isKeywordAt(source, start, 'createRequire')) {
        return undefined;
    }
    const after = skipWhitespace(source, start + 13);
    if (source[after] !== '(') {
        return { kind: 'createRequire', end: start + 13 };
    }
    // `createRequire(…)` returns a require function, so a name bound to its result loads in one call.
    const callEnd = skipBalancedParens(source, after);
    return callEnd === undefined ? undefined : { kind: 'require', end: callEnd };
}

/** The loader a name the pass has already bound reaches at `start`, or `undefined` for any other name. */
function readBoundLoaderBase(
    source: string,
    start: number,
    known: ReadonlyMap<string, LoaderBindingKind>
): LoaderExpression | undefined {
    const name = readWordForward(source, start);
    if (name === undefined) {
        return undefined;
    }
    const kind = known.get(name);
    return kind === undefined ? undefined : { kind, end: start + name.length };
}

/**
 * The loader a member access at `start` reaches: `require.resolve`, which is still a load, and
 * `.bind(…)`, whose result is the loader it was bound from. Whitespace and comments before the `.` or
 * `?.` are crossed so `load .resolve` reads as `load.resolve`. Every other member, a `resolve` that is
 * itself called, and a `.bind(…)` that is then called or read as a member bind a value rather than a
 * loader.
 */
function readLoaderMember(source: string, start: number, baseKind: LoaderBindingKind): LoaderExpression | undefined {
    let cursor = skipWhitespace(source, start);
    if (source.startsWith('?.', cursor)) {
        cursor += 2;
    } else if (source[cursor] === '.') {
        cursor += 1;
    } else {
        return undefined;
    }
    const nameStart = skipWhitespace(source, cursor);
    if (baseKind === 'require' && isKeywordAt(source, nameStart, 'resolve')) {
        const after = skipWhitespace(source, nameStart + 7);
        return source[after] === '(' || source[after] === '.' || source.startsWith('?.', after)
            ? undefined
            : { kind: 'require', end: nameStart + 7 };
    }
    if (!isKeywordAt(source, nameStart, 'bind')) {
        return undefined;
    }
    const open = skipWhitespace(source, nameStart + 4);
    if (source[open] !== '(') {
        return undefined;
    }
    const close = skipBalancedParens(source, open);
    if (close === undefined) {
        return undefined;
    }
    const after = skipWhitespace(source, close);
    return source[after] === '(' || source[after] === '.' || source.startsWith('?.', after)
        ? undefined
        : { kind: baseKind, end: close };
}

/**
 * The loader binding an identifier at `index` makes through a default or a class field, or `undefined`
 * when the identifier binds nothing: a parameter default (`function f(load = require)`), a
 * destructuring default (`const { load = require } = opts`), a class field
 * (`class H { loader = require }`), and the shorthand pattern entry reading such a field back
 * (`class H { loader = require }\nconst { loader } = new H()`). The declaration kinds that stand the
 * pass down still decide: a file that declares `require` binds nothing through it.
 *
 * The class field names a property, not a local, so it is remembered against its declaring class
 * rather than bound; only a shorthand entry destructured from an instance of that class reads it back.
 * A `static` field lives on the constructor, so a read-back from `new …()` must not bind it, and only
 * an instance field does. A field's value is read only where the name stands at the class body's own
 * member position, so a parameter list, a binding pattern, and a field initializer it nests inside
 * declare no field however their defaults read. A constructor parameter property is the one field a
 * parameter list declares, and it is read through its modifier run rather than through the field
 * branch. Every other position keeps the merge base's reading instead of turning an ordinary
 * assignment into a load.
 */
function readLoaderDefaultBindingAt(
    source: string,
    index: number,
    requireIsFileOwnName: boolean,
    known: ReadonlyMap<string, LoaderBindingKind>,
    localBindings: ReadonlyMap<string, readonly LocalInstance[]>
): LoaderBinding | undefined {
    if (isIdentifierContinue(source[index - 1]) || !isIdentifierStart(source[index])) {
        return undefined;
    }
    const name = readWordForward(source, index);
    if (name === undefined) {
        return undefined;
    }
    const after = skipWhitespace(source, index + name.length);
    const equals = fieldEqualsAfter(source, after, source.length);
    if (equals === undefined) {
        // A shorthand pattern entry reading a class field's loader back is the one binding a name
        // takes without an initializer of its own.
        if (source[after] !== ',' && source[after] !== '}') {
            return undefined;
        }
        const pendingSource = readClassFieldReadBackSource(source, index, localBindings);
        if (
            pendingSource === undefined ||
            isPrecededByDotAccess(source, index) ||
            !isBindingPatternEntryAt(source, index)
        ) {
            return undefined;
        }
        // The read-back is deferred: its class is resolved after every class and local is registered, so
        // a class declared after the read-back still carries its field.
        return { name, kind: 'require', nameIndex: index, end: after, pendingSource };
    }
    const loader = readLoaderExpression(source, skipWhitespace(source, equals + 1), requireIsFileOwnName, known);
    // The member test walks back over comments, so it runs only where a name would otherwise bind.
    if (loader === undefined || isPrecededByDotAccess(source, index)) {
        return undefined;
    }
    const binding = { name, kind: loader.kind, nameIndex: index, end: loader.end };
    const ownerOpen = classFieldOwnerOpen(source, index);
    if (ownerOpen !== undefined && isClassMemberPosition(source, index, ownerOpen)) {
        return { ...binding, ownerOpen, static: isStaticClassField(source, index) };
    }
    // A constructor parameter property is an own instance field, and is decided here rather than by the
    // field branch, which the parameter list keeps the name out of: a plain parameter binds a local and
    // reaches no instance.
    const propertyOpen = classParameterPropertyOwnerOpen(source, index);
    if (propertyOpen !== undefined) {
        return { ...binding, ownerOpen: propertyOpen, static: false };
    }
    return isParameterListNameAt(source, index) || isBindingPatternEntryAt(source, index) ? binding : undefined;
}

/**
 * Whether the name at `index` stands at a class body's member position rather than inside a parameter
 * list, a binding pattern, a field initializer, or a literal. Only the innermost unclosed opener before
 * the name answers it: the class body's own `{` at `bodyOpen` admits a member, and a `(`, `[`, or
 * nested `{` between the two encloses the name instead. Every literal is crossed whole, so a `}`, `)`,
 * or `]` inside a regex, a string, or a template is the literal's character rather than a delimiter —
 * the owner the walk starts from is found by the same judgement, so the two must agree on the region.
 */
function isClassMemberPosition(source: string, index: number, bodyOpen: number): boolean {
    // A completed member body is a balanced region the walk crosses whole, so a real field declared
    // after a method or accessor is still a member position.
    let cursor = index - 1;
    while (cursor > bodyOpen) {
        const character = source[cursor];
        if (character === '/') {
            const commentOpen = cursor >= 1 && source[cursor - 1] === '*' ? source.lastIndexOf('/*', cursor - 1) : -1;
            if (commentOpen !== -1) {
                cursor = commentOpen - 1;
                continue;
            }
            const lineComment = lineCommentOpenBefore(source, cursor);
            if (lineComment !== undefined) {
                cursor = lineComment - 1;
                continue;
            }
            const regexOpen = regexLiteralOpenBackward(source, cursor);
            // Only an opener that stands at a regex position starts a literal. Two division slashes
            // otherwise pair — `1 / 2 … 3 / 4` reads as a literal from the second `/` back to the
            // first — and the walk then steps over the `{`, `(`, or `[` between them.
            if (regexOpen !== undefined && canStartRegexLiteral(source, regexOpen)) {
                cursor = regexOpen - 1;
                continue;
            }
        }
        if (character === '"' || character === "'") {
            const quoteOpen = skipQuotedBackward(source, cursor, character);
            cursor = quoteOpen === undefined ? cursor - 1 : quoteOpen - 1;
            continue;
        }
        if (character === '`') {
            const templateOpen = skipTemplateBackward(source, cursor);
            cursor = templateOpen === undefined ? cursor - 1 : templateOpen - 1;
            continue;
        }
        if (character === ')' || character === ']' || character === '}') {
            const open = matchingOpenDelimiterBackward(source, cursor, openerOfDelimiter(character), character);
            if (open === undefined) {
                return false;
            }
            cursor = open - 1;
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            return false;
        }
        cursor -= 1;
    }
    return true;
}

/**
 * Whether the region [start, end) holds the mis-placement the backward walk is vulnerable to: a regex
 * whose body ends in a star, preceded by a block-comment opener whose span to the regex's closing
 * slash holds an unclosed `{`. The walk reads that closing slash as the comment's close and jumps over
 * the unclosed brace, so a read-back through the region cannot place the field. A star-ending regex
 * with no earlier opener, or whose span crosses no brace, is crossed correctly and needs no bail.
 */
function fieldRegionHasMisplacedRegexClose(source: string, start: number, end: number): boolean {
    let cursor = start;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const quote = source[cursor];
        if (quote === "'" || quote === '"') {
            cursor = skipQuoted(source, cursor, quote);
            continue;
        }
        if (quote === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        if (source[cursor] === '/') {
            const regexEnd = skipRegexLiteral(source, cursor);
            if (regexEnd !== undefined && regexEnd <= end) {
                let closeSlash = regexEnd - 1;
                while (closeSlash > cursor && /[a-z]/i.test(source[closeSlash] ?? '')) {
                    closeSlash -= 1;
                }
                if (source[closeSlash - 1] === '*') {
                    const open = source.lastIndexOf('/*', closeSlash - 1);
                    if (open !== -1 && spanHasUnclosedBrace(source, open, closeSlash)) {
                        return true;
                    }
                }
                cursor = regexEnd;
                continue;
            }
        }
        cursor += 1;
    }
    return false;
}

/**
 * Whether the span [open, close] — a `/*` opener through a regex's closing slash — holds a `{` the slash
 * closes no matching `}` for, so a backward walk that jumps the span skips a method body's brace. Braces
 * inside comments, strings, templates, and the regex itself are the literal's content and are crossed.
 */
function spanHasUnclosedBrace(source: string, open: number, close: number): boolean {
    let cursor = open;
    let depth = 0;
    while (cursor <= close) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, close + 1);
            continue;
        }
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, close + 1, new Set());
            continue;
        }
        if (character === '/') {
            const regexEnd = skipRegexLiteral(source, cursor);
            if (regexEnd !== undefined) {
                cursor = Math.min(regexEnd, close + 1);
                continue;
            }
        }
        if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
        }
        cursor += 1;
    }
    return depth > 0;
}

/**
 * The source a shorthand pattern entry at `index` destructures, with the scope the read-back sits in, or
 * `undefined` when the entry is not a shorthand pattern whose source is a `new <Name>` or a local name.
 * The caller resolves the source against the complete class and local maps once every declaration is
 * registered, so a class or local bound later in the file still decides.
 */
function readClassFieldReadBackSource(
    source: string,
    index: number,
    localBindings: ReadonlyMap<string, readonly LocalInstance[]>
): { sourceStart: number } | undefined {
    const open = enclosingOpenerBefore(source, index, '{');
    if (open === undefined) {
        return undefined;
    }
    const close = skipBalancedDelimited(source, open, source.length, '{', '}');
    if (close === undefined) {
        return undefined;
    }
    const equals = skipWhitespace(source, close);
    if (source[equals] !== '=') {
        return undefined;
    }
    const sourceStart = skipWhitespace(source, equals + 1);
    // Defer a `new <Name>` unconditionally (the name may be a forward class), and a local only when the
    // file tracks it; anything else — an unrelated source object — is not a read-back and is dropped.
    if (isKeywordAt(source, sourceStart, 'new')) {
        return { sourceStart };
    }
    const localName = readWordForward(source, sourceStart);
    return localName !== undefined && localBindings.has(localName) ? { sourceStart } : undefined;
}

/**
 * The class a read-back source reaches: a `new <Name>` resolves `Name` through the class and local
 * maps, and a local name resolves through the local map. `undefined` when the source names no class.
 */
function resolveReadBackClass(
    source: string,
    sourceStart: number,
    scopeChain: number[],
    classFields: ReadonlyMap<number, ClassFieldsEntry>,
    localBindings: ReadonlyMap<string, readonly LocalInstance[]>
): number | undefined {
    if (isKeywordAt(source, sourceStart, 'new')) {
        const className = readWordForward(source, skipWhitespace(source, sourceStart + 3));
        return className === undefined
            ? undefined
            : resolveNameToClass(className, scopeChain, classFields, localBindings);
    }
    const localName = readWordForward(source, sourceStart);
    return localName === undefined ? undefined : resolveNameToClass(localName, scopeChain, classFields, localBindings);
}

/**
 * The class a name reaches in `scopeChain`, resolved through class declarations and the local and
 * parameter bindings the file records: the deepest binding of that name whose own scope is a prefix of
 * `scopeChain`, or `undefined` when none binds it there or when the deepest binding names anything but a
 * class. A local binding shadows a same-named class declaration in a deeper scope, and a same-named
 * binding in a sibling or inner scope is not a prefix of the position's chain and so does not compete.
 */
function resolveNameToClass(
    name: string,
    scopeChain: number[],
    classFields: ReadonlyMap<number, ClassFieldsEntry>,
    localBindings: ReadonlyMap<string, readonly LocalInstance[]>
): number | undefined {
    let bestRef: number | undefined;
    let bestDepth = -1;
    for (const [ref, entry] of classFields) {
        if (entry.name !== name || !isScopeChainPrefix(entry.scopeChain, scopeChain)) {
            continue;
        }
        if (entry.scopeChain.length > bestDepth) {
            bestDepth = entry.scopeChain.length;
            bestRef = ref;
        }
    }
    const locals = localBindings.get(name);
    if (locals !== undefined) {
        for (const entry of locals) {
            if (!isScopeChainPrefix(entry.scopeChain, scopeChain)) {
                continue;
            }
            // A later binding in the same scope — a redeclaration, a reassignment, or a shadow — wins,
            // so a local or parameter of the name reaches instead of the class it shadows.
            if (entry.scopeChain.length >= bestDepth) {
                bestDepth = entry.scopeChain.length;
                bestRef = entry.classRef;
            }
        }
    }
    return bestRef;
}

/**
 * The scope chain a `const`/`let`/`using` loop-header binding belongs to — the loop's own body — or
 * `undefined` when `keywordIndex` does not declare the variable of a `for`/`for await` header. A loop
 * variable binds only inside the loop, so it must not shadow the class in the enclosing block. Only a
 * braced body is modelled; an unbraced body is left at the declaration's own scope, which keeps the
 * read-back at the merge base's reading rather than deciding it either way.
 */
function loopBindingScopeChain(source: string, keywordIndex: number): number[] | undefined {
    const before = previousSignificantCharacter(source, keywordIndex - 1);
    if (before === undefined || source.charAt(before) !== '(') {
        return undefined;
    }
    let wordEnd = previousSignificantCharacter(source, before - 1);
    if (wordEnd === undefined || !isIdentifierContinue(source.charAt(wordEnd))) {
        return undefined;
    }
    let word = readWordBackward(source, wordEnd);
    if (word === 'await') {
        wordEnd = previousSignificantCharacter(source, wordEnd - word.length);
        word =
            wordEnd === undefined || !isIdentifierContinue(source.charAt(wordEnd))
                ? ''
                : readWordBackward(source, wordEnd);
    }
    if (word !== 'for') {
        return undefined;
    }
    const close = skipBalancedParens(source, before);
    if (close === undefined) {
        return undefined;
    }
    const body = skipWhitespace(source, close);
    return source[body] !== '{' ? undefined : enclosingScopeChain(source, body + 1);
}

/**
 * The class a `const`/`let`/`var <name> = …` declaration at `index` binds, resolved to a class body brace
 * for a `new <Class>()` or a `class { … }` initializer, or `undefined` for any other initializer that
 * shadows a declared class name. The binding is remembered under the name so a later read-back reaches
 * the same field a direct construction would, and a plain value shadows the class the name would
 * otherwise reach.
 */
function readLocalBindingAt(
    source: string,
    index: number,
    classFields: ReadonlyMap<number, ClassFieldsEntry>,
    localBindings: ReadonlyMap<string, readonly LocalInstance[]>
): { name: string; classRef: number | undefined; scopeChain: number[]; end: number } | undefined {
    const keyword = ['const', 'let', 'var', 'using'].find((candidate) => isKeywordAt(source, index, candidate));
    if (keyword === undefined) {
        return undefined;
    }
    const nameStart = skipWhitespace(source, index + keyword.length);
    const name = readWordForward(source, nameStart);
    if (name === undefined) {
        return undefined;
    }
    // `var` hoists its binding to the nearest function body; `const`/`let` bind in the block. The
    // chain is computed only once a binding is known, because `enclosingScopeChain` walks backward and
    // most `const`/`let`/`var` declarations bind no tracked name.
    const scopeChain = () =>
        keyword === 'var' ? varHoistScopeChain(source, index) : enclosingScopeChain(source, index);
    const cursor = skipWhitespace(source, nameStart + name.length);
    if (source[cursor] === '=' && source[cursor + 1] !== '=') {
        const exprStart = skipWhitespace(source, cursor + 1);
        if (isKeywordAt(source, exprStart, 'new')) {
            const classNameStart = skipWhitespace(source, exprStart + 3);
            const className = readWordForward(source, classNameStart);
            if (className === undefined) {
                return undefined;
            }
            // Resolving a name no class declares and no local reaches walks the enclosing scopes for
            // nothing; skip that walk unless a binding of the name exists, keeping `const x = new Map()`
            // cheap.
            if (!declaresClassName(classFields, className) && !localBindings.has(className)) {
                return undefined;
            }
            const chain = scopeChain();
            const classRef = resolveNameToClass(className, chain, classFields, localBindings);
            return classRef === undefined
                ? undefined
                : { name, classRef, scopeChain: chain, end: classNameStart + className.length };
        }
        if (isKeywordAt(source, exprStart, 'class')) {
            const open = classBodyOpenAfterClass(source, exprStart);
            if (open === undefined) {
                return undefined;
            }
            return { name, classRef: open, scopeChain: scopeChain(), end: exprStart };
        }
    }
    // A plain initializer, a `for (… of/in …)` binding, or a bare declaration binds the declared
    // class's name to something other than the class, shadowing it; anything else is not tracked.
    if (!declaresClassName(classFields, name)) {
        return undefined;
    }
    // `const`/`let`/`using` loop-header bindings take the loop's scope; `var` hoists to its function, so
    // it does not adopt the loop scope.
    const chain =
        keyword === 'const' || keyword === 'let' || keyword === 'using'
            ? (loopBindingScopeChain(source, index) ?? scopeChain())
            : scopeChain();
    return { name, classRef: undefined, scopeChain: chain, end: nameStart + name.length };
}

/**
 * A parameter the file binds under a declared class name at `index`, which shadows the class in the
 * parameter's function body, or `undefined` when `index` is not such a binding. A plain parameter and a
 * destructured parameter entry both bind their own name; an identifier inside a default value or a type
 * annotation does not. Only a name a class declares is worth recording, so the walks run for those names
 * alone.
 */
function readParameterShadowAt(
    source: string,
    index: number,
    classNames: { names: ReadonlySet<string>; firstChars: ReadonlySet<string> }
): { name: string; classRef: undefined; scopeChain: number[]; end: number } | undefined {
    if (classNames.names.size === 0) {
        return undefined;
    }
    const first = source[index];
    if (first === undefined || !classNames.firstChars.has(first)) {
        return undefined;
    }
    if (isIdentifierContinue(source[index - 1]) || !isIdentifierStart(first)) {
        return undefined;
    }
    const name = readWordForward(source, index);
    if (name === undefined || !classNames.names.has(name)) {
        return undefined;
    }
    if (isParameterOwnNameAt(source, index)) {
        return {
            name,
            classRef: undefined,
            scopeChain: functionBodyScopeChain(source, index),
            end: index + name.length,
        };
    }
    if (isDestructuredBindingNameAt(source, index, name.length)) {
        return {
            name,
            classRef: undefined,
            scopeChain: destructuredBindingScopeChain(source, index),
            end: index + name.length,
        };
    }
    return undefined;
}

/**
 * Whether the name at `index` is a destructured binding's own name — a shorthand property, an array
 * element, a renamed binding, or a rest target — rather than an identifier inside its default value or
 * a property key it only names. `isBindingPatternEntryAt` already placed `index` inside a `{`/`[`
 * binding pattern, so the token before the name decides: a `:` renames into it, a rest `...` binds it,
 * and a pattern opener or separator binds it unless a following `:` makes the name a key instead.
 */
function isDestructuredBindingNameAt(source: string, index: number, nameLength: number): boolean {
    if (!isBindingPatternEntryAt(source, index)) {
        return false;
    }
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined) {
        return false;
    }
    const character = source.charAt(before);
    if (character === ':') {
        return true;
    }
    if (character === '.') {
        return source.charAt(before - 1) === '.' && source.charAt(before - 2) === '.';
    }
    if (character === '{' || character === '[' || character === ',') {
        return source.charAt(skipWhitespace(source, index + nameLength)) !== ':';
    }
    return false;
}

/**
 * The outermost `{`/`[` opener of the binding pattern that holds `index`, walking up nested patterns, or
 * `undefined` when `index` sits in none. The outermost opener is the one whose preceding token is the
 * pattern's own introducer — `(`, `,`, or a `const`/`let`/`var` keyword — rather than a nested
 * `:`/`{`/`[` inside an enclosing pattern.
 */
function outermostBindingPatternOpen(source: string, index: number): number | undefined {
    let open = enclosingOpenerBefore(source, index, '{[');
    if (open === undefined) {
        return undefined;
    }
    while (true) {
        const beforeOpen = previousSignificantCharacter(source, open - 1);
        if (beforeOpen === undefined) {
            return open;
        }
        const character = source.charAt(beforeOpen);
        if (character !== ':' && character !== '{' && character !== '[') {
            return open;
        }
        const outer = enclosingOpenerBefore(source, open, '{[');
        if (outer === undefined) {
            return open;
        }
        open = outer;
    }
}

/**
 * The scope chain a destructured binding at `index` lives in. A destructured parameter binds in its own
 * function body, so the chain is taken there; a destructured variable (`const`/`let`/`var { … } = …`)
 * binds in the declaration's enclosing scope, with the pattern's own braces excluded so the binding
 * matches a read-back written in that same scope.
 */
function destructuredBindingScopeChain(source: string, index: number): number[] {
    const open = outermostBindingPatternOpen(source, index);
    if (open === undefined) {
        return enclosingScopeChain(source, index);
    }
    const beforeOpen = previousSignificantCharacter(source, open - 1);
    if (beforeOpen === undefined) {
        return enclosingScopeChain(source, index);
    }
    const character = source.charAt(beforeOpen);
    if (character === '(' || character === ',') {
        return functionBodyScopeChain(source, index);
    }
    // A declaration keyword (`const`/`let`/`var`/`using`) before the pattern may sit in a `for` header,
    // where the pattern's entries bind to the loop's scope like a plain loop variable. A `var` hoists to
    // its function instead, exactly as the plain-name path does.
    if (isIdentifierContinue(character)) {
        const keyword = readWordBackward(source, beforeOpen);
        const keywordStart = beforeOpen - keyword.length + 1;
        if (keyword === 'var') {
            return varHoistScopeChain(source, index);
        }
        const loop = loopBindingScopeChain(source, keywordStart);
        if (loop !== undefined) {
            return loop;
        }
    }
    return enclosingScopeChain(source, open - 1);
}

/**
 * A `function <Name>` declaration at `index` binds its name in the enclosing scope, which shadows a
 * class of that name there, or `undefined` when `index` is not such a declaration.
 */
function readFunctionShadowAt(
    source: string,
    index: number,
    classNames: { names: ReadonlySet<string>; firstChars: ReadonlySet<string> }
): { name: string; classRef: undefined; scopeChain: number[]; end: number } | undefined {
    if (classNames.names.size === 0) {
        return undefined;
    }
    const first = source[index];
    if (first === undefined || !classNames.firstChars.has(first)) {
        return undefined;
    }
    if (isIdentifierContinue(source[index - 1]) || !isIdentifierStart(first)) {
        return undefined;
    }
    const name = readWordForward(source, index);
    if (name === undefined || !classNames.names.has(name)) {
        return undefined;
    }
    if (declarationKeywordBefore(source, index) !== 'function') {
        return undefined;
    }
    return { name, classRef: undefined, scopeChain: enclosingScopeChain(source, index), end: index + name.length };
}

/**
 * The scope chain of the function body a parameter at `index` belongs to, so a parameter binds in its
 * own function rather than in the enclosing scope its name sits in. A parameter's name stands before the
 * body's `{`, so the chain is taken at the body, crossing the parameter list's `)` and an optional `=>`.
 */
function functionBodyScopeChain(source: string, index: number): number[] {
    let open: number | undefined;
    if (isBindingPatternEntryAt(source, index)) {
        const patternOpen = outermostBindingPatternOpen(source, index);
        open = patternOpen === undefined ? undefined : enclosingOpenerBefore(source, patternOpen, '(');
    }
    if (open === undefined) {
        open = enclosingOpenerBefore(source, index, '(');
    }
    if (open === undefined) {
        return enclosingScopeChain(source, index);
    }
    const close = skipBalancedParens(source, open);
    if (close === undefined) {
        return enclosingScopeChain(source, index);
    }
    let cursor = skipWhitespace(source, close);
    if (source.startsWith('=>', cursor)) {
        cursor = skipWhitespace(source, cursor + 2);
    }
    // A block body opens a real scope; an expression body has none, so the arrow's own parameter-list
    // position stands in as a synthetic scope the enclosing chain never contains.
    return source[cursor] !== '{'
        ? [...enclosingScopeChain(source, index), open]
        : enclosingScopeChain(source, cursor + 1);
}

/**
 * Whether the `{` at `open` opens a function body rather than a statement block, so a hoisted `var` knows
 * where to stop. A function body follows a parameter list's `)` or an arrow's `=>`; a control header's
 * `)` opens a block instead.
 */
function isFunctionBodyOpen(source: string, open: number): boolean {
    const before = previousSignificantCharacter(source, open - 1);
    if (before === undefined) {
        return false;
    }
    const character = source.charAt(before);
    if (character === '>') {
        return true;
    }
    return character === ')' && !closesControlHeader(source, before);
}

/** The scope chain a `var` binding hoists to: its nearest function body, dropping inner block braces. */
function varHoistScopeChain(source: string, index: number): number[] {
    const chain = enclosingScopeChain(source, index);
    const result: number[] = [];
    for (const open of chain) {
        if (isFunctionBodyOpen(source, open)) {
            result.push(open);
        }
    }
    return result;
}

/**
 * Whether the name at `index` is a parameter's own binding name, rather than an identifier inside its
 * default value or its type annotation. A binding name stands where a binding can start — after `(`, a
 * separator, a destructuring opener, a rest `...`, or a parameter modifier — so any type or expression
 * token before it (`|`, `&`, `keyof`, `typeof`, `extends`, `>`, `:`, `=`, …) marks a name it is not.
 */
function isParameterOwnNameAt(source: string, index: number): boolean {
    if (!isParameterListNameAt(source, index)) {
        return false;
    }
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined) {
        return true;
    }
    const character = source.charAt(before);
    if (character === '(' || character === ',' || character === '{' || character === '[') {
        return true;
    }
    if (character === '.') {
        return source.charAt(before - 1) === '.' && source.charAt(before - 2) === '.';
    }
    if (isIdentifierContinue(character)) {
        const word = readWordBackward(source, before);
        return word === 'public' || word === 'private' || word === 'protected' || word === 'readonly';
    }
    return false;
}

/**
 * The name an assignment at `index` rebinds — a `const`/`let`/`var` initializer that is anything but a
 * `new <Class>()`, or a later reassignment of a bound name — or `undefined` when `index` is not such a
 * binding target. A member assignment (`obj.h = …`) is not a binding, so the dot is excluded. The caller
 * records only names it already tracks as instances, so a nested redeclaration or a reassignment
 * shadows an outer instance instead of reaching it.
 */
function readLocalShadowAt(source: string, index: number): { name: string; end: number } | undefined {
    if (isIdentifierContinue(source[index - 1]) || !isIdentifierStart(source[index])) {
        return undefined;
    }
    const name = readWordForward(source, index);
    if (name === undefined) {
        return undefined;
    }
    const after = skipWhitespace(source, index + name.length);
    if (source[after] !== '=' || source[after + 1] === '=' || source[after + 1] === '>') {
        return undefined;
    }
    if (isPrecededByDotAccess(source, index)) {
        return undefined;
    }
    return { name, end: index + name.length };
}

/** Whether any class declaration carries the given name. */
function declaresClassName(classFields: ReadonlyMap<number, ClassFieldsEntry>, name: string): boolean {
    for (const entry of classFields.values()) {
        if (entry.name === name) {
            return true;
        }
    }
    return false;
}

/**
 * The `@` of the decorator immediately before `index` — a `@name`, `@ns.name`, `@name(args)`, `@(expr)`,
 * or any namespaced or call spelling of those — or `undefined` when no decorator precedes the keyword. A
 * decorator sits where a declaration modifier does, so it neither turns a declaration into an expression
 * nor hides the member it decorates.
 *
 * The walk closes over the shape rather than the spellings: a chain is a dotted name with a call group
 * after any of its segments, and `@(expr)` wraps the whole chain in a group of its own. Nothing else in
 * a declaration or member prefix ends in `)`, and a name that a `@` does not open is not a decorator.
 */
function decoratorOpenBefore(source: string, index: number): number | undefined {
    let cursor = previousSignificantCharacter(source, index - 1);
    while (cursor !== undefined) {
        if (source.charAt(cursor) === '@') {
            return cursor;
        }
        if (source.charAt(cursor) === ')') {
            const open = matchingOpenDelimiterBackward(source, cursor, '(', ')');
            if (open === undefined) {
                return undefined;
            }
            cursor = previousSignificantCharacter(source, open - 1);
            continue;
        }
        if (!isIdentifierContinue(source.charAt(cursor))) {
            return undefined;
        }
        const word = readWordBackward(source, cursor);
        const before = previousSignificantCharacter(source, cursor - word.length);
        if (before === undefined) {
            return undefined;
        }
        if (source.charAt(before) === '@') {
            return before;
        }
        // A `.` parts a segment off the name and the name before it continues the chain; any other
        // token before the name leaves the walk with no `@` to return, so no decorator opens here.
        if (source.charAt(before) !== '.') {
            return undefined;
        }
        cursor = previousSignificantCharacter(source, before - 1);
    }
    return undefined;
}

/**
 * The position after the decorator opening at the `@` at `start` — the same segment chain
 * `decoratorOpenBefore` walks, read forward — or `undefined` when no decorator opens there. A caller
 * then skips the member the decorator decorates from the position this returns.
 */
function skipDecoratorAt(source: string, start: number): number | undefined {
    const nameStart = skipWhitespace(source, start + 1);
    const name = readWordForward(source, nameStart);
    if (name === undefined) {
        // `@(expr)` decorates with the whole group, which is the chain's first and only segment when no
        // name follows the `@`.
        const group = skipBalancedParens(source, nameStart);
        return group === undefined ? undefined : skipWhitespace(source, group);
    }
    let cursor = skipWhitespace(source, nameStart + name.length);
    // The rest of the chain is a call group after any of its segments and any segment a `.` parts off.
    while (true) {
        if (source[cursor] === '(') {
            const afterGroup = skipBalancedParens(source, cursor);
            if (afterGroup === undefined) {
                return undefined;
            }
            cursor = skipWhitespace(source, afterGroup);
            continue;
        }
        if (source[cursor] !== '.') {
            return cursor;
        }
        const segmentStart = skipWhitespace(source, cursor + 1);
        const segment = readWordForward(source, segmentStart);
        if (segment === undefined) {
            return undefined;
        }
        cursor = skipWhitespace(source, segmentStart + segment.length);
    }
}

/**
 * Whether the `class` keyword at `index` stands in statement position, and so declares its name in the
 * enclosing scope, rather than in expression position (`= class`, `(class`, `[class`, `, class`), where
 * the name is bound only inside the expression. Statement boundaries, the declaration modifiers, and a
 * decorator admit a declaration; anything else leaves the keyword an expression.
 */
function isClassDeclarationPosition(source: string, index: number): boolean {
    if (decoratorOpenBefore(source, index) !== undefined) {
        return true;
    }
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined) {
        return true;
    }
    const character = source.charAt(before);
    if (character === ';' || character === '{' || character === '}') {
        return true;
    }
    if (!isIdentifierContinue(character)) {
        return false;
    }
    const word = readWordBackward(source, before);
    return word === 'export' || word === 'default' || word === 'abstract' || word === 'declare';
}

/**
 * The `{` that opens the body of the `class` declaration or expression whose keyword starts at
 * `keywordStart`, or `undefined` when no body follows. The walk crosses the name and type-parameter list
 * (both absent for an anonymous expression), then balances parentheses, brackets, braces, and angle
 * brackets in the heritage clause — skipping the `=>` arrow so its `>` is not read as a closer — until
 * the body `{` at depth zero.
 */
function classBodyOpenAfterClass(source: string, keywordStart: number): number | undefined {
    let cursor = skipWhitespace(source, keywordStart + 'class'.length);
    const name = readWordForward(source, cursor);
    if (name !== undefined) {
        cursor = skipWhitespace(source, cursor + name.length);
        if (source[cursor] === '<') {
            const after = skipTypeArguments(source, cursor, source.length);
            if (after === undefined) {
                return undefined;
            }
            cursor = skipWhitespace(source, after);
        }
    }
    let depth = 0;
    while (cursor < source.length) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = commentEnd;
            continue;
        }
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, source.length, new Set());
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            continue;
        }
        if (character === '{') {
            if (depth === 0) {
                return cursor;
            }
            depth += 1;
        } else if (character === '}') {
            if (depth > 0) {
                depth -= 1;
            }
        } else if (character === '(' || character === '[' || character === '<') {
            depth += 1;
        } else if (character === ')' || character === ']' || character === '>') {
            if (depth > 0) {
                depth -= 1;
            }
        }
        cursor += 1;
    }
    return undefined;
}

/**
 * Whether the class body member at `index` is written with a unicode escape — `\u006c` at any position
 * in the name, in the `\uXXXX` or `\u{XX}` form. The escape is the character it names rather than the
 * characters it is spelled with, so a name the reader cannot read exactly is not a name it may
 * conclude from.
 */
function memberNameWrittenWithEscape(source: string, index: number, end: number): boolean {
    let cursor = index;
    while (cursor < end) {
        if (source[cursor] === '\\' && source[cursor + 1] === 'u') {
            return true;
        }
        if (!isIdentifierContinue(source[cursor])) {
            break;
        }
        cursor += 1;
    }
    return false;
}

/**
 * Records the name of every own instance member — a field, method, or accessor — the class body `open`
 * opens, into the class's `members` set, so a subclass that declares its own member of a name shadows
 * the parent's field of the same name when a read-back resolves it. Static members live on the
 * constructor and are not recorded, matching a read-back that only reads an instance. The scan walks
 * the body's top level, skipping method bodies and field initializers so their locals cannot read as
 * members, and a member whose name it cannot read exactly is skipped whole rather than read at the
 * member that follows it.
 */
function recordClassMembers(source: string, classFields: Map<number, ClassFieldsEntry>, open: number): void {
    const entry = classEntryFromOpen(source, classFields, open);
    const close = skipBalancedDelimited(source, open, source.length, '{', '}');
    if (close === undefined) {
        return;
    }
    let cursor = open + 1;
    while (cursor < close - 1) {
        cursor = skipClassBodyTrivia(source, cursor, close - 1);
        if (cursor >= close - 1) {
            return;
        }
        // A decorator is outside the model, so the class's members are unreliable: mark it unmodelled
        // and skip the member it decorates whole, from the name the decorator's chain ends at.
        if (source[cursor] === '@') {
            entry.unmodelled = true;
            const memberStart = skipDecoratorAt(source, cursor);
            if (memberStart === undefined) {
                cursor += 1;
                continue;
            }
            cursor = readClassMemberHead(source, memberStart, close - 1)?.next ?? memberStart;
            continue;
        }
        if (source[cursor] === '[') {
            const computed = readComputedMemberName(source, cursor, close - 1);
            if (computed !== undefined) {
                entry.members.add(computed.name);
                cursor = computed.next;
                continue;
            }
            // A computed name the reader cannot spell out — a variable, a concatenation, an
            // interpolated template, or a literal written with an escape — is outside the model, so the
            // class's members are unreliable: mark it unmodelled and skip the member whole.
            entry.unmodelled = true;
            cursor = skipClassBodyRegion(source, cursor, close - 1);
            continue;
        }
        // A member name written with a unicode escape is a name the reader cannot read exactly, so the
        // class's members are unreliable: mark it unmodelled and skip the member whole.
        if (memberNameWrittenWithEscape(source, cursor, close - 1)) {
            entry.unmodelled = true;
            cursor = skipClassBodyRegion(source, cursor, close - 1);
            continue;
        }
        const head = readClassMemberHead(source, cursor, close - 1);
        if (head === undefined) {
            cursor = skipClassBodyRegion(source, cursor, close - 1);
            continue;
        }
        // A static block `static { … }` is outside the model, so the class's members are unreliable:
        // mark it unmodelled and skip the block whole.
        if (head.name === 'static' && source[head.afterName] === '{') {
            entry.unmodelled = true;
            cursor = skipClassBodyRegion(source, head.afterName, close - 1);
            continue;
        }
        if (!head.static && !head.isDeclare) {
            entry.members.add(head.name);
        }
        if (head.name === 'constructor') {
            recordConstructorParameterProperties(source, entry, head.afterName);
        }
        cursor = head.next;
    }
}

/**
 * Records the name of every parameter property a constructor's parameter list declares —
 * `constructor(public loader = require) {}` binds an own instance field of that name — into the class's
 * `members` set, so it shadows a parent's field of the same name. The parameter's value is read by the
 * binding pass exactly as a field's is; a parameter property with no initializer is an own member with
 * no value.
 */
function recordConstructorParameterProperties(source: string, entry: ClassFieldsEntry, afterName: number): void {
    if (source[afterName] !== '(') {
        return;
    }
    const close = skipBalancedParens(source, afterName);
    if (close === undefined) {
        return;
    }
    let cursor = afterName + 1;
    while (cursor < close - 1) {
        cursor = skipClassBodyTrivia(source, cursor, close - 1);
        if (cursor >= close - 1) {
            return;
        }
        const nameStart = parameterNameStartAfterModifiers(source, cursor);
        if (nameStart !== undefined) {
            const name = readWordForward(source, nameStart);
            if (name !== undefined) {
                entry.members.add(name);
            }
        }
        cursor = skipBalancedParameter(source, cursor, close - 1);
    }
}

/**
 * The name after the run of parameter modifiers standing at `cursor` — `public`, `private`,
 * `protected`, `readonly`, `override` — or `undefined` when no modifier stands there, so the caller
 * knows the parameter is bare and declares no property.
 */
function parameterNameStartAfterModifiers(source: string, cursor: number): number | undefined {
    let start = cursor;
    let hasModifier = false;
    while (true) {
        const word = readWordForward(source, start);
        if (word === undefined || !PARAMETER_MODIFIERS.has(word)) {
            break;
        }
        hasModifier = true;
        start = skipWhitespace(source, start + word.length);
    }
    return hasModifier ? start : undefined;
}

/**
 * Skips one constructor parameter at `cursor` to the `,` that ends it or to `end`, crossing a
 * parenthesised group, an array or object binding pattern, and a string, template, or comment whole. A
 * `<` and a `>` in a default are value comparisons rather than generic brackets — `a = b < c` opens no
 * level — so they nest nothing and the `,` after them still ends the parameter.
 */
function skipBalancedParameter(source: string, cursor: number, end: number): number {
    let depth = 0;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = commentEnd;
            continue;
        }
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            depth += 1;
        } else if (character === ')' || character === ']' || character === '}') {
            if (depth > 0) {
                depth -= 1;
            }
        } else if (character === ',' && depth === 0) {
            return cursor + 1;
        }
        cursor += 1;
    }
    return end;
}

/**
 * The name a string- or template-literal computed member `['name']`, `["name"]`, or ``[`name`]``
 * declares, with the position after the member, or `undefined` when the `[` at `open` opens an index
 * signature, a literal the reader does not decode, or a computed expression the scanner does not
 * resolve. Only a literal names a property exactly, so it is the one computed spelling that shadows the
 * parent's field of that name.
 */
function readComputedMemberName(source: string, open: number, end: number): { name: string; next: number } | undefined {
    const contentStart = skipWhitespace(source, open + 1);
    const quote = source[contentStart];
    let value: ReadSpecifier | undefined;
    if (quote === "'" || quote === '"') {
        value = readQuotedValue(source, contentStart, quote);
    } else if (quote === '`') {
        value = readStaticTemplateValue(source, contentStart);
    } else {
        return undefined;
    }
    if (value === undefined) {
        return undefined;
    }
    // A literal the reader does not decode names a property it cannot spell out, so it declines the
    // name exactly as it declines a computed expression it does not resolve.
    if (source.slice(contentStart, value.end).includes('\\')) {
        return undefined;
    }
    const afterBracket = skipWhitespace(source, value.end);
    if (source[afterBracket] !== ']') {
        return undefined;
    }
    const afterName = skipWhitespace(source, afterBracket + 1);
    const next =
        source[afterName] === '(' || source[afterName] === '<' || source[afterName] === '?'
            ? skipClassMethodMember(source, afterName, end)
            : skipClassFieldMember(source, afterName, end);
    return { name: value.value, next };
}

/** Whitespace, comments, and the separators that can stand between class body members. */
function skipClassBodyTrivia(source: string, cursor: number, end: number): number {
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (
            character !== undefined &&
            (isWhiteSpace(character) || isLineTerminator(character) || character === ';' || character === ',')
        ) {
            cursor += 1;
            continue;
        }
        break;
    }
    return cursor;
}

/** The modifiers a class member name may carry in front of it. */
const CLASS_MEMBER_MODIFIERS: ReadonlySet<string> = new Set([
    'static',
    'public',
    'private',
    'protected',
    'readonly',
    'abstract',
    'override',
    'declare',
    'accessor',
    'async',
    'get',
    'set',
]);

/**
 * The name a class body member declares at `start`, with whether it is static, whether `declare` marks it
 * type-only, the position right after the name, and the position after the member, or `undefined` when
 * `start` does not begin a plain named member (a computed member, an index signature, a decorator, or a
 * stray token).
 */
function readClassMemberHead(
    source: string,
    start: number,
    end: number
): { name: string; static: boolean; isDeclare: boolean; afterName: number; next: number } | undefined {
    let cursor = start;
    let isStatic = false;
    let isDeclare = false;
    while (cursor < end) {
        const word = readWordForward(source, cursor);
        if (word === undefined || !CLASS_MEMBER_MODIFIERS.has(word)) {
            break;
        }
        const afterWord = skipWhitespace(source, cursor + word.length);
        // A modifier is only a modifier when a member name follows it; otherwise the word itself is the
        // member name — a field or method literally named `get`, `set`, `async`, `readonly`, `accessor`,
        // `override`, or `declare` (#4835).
        if (!isClassMemberNameStart(source[afterWord])) {
            break;
        }
        if (word === 'static') {
            isStatic = true;
        }
        if (word === 'declare') {
            isDeclare = true;
        }
        cursor = afterWord;
    }
    if (source[cursor] === '*') {
        cursor = skipWhitespace(source, cursor + 1);
    }
    const name = readWordForward(source, cursor);
    if (name === undefined) {
        return undefined;
    }
    const afterName = skipWhitespace(source, cursor + name.length);
    if (source[afterName] === '(' || source[afterName] === '<' || source[afterName] === '?') {
        return {
            name,
            static: isStatic,
            isDeclare,
            afterName,
            next: skipClassMethodMember(source, afterName, end),
        };
    }
    return { name, static: isStatic, isDeclare, afterName, next: skipClassFieldMember(source, afterName, end) };
}

/** Whether the character at `index` can begin a class member name. */
function isClassMemberNameStart(character: string | undefined): boolean {
    return isIdentifierStart(character) || character === '*' || character === '[' || character === '#';
}

/** Skips a method signature and body from the `(`, `<`, or `?` after the method name. */
function skipClassMethodMember(source: string, cursor: number, end: number): number {
    if (source[cursor] === '<') {
        const after = skipTypeArguments(source, cursor, end);
        if (after === undefined) {
            return end;
        }
        cursor = skipWhitespace(source, after);
    }
    if (source[cursor] === '?') {
        cursor = skipWhitespace(source, cursor + 1);
    }
    if (source[cursor] === '(') {
        const after = skipBalancedParens(source, cursor);
        if (after === undefined) {
            return end;
        }
        cursor = after;
    }
    const body = skipUntilMethodBody(source, cursor, end);
    if (body >= end) {
        return end;
    }
    if (source[body] === ';') {
        return body + 1;
    }
    const afterBody = skipBalancedDelimited(source, body, end, '{', '}');
    return afterBody === undefined ? end : afterBody;
}

/** Skips a method's return type and modifiers to its body `{` or its terminating `;`. */
function skipUntilMethodBody(source: string, cursor: number, end: number): number {
    let depth = 0;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character !== undefined && (isWhiteSpace(character) || isLineTerminator(character))) {
            cursor += 1;
            continue;
        }
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = Math.min(regexEnd, end);
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            continue;
        }
        if (character === '(' || character === '[' || character === '<') {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === ')' || character === ']' || character === '>') {
            if (depth > 0) {
                depth -= 1;
            }
            cursor += 1;
            continue;
        }
        if (character === '{') {
            if (depth === 0) {
                return cursor;
            }
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === '}') {
            if (depth > 0) {
                depth -= 1;
            }
            cursor += 1;
            continue;
        }
        if (depth === 0 && character === ';') {
            return cursor;
        }
        cursor += 1;
    }
    return end;
}

/**
 * The `=` a field initializer opens after a member name, crossing an optional `?` or `!` marker and an
 * optional `: Type` annotation, or `undefined` when no initializer follows. A `:` opens a type
 * annotation whose type is skipped in full, so an object, conditional, or generic type cannot hide the
 * initializer (#4835).
 */
function fieldEqualsAfter(source: string, cursor: number, end: number): number | undefined {
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] === '?' || source[cursor] === '!') {
        cursor = skipWhitespace(source, cursor + 1);
    }
    if (source[cursor] === ':') {
        cursor = skipTypeExpression(source, cursor + 1, end);
        cursor = skipWhitespace(source, cursor);
    }
    return source[cursor] === '=' && source[cursor + 1] !== '=' && source[cursor + 1] !== '>' ? cursor : undefined;
}

/** Skips a field's type annotation and initializer to the next `;` or `,` at the class body's top level. */
function skipClassFieldMember(source: string, cursor: number, end: number): number {
    let depth = 0;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = Math.min(regexEnd, end);
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            continue;
        }
        if (character === '(' || character === '[' || character === '{' || character === '<') {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === ')' || character === ']' || character === '}' || character === '>') {
            if (depth > 0) {
                depth -= 1;
                cursor += 1;
                continue;
            }
            if (character === '}') {
                return cursor;
            }
            cursor += 1;
            continue;
        }
        if (depth === 0 && (character === ';' || character === ',')) {
            return cursor + 1;
        }
        cursor += 1;
    }
    return end;
}

/** Skips one balanced region or a private name at `cursor`, so a computed member, an index signature, or a private field is crossed. */
function skipClassBodyRegion(source: string, cursor: number, end: number): number {
    const character = source[cursor];
    if (character === '(' || character === '[' || character === '{' || character === '<') {
        const closer = matchingTypeDelimiter(character);
        const after = skipBalancedDelimited(source, cursor, end, character, closer);
        return after === undefined ? end : after;
    }
    if (character === '#') {
        const name = readWordForward(source, cursor + 1);
        return name === undefined ? cursor + 1 : cursor + 1 + name.length;
    }
    return cursor + 1;
}

/**
 * The index of the `{` that opens the class body of the constructor whose parameter property stands at
 * `index`, or `undefined` when the name carries no parameter modifier, sits in a list that is not a
 * constructor's, or belongs to something that is not a class. A parameter property binds an own
 * instance field, so the read-back resolves it against that class exactly as a field is.
 */
function classParameterPropertyOwnerOpen(source: string, index: number): number | undefined {
    const name = readWordForward(source, index);
    if (name === undefined) {
        return undefined;
    }
    // The modifier run stands before the name, so the walk back from the name's own start reaches the
    // run's first modifier; no modifier there leaves the parameter bare, and it binds no property.
    if (parameterModifiersStartBefore(source, index - 1) === undefined) {
        return undefined;
    }
    const open = enclosingOpenerBefore(source, index, '(');
    if (open === undefined) {
        return undefined;
    }
    const nameEnd = previousSignificantCharacter(source, open - 1);
    if (nameEnd === undefined) {
        return undefined;
    }
    const constructorName = readWordBackward(source, nameEnd);
    if (constructorName !== 'constructor' || isPrecededByDotAccess(source, nameEnd - constructorName.length + 1)) {
        return undefined;
    }
    const bodyOpen = enclosingBraceOpen(source, open);
    if (bodyOpen === undefined) {
        return undefined;
    }
    const header = classLikeBodyKeywordBefore(source, bodyOpen);
    return header !== undefined && header.keyword === 'class' ? bodyOpen : undefined;
}

/**
 * The index of the `{` that opens the class body holding the member at `index`, or `undefined` when the
 * member sits in an interface, a type literal, or a body that is not a class. An interface and a type
 * literal hold no field initializer, so only a class body can declare the field the read-back resolves.
 */
function classFieldOwnerOpen(source: string, index: number): number | undefined {
    const open = enclosingBraceOpen(source, index);
    if (open === undefined) {
        return undefined;
    }
    const header = classLikeBodyKeywordBefore(source, open);
    return header !== undefined && header.keyword === 'class' ? open : undefined;
}

/** Whether the member at `index` is declared `static`, and so sits on the constructor rather than on instances. */
function isStaticClassField(source: string, index: number): boolean {
    const before = previousSignificantCharacter(source, index - 1);
    if (before === undefined || !isIdentifierContinue(source[before])) {
        return false;
    }
    return readWordBackward(source, before) === 'static';
}

/** Whether the use at `index` is a class field name — a property the class declares, never a local use. */
function isClassFieldNameAt(source: string, index: number, nameLength: number): boolean {
    if (!isMemberInsideClassLikeBody(source, index)) {
        return false;
    }
    const after = skipWhitespace(source, index + nameLength);
    if (source[after] === '=') {
        return source[after + 1] !== '=' && source[after + 1] !== '>';
    }
    // A field's name is followed by an annotation `:`, an optional `?`, or a definite `!`, even when it
    // carries no initializer — a `declare` field included.
    return source[after] === ':' || source[after] === '?' || source[after] === '!';
}

/**
 * The name a value `import { createRequire as <name> } from '…'` clause at `index` binds, if any. Only
 * a value import binds a local name: the keyword must be `import`, `export { … } from` re-exports
 * without binding anything, `import type { … }` imports a type, and an inline `type` specifier names a
 * type. Reading any of those as a value binding turned a call through a name no local binding reaches —
 * `export { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');` — into a load
 * of `./hidden`, which the merge base never collected (#4828).
 */
function readCreateRequireImportAlias(source: string, index: number): LoaderBinding | undefined {
    if (!isKeywordAt(source, index, 'import')) {
        return undefined;
    }
    const open = skipWhitespace(source, index + 6);
    if (source[open] !== '{' || isKeywordAt(source, open, 'type')) {
        return undefined;
    }
    const close = source.indexOf('}', open + 1);
    if (close === -1) {
        return undefined;
    }
    const clause = source.slice(open + 1, close);
    // A specifier starts at the clause's start or after a separator, so a quoted name or another
    // specifier's text cannot be read as this one; the `type` in front makes the specifier type-only.
    const match = /(?:^|[,{\s])(type\s+)?createRequire\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(clause);
    const name = match?.[2];
    if (
        match === null ||
        match[1] !== undefined ||
        name === undefined ||
        !isKeywordAt(source, skipWhitespace(source, close + 1), 'from')
    ) {
        return undefined;
    }
    return {
        name,
        kind: 'createRequire',
        nameIndex: open + 1 + match.index + match[0].length - name.length,
        end: close + 1,
    };
}

type BoundCallee = {
    kind: LoaderBindingKind;
    calleeIndex: number;
    callOpen: number;
    declarationCandidate: boolean;
};

/**
 * The loader a call at `index` reaches through a wrapped or bound callee: a parenthesised or
 * comma-sequence `require` — `(require)(spec)`, `(0, require)(spec)`, and each further regrouping of
 * those (`((require))(spec)`) — or a name the binding pass resolved. A parenthesis that does not start
 * the callee expression is the enclosing call's argument list, so `pass(require)(spec)` is not this
 * shape, and only whole groupings are stripped, so `(f(require))(spec)` reaches no loader either.
 * `callOpen` is the parenthesis that holds the specifier, the second call for a bound `createRequire`
 * factory. The left identifier boundary keeps a name merely ending in a bound name (`download(spec)`)
 * out of the rule, and a member call (`registry.load(spec)`) is not the binding. The parenthesised
 * operand is the loader whatever the file declares: the declaration stops the binding pass, never
 * this callee.
 */
function readBoundCallee(source: string, index: number, bindings: LoaderRead): BoundCallee | undefined {
    if (source[index] === '(') {
        if (!startsCalleeExpression(source, index)) {
            return undefined;
        }
        const close = skipBalancedParens(source, index);
        if (close === undefined) {
            return undefined;
        }
        const operand = groupingOperandBounds(source, index + 1, close - 1);
        if (!isBareRequireOperand(source, operand.start, operand.end)) {
            return undefined;
        }
        const callOpen = callOpenAfter(source, close);
        // A parenthesised callee is no declaration name, so its parenthesised list is always a call.
        return callOpen === undefined
            ? undefined
            : { kind: 'require', calleeIndex: index + 1, callOpen, declarationCandidate: false };
    }
    if (!isIdentifierContinue(source[index]) || isIdentifierContinue(source[index - 1])) {
        return undefined;
    }
    const name = readWordForward(source, index);
    if (name === undefined) {
        return undefined;
    }
    const kind = bindings.names.get(name);
    if (kind === undefined || isPrecededByDotAccess(source, index)) {
        return undefined;
    }
    const callOpen = callOpenAfter(source, index + name.length);
    if (callOpen === undefined) {
        return undefined;
    }
    if (kind === 'require') {
        return { kind, calleeIndex: index, callOpen, declarationCandidate: true };
    }
    const factoryCallEnd = skipBalancedParens(source, callOpen);
    const specifierCallOpen = factoryCallEnd === undefined ? undefined : callOpenAfter(source, factoryCallEnd);
    return specifierCallOpen === undefined
        ? undefined
        : { kind, calleeIndex: index, callOpen: specifierCallOpen, declarationCandidate: false };
}

/** Whether the parenthesised region from `start` to the `)` at `end` is `require` or `0, require`. */
function isBareRequireOperand(source: string, start: number, end: number): boolean {
    let cursor = skipWhitespace(source, start);
    if (source[cursor] === '0') {
        cursor = skipWhitespace(source, cursor + 1);
        if (source[cursor] !== ',') {
            return false;
        }
        cursor = skipWhitespace(source, cursor + 1);
    }
    return isKeywordAt(source, cursor, 'require') && skipWhitespace(source, cursor + 7) === end;
}

/**
 * The operand a parenthesised callee wraps, with the grouping parentheses around it stripped:
 * `((require))(spec)` reaches the loader exactly as `(require)(spec)` does, and each further pair is
 * one more grouping. A parenthesis whose `)` does not end the region is part of the operand instead
 * (`(f(require))(spec)`), so only whole groups are stripped. `end` is the index of the region's own
 * `)`, which is the bound `isBareRequireOperand` compares against.
 */
function groupingOperandBounds(source: string, start: number, end: number): { start: number; end: number } {
    let from = skipWhitespace(source, start);
    let to = end;
    while (source[from] === '(') {
        const innerClose = skipBalancedParens(source, from);
        if (innerClose === undefined || skipWhitespace(source, innerClose) !== to) {
            break;
        }
        to = innerClose - 1;
        from = skipWhitespace(source, from + 1);
    }
    return { start: from, end: to };
}

/**
 * Whether the `(` at `open` begins a callee expression rather than continuing one. After an
 * identifier, a `)`, a `]`, or a `#` the parenthesis is an argument list or a member call — so
 * `pass(require)('./hidden')` wraps the *argument*, not the callee, and reading it as a wrapped
 * `require` refuses an ordinary call. Only a `(` at the start of a callee expression, or after an
 * operator, keeps the merge base's wrapped-callee reading.
 */
function startsCalleeExpression(source: string, open: number): boolean {
    const before = previousSignificantCharacter(source, open - 1);
    if (before === undefined) {
        return true;
    }
    const character = source.charAt(before);
    return !isIdentifierContinue(character) && character !== ')' && character !== ']' && character !== '#';
}

/** The index of the `(` a call opens at or after `from`, through an optional `?.`, if any. */
function callOpenAfter(source: string, from: number): number | undefined {
    let cursor = skipWhitespace(source, from);
    if (source.startsWith('?.', cursor) && source[skipWhitespace(source, cursor + 2)] === '(') {
        cursor = skipWhitespace(source, cursor + 2);
    }
    return source[cursor] === '(' ? cursor : undefined;
}

/** The identifier starting at `index`, or `undefined` when no identifier starts there. */
function readWordForward(source: string, index: number): string | undefined {
    if (!isIdentifierStart(source[index])) {
        return undefined;
    }
    let cursor = index + 1;
    while (cursor < source.length && isIdentifierContinue(source[cursor])) {
        cursor += 1;
    }
    return source.slice(index, cursor);
}

/**
 * Whether `character` starts an identifier. Every walk asks this at every position it crosses, so the
 * character codes answer it where a regular expression would dominate a large scan.
 */
function isIdentifierStart(character: string | undefined): boolean {
    if (character === undefined) {
        return false;
    }
    const code = character.charCodeAt(0);
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 36;
}

function readComputedDynamicLoad(source: string, index: number, bindings: LoaderRead): ComputedDynamicLoad | undefined {
    if (isKeywordAt(source, index, 'import') && !isPrecededByDotAccess(source, index)) {
        const afterKeyword = skipWhitespace(source, index + 6);
        if (source[afterKeyword] === '(') {
            return computedDynamicLoad(source, afterKeyword, COMPUTED_DYNAMIC_IMPORT_SHAPE, index, true);
        }
        return undefined;
    }
    if (isKeywordAt(source, index, 'require') && !isPrecededByDotAccess(source, index)) {
        let cursor = skipWhitespace(source, index + 7);
        if (source[cursor] === '.') {
            const afterDot = skipWhitespace(source, cursor + 1);
            if (isKeywordAt(source, afterDot, 'resolve')) {
                cursor = afterDot + 7;
            }
        } else if (source.startsWith('?.', cursor)) {
            const afterDot = skipWhitespace(source, cursor + 2);
            if (isKeywordAt(source, afterDot, 'resolve')) {
                cursor = afterDot + 7;
            }
        }
        cursor = skipWhitespace(source, cursor);
        if (source.startsWith('?.', cursor) && source[skipWhitespace(source, cursor + 2)] === '(') {
            cursor = skipWhitespace(source, cursor + 2);
        }
        if (source[cursor] === '(') {
            return computedDynamicLoad(source, cursor, COMPUTED_REQUIRE_SHAPE, index, true);
        }
        return undefined;
    }
    if (isKeywordAt(source, index, 'createRequire') && !isPrecededByDotAccess(source, index)) {
        const afterKeyword = skipWhitespace(source, index + 13);
        if (source[afterKeyword] === '(') {
            const afterFirstCall = skipBalancedParens(source, afterKeyword);
            if (afterFirstCall !== undefined) {
                let secondCallCursor = skipWhitespace(source, afterFirstCall);
                if (
                    source.startsWith('?.', secondCallCursor) &&
                    source[skipWhitespace(source, secondCallCursor + 2)] === '('
                ) {
                    secondCallCursor = skipWhitespace(source, secondCallCursor + 2);
                }
                if (source[secondCallCursor] === '(') {
                    return computedDynamicLoad(source, secondCallCursor, COMPUTED_CREATE_REQUIRE_SHAPE, index, false);
                }
            }
        }
        return undefined;
    }
    const bound = readBoundCallee(source, index, bindings);
    if (bound === undefined) {
        return undefined;
    }
    return computedDynamicLoad(
        source,
        bound.callOpen,
        bound.kind === 'require' ? COMPUTED_REQUIRE_SHAPE : COMPUTED_CREATE_REQUIRE_SHAPE,
        bound.calleeIndex,
        bound.declarationCandidate
    );
}

function computedDynamicLoad(
    source: string,
    openParen: number,
    shape: string,
    keywordIndex: number,
    declarationCandidate: boolean
): ComputedDynamicLoad | undefined {
    const callEnd = endOfBalancedCall(source, openParen);
    const contentEnd = callEnd - 1;
    // `import` and `require` can also name a declaration — a function, method, or parameter — in
    // which case the parenthesized list is a parameter list and no module load follows.
    // `createRequire(...)(...)` cannot: its second call is always a load. The declaration context
    // that decides is described on `isParameterListRegion`.
    if (declarationCandidate && isParameterListRegion(source, keywordIndex, openParen + 1, contentEnd, callEnd)) {
        return undefined;
    }
    // The specifier is static only when a string or static-template literal is the whole first
    // argument — the argument list's `)` or an argument-level `,` follows it, optionally through
    // grouping parentheses and `as`/`satisfies` casts. Anything after the literal that is not one
    // of those (an operator, member access, call, or concatenation) is computed.
    if (staticSpecifierEnd(source, openParen + 1, contentEnd) !== undefined) {
        return undefined;
    }
    return { shape, end: callEnd };
}

function isParameterListRegion(
    source: string,
    keywordIndex: number,
    start: number,
    end: number,
    afterParen: number
): boolean {
    // A `{` body or a `:` return type right after the closing parenthesis marks the list as a
    // declaration only when the enclosing construct is a declaration — the token before the name is
    // `function`, a method position, or a parameter position. The next token alone does not decide:
    // `flag ? require(spec) : undefined`, `case require(spec):`, `class X extends require(spec) {}`,
    // and `require(spec)\n{ … }` all close the parenthesis with `{` or `:` and are calls, and
    // `isDeclarationContext` reads the name's position to refuse them.
    const afterClose = skipWhitespace(source, afterParen);
    if (source[afterClose] === '{' || source[afterClose] === ':') {
        return isDeclarationContext(source, keywordIndex);
    }
    // An annotated parameter list is still recognized even when no body or return type follows it
    // (for example an ambient overload `declare function require(name: string);`).
    return isAnnotatedParameterListRegion(source, start, end);
}

/**
 * Modifiers that can precede a declaration name. A modifier is skipped while walking back from the
 * name so the enclosing construct — `function`, `{`, `(`, or `,` — decides the declaration, never the
 * modifier alone: `static require(...)` is a method, but `case require(x):` and `default require(x)`
 * stay calls because `case` and `default` are not modifiers.
 */
const DECLARATION_MODIFIERS: ReadonlySet<string> = new Set([
    'static',
    'async',
    'public',
    'protected',
    'private',
    'abstract',
    'readonly',
    'get',
    'set',
    'override',
    'declare',
]);

function isDeclarationContext(source: string, keywordIndex: number): boolean {
    // The name is declared when the token before it is `function` (a function declaration), `{` (a
    // method in a class, object, or type body), or `(` / `,` (a parameter whose type is a call
    // signature). A modifier or a generator asterisk before the name is skipped so the enclosing
    // construct decides, never the modifier alone. Anything else — `?`, `case`, `extends`, a
    // statement boundary — leaves the token a callee, so the parenthesized list is a call.
    //
    // A later member is preceded by `}` (the previous method's body) or `;` (the previous member),
    // not by the body's `{`, so the one-token look refuses it. The enclosing construct decides
    // instead: a `}`/`;`-preceded name inside a class, interface, or type-literal body is a member
    // declaration whatever precedes it, while the same name in a statement block stays a call. A `{`
    // admits a member only where it opens such a body or an object literal; a brace a statement block
    // provably opens (`function load() { require(spec)\n{ … } }`) leaves the name a call (#4835). A
    // brace after a `:` or an `=>` stays undecided: a labeled block, a type literal at an annotation
    // or return type, and an arrow body all put a member there, and the token alone cannot separate
    // them from an object literal, so each keeps the merge base's reading.
    let cursor = keywordIndex - 1;
    // A decorator `@ns.dec(...)` before the name is skipped whole, so the construct before it decides
    // whether the name is a member rather than the decorator's tail reading as a non-modifier token.
    const decoratorStart = decoratorOpenBefore(source, keywordIndex);
    if (decoratorStart !== undefined) {
        cursor = decoratorStart - 1;
    }
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return false;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return false;
            }
            cursor = open - 1;
            continue;
        }
        // A `//` comment's last character is not a token: `flag ? // {` would otherwise be read as a
        // `{` method position. Skip back to before the `//` so the token before the name is read.
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '{' || character === '(' || character === ',') {
            return character !== '{' || memberBodyOpensAt(source, cursor);
        }
        // A generator asterisk sits between the enclosing construct and the name; skip it and keep
        // walking so the construct before it decides.
        if (character === '*') {
            cursor -= 1;
            continue;
        }
        if (character === '}' || character === ';') {
            return isMemberInsideClassLikeBody(source, keywordIndex);
        }
        if (isIdentifierContinue(character)) {
            let identifierStart = cursor;
            while (identifierStart >= 0 && isIdentifierContinue(source[identifierStart])) {
                identifierStart -= 1;
            }
            const word = source.slice(identifierStart + 1, cursor + 1);
            if (word === 'function') {
                return true;
            }
            if (DECLARATION_MODIFIERS.has(word)) {
                cursor = identifierStart - 1;
                continue;
            }
            return false;
        }
        return false;
    }
    return false;
}

/**
 * Whether a `require`/`import` name preceded by `}` or `;` is a member of a class, interface, or
 * type-literal body — the innermost `{` enclosing the name must be one such body rather than a
 * statement block. The statement-block shapes stay refused, and the first-statement block case named
 * in `isDeclarationContext` never reaches here because its name is preceded by `{`, not `}` or `;`.
 */
function isMemberInsideClassLikeBody(source: string, keywordIndex: number): boolean {
    const open = enclosingBraceOpen(source, keywordIndex);
    if (open === undefined) {
        return false;
    }
    return classLikeBodyOpenBefore(source, open);
}

/**
 * Whether the `{` at `openIndex` can hold a member declaration, so a name right after it is a member
 * rather than a call. A class, interface, or type-literal body holds members, and so does an object
 * literal; a block a statement proves (`; { … }`, `function f() { … }`, `if (x) { … }`, `else { … }`,
 * a nested block) holds statements, so the name there is a call. Every other token before the brace
 * keeps the merge base's member reading, because a `:` or an `=>` in front of it also stands in a
 * type literal, where the name is a member too (#4835).
 *
 * The class/interface/type test comes first: a class body may itself follow a `)` (`class X extends
 * (Base) { require(spec) { … } }`), which the block test would otherwise claim.
 */
function memberBodyOpensAt(source: string, openIndex: number): boolean {
    if (classLikeBodyOpenBefore(source, openIndex)) {
        return true;
    }
    const before = previousSignificantCharacter(source, openIndex - 1);
    if (before === undefined) {
        return false;
    }
    const character = source.charAt(before);
    if (character === ')' || character === ';' || character === '}' || character === '{') {
        return false;
    }
    if (!isIdentifierContinue(character)) {
        return true;
    }
    const word = readWordBackward(source, before);
    return word !== 'else' && word !== 'do' && word !== 'try' && word !== 'finally';
}

/**
 * The index of the `{` that opens the innermost brace-delimited region containing `keywordIndex`,
 * skipping braces that belong to regex, string, template, or comment content on the way, or
 * `undefined` when no such brace precedes the name. A `}` a regex body holds — `/}/` — is the
 * literal's character rather than a delimiter, so the walk crosses the literal whole; the
 * member-position walk makes the same judgement, so the two agree on the region a name sits in.
 */
function enclosingBraceOpen(source: string, keywordIndex: number): number | undefined {
    let cursor = keywordIndex - 1;
    let depth = 0;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            // A `*`-preceded slash is a comment close only where its `/*` opener stands; without one it
            // is a regex body ending in `*`, and the regex handling below crosses it rather than the
            // walk failing over a comment it cannot place.
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open !== -1) {
                cursor = open - 1;
                continue;
            }
        } else {
            const lineComment = lineCommentOpenBefore(source, cursor);
            if (lineComment !== undefined) {
                cursor = lineComment - 1;
                continue;
            }
        }
        if (character === '/') {
            const regexOpen = regexLiteralOpenBackward(source, cursor);
            // Only an opener that stands at a regex position starts a literal. Two division slashes
            // otherwise pair — `1 / 2 … 3 / 4` reads as a literal from the second `/` back to the
            // first — and the walk then steps over the `{`, `(`, or `[` between them.
            if (regexOpen !== undefined && canStartRegexLiteral(source, regexOpen)) {
                cursor = regexOpen - 1;
                continue;
            }
        }
        if (character === '"' || character === "'") {
            const open = skipQuotedBackward(source, cursor, character);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === '`') {
            const open = skipTemplateBackward(source, cursor);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === '}') {
            depth += 1;
            cursor -= 1;
            continue;
        }
        if (character === '{') {
            if (depth === 0) {
                return cursor;
            }
            depth -= 1;
            cursor -= 1;
            continue;
        }
        cursor -= 1;
    }
    return undefined;
}

/** Statement and block construct keywords that end a class/interface/type header scan. */
const BLOCK_INTRODUCER_KEYWORDS: ReadonlySet<string> = new Set([
    'function',
    'const',
    'let',
    'var',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'default',
    'try',
    'catch',
    'finally',
    'throw',
    'return',
    'new',
    'await',
    'yield',
    'with',
    'import',
    'namespace',
    'enum',
    'module',
]);

/**
 * Whether the `{` at `openIndex` opens a class, interface, or type-literal body. The scan walks back
 * over the header — a name, a type-parameter list, a `type Name =` clause, a heritage or implements
 * clause, and balanced parentheses or brackets inside them — and stops, refusing, at any statement or
 * block keyword or unmatched punctuation, so a `type` keyword in an earlier statement cannot claim a
 * later block.
 */
function classLikeBodyOpenBefore(source: string, openIndex: number): boolean {
    return classLikeBodyKeywordBefore(source, openIndex) !== undefined;
}

/**
 * The `ClassFieldsEntry` the `{` at `openIndex` opens, created on first reference so a class with no
 * fields still owns an entry a subclass's read-back can inherit from.
 */
function classEntryFromOpen(
    source: string,
    classFields: Map<number, ClassFieldsEntry>,
    open: number
): ClassFieldsEntry {
    let entry = classFields.get(open);
    if (entry === undefined) {
        const info = readClassInfo(source, open);
        entry = {
            name: info?.name ?? '',
            scopeChain: info?.scopeChain ?? [],
            parentName: info?.parentName,
            fields: new Map(),
            members: new Set(),
            unmodelled: false,
        };
        classFields.set(open, entry);
    }
    return entry;
}

/**
 * The declaration a `{` at `open` opens when it is a class body: its name, the statement scope that
 * contains it, and the parent class a plain `extends <Name>` clause names, or `undefined` when the
 * brace opens an interface, a type literal, or a statement block.
 */
function readClassInfo(
    source: string,
    open: number
): { name: string; scopeChain: number[]; parentName: string | undefined } | undefined {
    const header = classLikeBodyKeywordBefore(source, open);
    if (header === undefined || header.keyword !== 'class') {
        return undefined;
    }
    const name = readWordForward(source, skipWhitespace(source, header.keywordStart + 5));
    if (name === undefined) {
        return undefined;
    }
    return {
        name,
        scopeChain: enclosingScopeChain(source, open),
        parentName: classHeritageName(source, open),
    };
}

/**
 * The parent class name a `class … extends <Name> {` header declares, or `undefined` when the heritage
 * is parenthesised or anything else a name cannot stand for. Only a plain name is tracked, so a mixin
 * call (`extends mixin(B)`) and a cast (`extends (B as new () => B)`) carry no inherited field.
 */
function classHeritageName(source: string, open: number): string | undefined {
    const header = classLikeBodyKeywordBefore(source, open);
    if (header === undefined || header.keyword !== 'class') {
        return undefined;
    }
    let cursor = skipWhitespace(source, header.keywordStart + 5);
    const name = readWordForward(source, cursor);
    if (name === undefined) {
        return undefined;
    }
    cursor = skipWhitespace(source, cursor + name.length);
    if (source[cursor] === '<') {
        const after = skipTypeArguments(source, cursor, source.length);
        if (after === undefined) {
            return undefined;
        }
        cursor = skipWhitespace(source, after);
    }
    if (!isKeywordAt(source, cursor, 'extends')) {
        return undefined;
    }
    cursor = skipWhitespace(source, cursor + 'extends'.length);
    return source[cursor] === '(' ? undefined : readWordForward(source, cursor);
}

/**
 * The parameter-list opener of the innermost expression-bodied arrow whose body contains `index`, or
 * `undefined` when `index` sits in no such body. The walk skips balanced delimiters, strings, templates,
 * and comments and stops at a `;` or `,` at depth zero, so a position after the arrow's statement or
 * expression does not read as inside its body. A parenthesised parameter list returns its `(`; a single
 * identifier returns its start.
 */
function enclosingExpressionBodiedArrowOpen(source: string, index: number): number | undefined {
    let cursor = index - 1;
    let depth = 0;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/') {
            const commentOpen = cursor >= 1 && source[cursor - 1] === '*' ? source.lastIndexOf('/*', cursor - 1) : -1;
            if (commentOpen !== -1) {
                cursor = commentOpen - 1;
                continue;
            }
            const lineComment = lineCommentOpenBefore(source, cursor);
            if (lineComment !== undefined) {
                cursor = lineComment - 1;
                continue;
            }
            const regexOpen = regexLiteralOpenBackward(source, cursor);
            // Only an opener that stands at a regex position starts a literal. Two division slashes
            // otherwise pair — `1 / 2 … 3 / 4` reads as a literal from the second `/` back to the
            // first — and the walk then steps over the `{`, `(`, or `[` between them.
            if (regexOpen !== undefined && canStartRegexLiteral(source, regexOpen)) {
                cursor = regexOpen - 1;
                continue;
            }
        }
        if (character === '"' || character === "'") {
            const quoteOpen = skipQuotedBackward(source, cursor, character);
            cursor = quoteOpen === undefined ? cursor - 1 : quoteOpen - 1;
            continue;
        }
        if (character === '`') {
            const templateOpen = skipTemplateBackward(source, cursor);
            cursor = templateOpen === undefined ? cursor - 1 : templateOpen - 1;
            continue;
        }
        if (character === ')' || character === '}' || character === ']') {
            depth += 1;
            cursor -= 1;
            continue;
        }
        if (character === '(' || character === '{' || character === '[') {
            if (depth === 0) {
                cursor -= 1;
                continue;
            }
            depth -= 1;
            cursor -= 1;
            continue;
        }
        if (depth === 0 && (character === ';' || character === ',' || character === ':')) {
            return undefined;
        }
        if (character === '>' && source[cursor - 1] === '=') {
            if (depth === 0) {
                const equals = cursor - 1;
                const before = previousSignificantCharacter(source, equals - 1);
                if (before === undefined) {
                    return undefined;
                }
                if (source.charAt(before) === ')') {
                    return matchingOpenDelimiterBackward(source, before, '(', ')');
                }
                if (isIdentifierContinue(source.charAt(before))) {
                    const name = readWordBackward(source, before);
                    return before - name.length + 1;
                }
                return undefined;
            }
            cursor -= 1;
            continue;
        }
        cursor -= 1;
    }
    return undefined;
}

/**
 * The statement scopes that enclose `index`, outermost first, as the indices of the enclosing braces
 * that are not class, interface, or type bodies, with the parameter-list opener of each enclosing
 * expression-bodied arrow interleaved so an arrow parameter binds inside its own body. Class-like bodies
 * are skipped because a class named inside one is not reachable by bare name outside it. The chain is
 * empty at top level, and a deeper position extends an enclosing position's chain, so a name resolves to
 * the declaration whose chain is the longest prefix of the position's chain.
 */
function enclosingScopeChain(source: string, index: number): number[] {
    const scopes: number[] = [];
    let cursor = index;
    while (cursor >= 0) {
        const braceOpen = enclosingBraceOpen(source, cursor);
        const arrowOpen = enclosingExpressionBodiedArrowOpen(source, cursor);
        let open: number | undefined = arrowOpen;
        if (braceOpen !== undefined && (open === undefined || braceOpen > open)) {
            open = braceOpen;
        }
        if (open === undefined) {
            break;
        }
        if (open === braceOpen && classLikeBodyOpenBefore(source, open)) {
            cursor = open - 1;
            continue;
        }
        scopes.push(open);
        cursor = open - 1;
    }
    scopes.reverse();
    return scopes;
}

/** Whether `classChain` is a prefix of `refChain`, both outermost first. */
function isScopeChainPrefix(classChain: number[], refChain: number[]): boolean {
    if (classChain.length > refChain.length) {
        return false;
    }
    for (let i = 0; i < classChain.length; i += 1) {
        if (classChain[i] !== refChain[i]) {
            return false;
        }
    }
    return true;
}

/**
 * The loader-valued instance field `fieldName` on the class `classRef`, walking `extends` parents when
 * the class declares none, or `undefined` when no such instance field exists. An own member of that
 * name — a field, method, or accessor, loader-valued or not — shadows the parent's field, so the walk
 * stops at the first class that declares it. The parent name resolves through the same local and
 * parameter bindings a `new <Name>` read-back does, so a shadowed parent name carries no field. A cycle
 * stops the walk.
 */
function resolveInstanceField(
    classRef: number,
    fieldName: string,
    classFields: ReadonlyMap<number, ClassFieldsEntry>,
    localBindings: ReadonlyMap<string, readonly LocalInstance[]>
): LoaderBindingKind | undefined {
    const seen = new Set<number>();
    let current: number | undefined = classRef;
    while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        const entry = classFields.get(current);
        if (entry === undefined) {
            return undefined;
        }
        // A class the walk did not fully consume yields no shape, so the read-back keeps the merge
        // base's reading rather than deciding either way through an unreliable member set.
        if (entry.unmodelled) {
            return undefined;
        }
        if (entry.members.has(fieldName)) {
            return entry.fields.get(fieldName);
        }
        current =
            entry.parentName === undefined
                ? undefined
                : resolveNameToClass(entry.parentName, entry.scopeChain, classFields, localBindings);
    }
    return undefined;
}

/**
 * The header keyword — `class`, `interface`, or `type` — whose body the `{` at `openIndex` opens, with
 * the keyword's start, or `undefined` when the brace opens a statement block or nothing reachable. The
 * walk crosses balanced parentheses and brackets in the header, so a parenthesised heritage clause
 * (`class C<T> extends (B) { … }`) is read as the class body it is rather than as a statement block.
 *
 * A `>` that closes any balanced `<…>` region — the declared name's type-parameter list, a generic
 * heritage or implements argument, or a nested generic — is crossed as one region, so a `{`, `}`, or
 * `:` inside it (`class C<T extends { a: string }>`, a conditional type, `extends Base<{ a: string }>`,
 * `implements I<V extends W ? X : Y>`) cannot reach the fallthrough. A `>` with no matching `<` — an
 * arrow's `>` or a comparison — is skipped without pairing, which keeps the walk at depth zero until it
 * reaches the `class`, `interface`, or `type` keyword (#4835).
 */
function classLikeBodyKeywordBefore(
    source: string,
    openIndex: number
): { keyword: 'class' | 'interface' | 'type'; keywordStart: number } | undefined {
    let cursor = openIndex - 1;
    let delimiterDepth = 0;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return undefined;
            }
            cursor = open - 1;
            continue;
        }
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '"' || character === "'") {
            const open = skipQuotedBackward(source, cursor, character);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === '`') {
            const open = skipTemplateBackward(source, cursor);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === ')' || character === ']') {
            delimiterDepth += 1;
            cursor -= 1;
            continue;
        }
        if ((character === '(' || character === '[') && delimiterDepth > 0) {
            delimiterDepth -= 1;
            cursor -= 1;
            continue;
        }
        if (delimiterDepth > 0) {
            cursor -= 1;
            continue;
        }
        if (character === '>') {
            const open = matchingOpenDelimiterBackward(source, cursor, '<', '>');
            if (open !== undefined) {
                cursor = open - 1;
                continue;
            }
            cursor -= 1;
            continue;
        }
        if (isIdentifierContinue(character)) {
            const word = readWordBackward(source, cursor);
            const keywordStart = cursor - word.length + 1;
            if (word === 'class' || word === 'interface' || word === 'type') {
                return { keyword: word, keywordStart };
            }
            if (BLOCK_INTRODUCER_KEYWORDS.has(word)) {
                return undefined;
            }
            cursor = keywordStart - 1;
            continue;
        }
        if (
            character === '.' ||
            character === ',' ||
            character === '=' ||
            character === '|' ||
            character === '&' ||
            character === '<'
        ) {
            cursor -= 1;
            continue;
        }
        return undefined;
    }
    return undefined;
}

/** The opening quote of the string literal whose closing quote is at `index`, or `undefined`. */
function skipQuotedBackward(source: string, index: number, quote: "'" | '"'): number | undefined {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (character === '\\') {
            cursor -= 2;
            continue;
        }
        if (character === quote) {
            return cursor;
        }
        if (isLineTerminator(character)) {
            return undefined;
        }
        cursor -= 1;
    }
    return undefined;
}

/** The opening backtick of the template literal whose closing backtick is at `index`, or `undefined`. */
function skipTemplateBackward(source: string, index: number): number | undefined {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === '\\') {
            cursor -= 2;
            continue;
        }
        if (character === '`') {
            return cursor;
        }
        cursor -= 1;
    }
    return undefined;
}

/** The identifier word ending at `cursor`, read backward to its first character. */
function readWordBackward(source: string, cursor: number): string {
    let start = cursor;
    while (start >= 0 && isIdentifierContinue(source[start])) {
        start -= 1;
    }
    return source.slice(start + 1, cursor + 1);
}

/**
 * The index of the `//` that opens the line comment containing `cursor`, or `undefined` when the
 * cursor is not inside a `//` comment. Walking the line forward from its start — skipping string,
 * template, and regex literals and block comments — keeps a `//` inside a quoted value, a regex, or a
 * block comment from masking a real token.
 */
function lineCommentOpenBefore(source: string, cursor: number): number | undefined {
    let lineStart = cursor;
    while (lineStart >= 0 && !isLineTerminator(source[lineStart] ?? '')) {
        lineStart -= 1;
    }
    let index = lineStart + 1;
    while (index < cursor) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            if (source.startsWith('//', index)) {
                return index;
            }
            index = commentEnd;
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        const character = source[index];
        if (character === "'" || character === '"') {
            index = skipQuoted(source, index, character);
            continue;
        }
        if (character === '`') {
            index = scanTemplate(source, index, cursor, new Set());
            continue;
        }
        index += 1;
    }
    return undefined;
}

function isAnnotatedParameterListRegion(source: string, start: number, end: number): boolean {
    let cursor = skipWhitespace(source, start);
    if (cursor >= end) {
        return true;
    }
    if (source.startsWith('...', cursor)) {
        cursor = skipWhitespace(source, cursor + 3);
    }
    const afterBinding = skipBindingPattern(source, cursor, end);
    if (afterBinding === undefined) {
        return false;
    }
    cursor = skipWhitespace(source, afterBinding);
    if (source[cursor] === '?') {
        // An optional parameter's `?` is followed directly by `:`; a ternary's is not.
        cursor = skipWhitespace(source, cursor + 1);
        return source[cursor] === ':';
    }
    return source[cursor] === ':';
}

function skipBindingPattern(source: string, start: number, end: number): number | undefined {
    const first = source[start];
    if (first === undefined) {
        return undefined;
    }
    if (/[A-Za-z_$]/.test(first)) {
        let cursor = start + 1;
        while (cursor < end && isIdentifierContinue(source[cursor])) {
            cursor += 1;
        }
        return cursor;
    }
    if (first === '{') {
        return skipBalancedDelimited(source, start, end, '{', '}');
    }
    if (first === '[') {
        return skipBalancedDelimited(source, start, end, '[', ']');
    }
    return undefined;
}

function skipBalancedDelimited(
    source: string,
    start: number,
    end: number,
    open: string,
    close: string
): number | undefined {
    let cursor = start;
    let depth = 0;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const quote = source[cursor];
        if (quote === "'" || quote === '"') {
            cursor = skipQuoted(source, cursor, quote);
            continue;
        }
        if (quote === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        // A regex is skipped as the sibling scanners skip it: `require({ a: /}:/, b: specifier }['b'])`
        // is one argument, not a parameter list, and reading the `}` inside the regex as the object's
        // close admitted the computed load behind it.
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = Math.min(regexEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character === open) {
            depth += 1;
        } else if (character === close) {
            depth -= 1;
            if (depth === 0) {
                return cursor + 1;
            }
        }
        cursor += 1;
    }
    return undefined;
}

function staticSpecifierEnd(source: string, start: number, end: number): number | undefined {
    const expressionEnd = readStaticSpecifier(source, start, end);
    if (expressionEnd === undefined) {
        return undefined;
    }
    const after = skipWhitespace(source, expressionEnd);
    if (after === end || source[after] === ',') {
        return expressionEnd;
    }
    return undefined;
}

function readStaticSpecifier(source: string, start: number, end: number): number | undefined {
    let cursor = skipWhitespace(source, start);
    if (cursor >= end) {
        return undefined;
    }
    // A leading angle-bracket assertion is erased at run time exactly as `as` is, so the specifier
    // stays the literal; skip it and read the asserted expression.
    while (source[cursor] === '<') {
        const afterType = skipTypeArguments(source, cursor, end);
        if (afterType === undefined) {
            return undefined;
        }
        cursor = skipWhitespace(source, afterType);
        if (cursor >= end) {
            return undefined;
        }
    }
    const first = source[cursor];
    let literalEnd: number | undefined;
    if (first === "'" || first === '"') {
        const read = readQuotedValue(source, cursor, first);
        if (read === undefined) {
            return undefined;
        }
        literalEnd = read.end;
    } else if (first === '`') {
        const read = readStaticTemplateValue(source, cursor);
        if (read === undefined) {
            return undefined;
        }
        literalEnd = read.end;
    } else if (first === '(') {
        const closeParen = skipBalancedParens(source, cursor);
        if (closeParen === undefined || closeParen - 1 > end) {
            return undefined;
        }
        const innerEnd = readStaticSpecifier(source, cursor + 1, closeParen - 1);
        if (innerEnd === undefined || skipWhitespace(source, innerEnd) !== closeParen - 1) {
            return undefined;
        }
        literalEnd = closeParen;
    } else {
        return undefined;
    }
    // A literal may carry a postfix non-null assertion and any number of chained `as`/`satisfies`
    // casts, in any order. Each is erased at run time, so the value stays the literal, but it must be
    // skipped so the caller can tell the specifier's end from a value-modifying operator that follows
    // it.
    let current = literalEnd;
    while (true) {
        const after = skipWhitespace(source, current);
        if (source[after] === '!') {
            current = after + 1;
            continue;
        }
        let typeStart: number | undefined;
        if (isKeywordAt(source, after, 'as')) {
            typeStart = after + 2;
        } else if (isKeywordAt(source, after, 'satisfies')) {
            typeStart = after + 9;
        } else {
            break;
        }
        current = skipTypeExpression(source, typeStart, end);
    }
    return current;
}

const TYPE_TERMINATOR_CHARACTERS = new Set(['+', '-', '*', '/', '%', '^', '~', '!', '?', ':', '=', ';']);

function isDecimalDigit(character: string | undefined): boolean {
    return character !== undefined && character >= '0' && character <= '9';
}

/**
 * Consumes the type of an `as`/`satisfies` cast, whatever shape it takes: a plain or qualified name,
 * an array or tuple suffix, a generic, a function type, an object type, a union/intersection, a
 * conditional type (`A extends B ? C : D`), a literal type (`-1`), or a `typeof` query. The type is
 * erased at run time, so the specifier value stays the literal, but the scanner must know where the
 * cast ends to tell it apart from an operator that follows the literal. It walks to the
 * argument-level comma or the closing parenthesis of the call, tracking balanced `()`, `[]`, `{}`,
 * and `<>` so a comma inside a generic, tuple, function, or object type does not end the cast, and
 * stops at a chained `as`/`satisfies` so the caller can chain it.
 *
 * Several shapes would otherwise end the cast early or swallow the operator after it, and are
 * decided here rather than by the terminator set alone: a `<` is a type-argument opener only when
 * its level closes before the cast ends (otherwise it is a value comparison and the cast ends before
 * it); a conditional type's `?` and `:` are type syntax once an `extends` precedes them at the same
 * level, paired per nesting depth (otherwise `?` is a value ternary and the cast ends before it); a
 * leading `-`/`+` on a numeric literal type is part of the type only where a type atom begins
 * (otherwise it is a value operator and the cast ends before it); and a word operator — `&&`, `||`,
 * `instanceof`, `in` — always ends the cast because none is type syntax.
 */
function skipTypeExpression(source: string, start: number, end: number): number {
    let cursor = skipWhitespace(source, start);
    const openers: Array<')' | ']' | '}' | '>'> = [];
    // Conditional types pair each top-level `extends` with the `?` that opens its true branch and
    // each such `?` with its `:`. Pairing nests — `A extends B ? C extends D ? E : F : G` and
    // `A extends () => B extends C ? D : E ? F : G` both carry two conditionals at one level — so a
    // stack replaces a one-shot arm: a nested conditional's `?`/`:` cannot consume the outer
    // `extends`'s arm. A top-level `?` with no armed `extends` is a value ternary and ends the cast.
    const conditionals: Array<'extends' | 'conditional'> = [];
    // Whether a type atom has been consumed at the top level. A `-` directly before a digit is the
    // sign of a numeric literal type only where a type atom begins (the leading `-1`); after a
    // completed type it is a value `-`/`+` operator and ends the cast.
    let typeStarted = false;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character === undefined) {
            return cursor;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor += 1;
            continue;
        }
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            typeStarted = true;
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            typeStarted = true;
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            typeStarted = false;
            continue;
        }
        if (character === '<') {
            // A `<` whose generic level never closes before the cast ends is a value comparison, not
            // a type-argument opener: `as string < 'y' ? ...` compares the cast value, so the cast
            // ends here and the ternary after it is expression syntax again.
            if (skipTypeArguments(source, cursor, end) === undefined) {
                return cursor;
            }
            openers.push('>');
            cursor += 1;
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            openers.push(matchingTypeDelimiter(character));
            cursor += 1;
            continue;
        }
        if (character === ')' || character === ']' || character === '}' || character === '>') {
            const top = openers[openers.length - 1];
            if (top === undefined || top !== character) {
                // An unmatched closer ends the type before it; the caller then refuses.
                return cursor;
            }
            openers.pop();
            cursor += 1;
            typeStarted = true;
            continue;
        }
        if (openers.length === 0) {
            if (character === ',') {
                return cursor;
            }
            if (isKeywordAt(source, cursor, 'as') || isKeywordAt(source, cursor, 'satisfies')) {
                return cursor;
            }
            if (isKeywordAt(source, cursor, 'extends')) {
                conditionals.push('extends');
                typeStarted = false;
                cursor += 'extends'.length;
                continue;
            }
            if (character === '?') {
                if (conditionals[conditionals.length - 1] === 'extends') {
                    conditionals.pop();
                    conditionals.push('conditional');
                    typeStarted = false;
                    cursor += 1;
                    continue;
                }
                return cursor;
            }
            if (character === ':') {
                if (conditionals[conditionals.length - 1] === 'conditional') {
                    conditionals.pop();
                    typeStarted = false;
                    cursor += 1;
                    continue;
                }
                return cursor;
            }
            if (character === '-' && isDecimalDigit(source[cursor + 1]) && !typeStarted) {
                typeStarted = true;
                cursor += 1;
                continue;
            }
            if ((character === '-' || character === '+') && isDecimalDigit(source[cursor + 1])) {
                return cursor;
            }
            if (isKeywordAt(source, cursor, 'instanceof') || isKeywordAt(source, cursor, 'in')) {
                return cursor;
            }
            if (source.startsWith('&&', cursor) || source.startsWith('||', cursor)) {
                return cursor;
            }
            if (character === '|' || character === '&') {
                typeStarted = false;
                cursor += 1;
                continue;
            }
            if (TYPE_TERMINATOR_CHARACTERS.has(character)) {
                return cursor;
            }
            typeStarted = true;
        }
        cursor += 1;
    }
    return cursor;
}

/**
 * The end of the type-argument list a `<` at `openIndex` opens, or `undefined` when no `>` closes it
 * before `end`. `=>` is skipped so an arrow's `>` is not read as the close, and `>=` is skipped so a
 * value comparison is not read as one either.
 */
function skipTypeArguments(source: string, openIndex: number, end: number): number | undefined {
    let cursor = openIndex + 1;
    let depth = 1;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character === undefined) {
            break;
        }
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            continue;
        }
        if (character === '<') {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === '>') {
            if (source[cursor + 1] === '=') {
                cursor += 2;
                continue;
            }
            depth -= 1;
            cursor += 1;
            if (depth === 0) {
                return cursor;
            }
            continue;
        }
        cursor += 1;
    }
    return undefined;
}

function matchingTypeDelimiter(open: '(' | '[' | '{' | '<'): ')' | ']' | '}' | '>' {
    if (open === '(') {
        return ')';
    }
    if (open === '[') {
        return ']';
    }
    if (open === '{') {
        return '}';
    }
    return '>';
}

/** The opener the closer of a balanced region pairs with, for the walks that read a region backward. */
function openerOfDelimiter(closer: ')' | ']' | '}'): '(' | '[' | '{' {
    if (closer === ')') {
        return '(';
    }
    if (closer === ']') {
        return '[';
    }
    return '{';
}

function endOfBalancedCall(source: string, openParen: number): number {
    const end = skipBalancedParens(source, openParen);
    return end === undefined ? source.length : end;
}

function scanImportSpecifiers(
    source: string,
    start: number,
    end: number,
    specifiers: Set<string>,
    stopAtDepthZero = false,
    bindings: LoaderRead = NO_LOADER_READ
): number {
    let index = start;
    let depth = stopAtDepthZero ? 1 : null;
    while (index < end) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanTemplate(source, index, end, specifiers, bindings);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (depth !== null) {
            if (source[index] === '{') {
                depth += 1;
                index += 1;
                continue;
            }
            if (source[index] === '}') {
                depth -= 1;
                if (depth === 0) {
                    return index + 1;
                }
                index += 1;
                continue;
            }
        }
        if (isKeywordAt(source, index, 'from')) {
            const afterKeyword = index + 4;
            const specifier = readModuleStringAfter(source, afterKeyword);
            if (specifier !== undefined) {
                specifiers.add(specifier.value);
                index = specifier.end;
                continue;
            }
        }
        if (isKeywordAt(source, index, 'import')) {
            const afterKeyword = index + 6;
            const sideEffect = readModuleStringAfter(source, afterKeyword);
            if (sideEffect !== undefined) {
                specifiers.add(sideEffect.value);
                index = sideEffect.end;
                continue;
            }
            const dynamic = readDynamicImportSpecifier(source, afterKeyword);
            if (dynamic !== undefined) {
                if (!isPrecededByDotAccess(source, index)) {
                    specifiers.add(dynamic.value);
                }
                index = dynamic.end;
                continue;
            }
            const metaResolve = readImportMetaResolveSpecifier(source, index);
            if (metaResolve !== undefined) {
                specifiers.add(metaResolve.value);
                index = metaResolve.end;
                continue;
            }
        }
        if (isKeywordAt(source, index, 'require')) {
            if (!isPrecededByDotAccess(source, index)) {
                let cursor = skipWhitespace(source, index + 7);
                if (source[cursor] === '.') {
                    const afterDot = skipWhitespace(source, cursor + 1);
                    if (isKeywordAt(source, afterDot, 'resolve')) {
                        cursor = afterDot + 7;
                    }
                } else if (source.startsWith('?.', cursor)) {
                    const afterDot = skipWhitespace(source, cursor + 2);
                    if (isKeywordAt(source, afterDot, 'resolve')) {
                        cursor = afterDot + 7;
                    }
                }
                cursor = skipWhitespace(source, cursor);
                if (source.startsWith('?.', cursor) && source[skipWhitespace(source, cursor + 2)] === '(') {
                    cursor = skipWhitespace(source, cursor + 2);
                }
                const spec = readDynamicImportSpecifier(source, cursor);
                if (spec !== undefined) {
                    specifiers.add(spec.value);
                    index = spec.end;
                    continue;
                }
            }
        }
        if (isKeywordAt(source, index, 'createRequire')) {
            if (!isPrecededByDotAccess(source, index)) {
                const afterKeyword = skipWhitespace(source, index + 13);
                if (source[afterKeyword] === '(') {
                    const afterFirstCall = skipBalancedParens(source, afterKeyword);
                    if (afterFirstCall !== undefined) {
                        let secondCallCursor = skipWhitespace(source, afterFirstCall);
                        if (
                            source.startsWith('?.', secondCallCursor) &&
                            source[skipWhitespace(source, secondCallCursor + 2)] === '('
                        ) {
                            secondCallCursor = skipWhitespace(source, secondCallCursor + 2);
                        }
                        const spec = readDynamicImportSpecifier(source, secondCallCursor);
                        if (spec !== undefined) {
                            specifiers.add(spec.value);
                            index = spec.end;
                            continue;
                        }
                    }
                }
            }
        }
        const bound = readBoundCallee(source, index, bindings);
        if (bound !== undefined) {
            const spec = readDynamicImportSpecifier(source, bound.callOpen);
            if (spec !== undefined) {
                specifiers.add(spec.value);
                index = spec.end;
                continue;
            }
        }
        index += 1;
    }
    return index;
}

function scanTemplate(
    source: string,
    index: number,
    end: number,
    specifiers: Set<string>,
    bindings: LoaderRead = NO_LOADER_READ
): number {
    let cursor = index + 1;
    while (cursor < end) {
        const character = source[cursor];
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (character === '`') {
            return cursor + 1;
        }
        if (character === '$' && source[cursor + 1] === '{') {
            cursor = scanImportSpecifiers(source, cursor + 2, end, specifiers, true, bindings);
            continue;
        }
        cursor += 1;
    }
    return end;
}

function isKeywordAt(source: string, index: number, keyword: string): boolean {
    if (!source.startsWith(keyword, index)) {
        return false;
    }
    const before = index === 0 ? undefined : source[index - 1];
    const after = source[index + keyword.length];
    return !isIdentifierContinue(before) && !isIdentifierContinue(after);
}

/**
 * Whether `character` continues an identifier. Every walk asks this at every position it crosses, so
 * the character codes answer it where the equivalent regular expression dominated a large scan.
 */
function isIdentifierContinue(character: string | undefined): boolean {
    if (character === undefined) {
        return false;
    }
    const code = character.charCodeAt(0);
    return (
        (code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        (code >= 48 && code <= 57) ||
        code === 95 ||
        code === 36
    );
}

function isLineTerminator(character: string): boolean {
    return character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';
}

function skipComment(source: string, index: number): number | undefined {
    if (source.startsWith('//', index)) {
        let cursor = index + 2;
        while (cursor < source.length && !isLineTerminator(source[cursor] ?? '')) {
            cursor += 1;
        }
        return cursor < source.length ? cursor + 1 : source.length;
    }
    if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2);
        return end === -1 ? source.length : end + 2;
    }
    return undefined;
}

/**
 * The keywords after which a `/` opens a regex literal rather than dividing: each introduces a
 * statement, or continues one with an operand, so the next token starts an expression. A word that can
 * precede an expression end (`this`, `super`, a variable name) does not belong, and neither does a
 * control keyword whose `(` or `{` another judgement reaches first — `if`, `for`, `while`, `with`,
 * `switch`, and `catch` all stand before a header, so their `/` never reaches this test. The entries
 * below are the ones a shape can reach: `do /re/; while (a)`, `try /re/;`, and `finally /re/` stand
 * directly before the token, and `else` is judged separately in `canStartRegexLiteral` because it
 * needs the member guard. `default` is deliberately absent — a `default:` label ends in `:` and an
 * `export default` is followed by a declaration, so neither reaches this test.
 */
const REGEX_PREFIX_KEYWORDS = new Set([
    'return',
    'throw',
    'case',
    'delete',
    'typeof',
    'void',
    'await',
    'yield',
    'in',
    'of',
    'instanceof',
    'new',
    'extends',
    'do',
    'try',
    'finally',
]);

function skipRegexLiteral(source: string, index: number): number | undefined {
    if (source[index] !== '/') {
        return undefined;
    }
    if (!canStartRegexLiteral(source, index)) {
        return undefined;
    }
    let cursor = index + 1;
    let inClass = false;
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === undefined) {
            break;
        }
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (inClass) {
            if (character === ']') {
                inClass = false;
            }
            cursor += 1;
            continue;
        }
        if (character === '[') {
            inClass = true;
            cursor += 1;
            continue;
        }
        if (character === '/') {
            cursor += 1;
            while (cursor < source.length && /[a-z]/i.test(source[cursor] ?? '')) {
                cursor += 1;
            }
            return cursor;
        }
        if (isLineTerminator(character)) {
            return undefined;
        }
        cursor += 1;
    }
    return undefined;
}

/**
 * Answers to `canStartRegexLiteral` for the source being scanned, keyed by the `/`'s index. The
 * question is a pure function of one source and one index, but the backward walks it opens re-enter it
 * through `lineCommentOpenBefore` — comments, strings, and regex literals must be skipped to read the
 * token before a `}` or `)` — so a line of repeated delimiters asked it an exponential number of times
 * (`'} / '.repeat(32)` cost ~2.3 s, #4828). The memo ends that: every index is answered once, so the
 * nested walks only revisit a region whose question is already answered. One source is retained,
 * because a scan threads a single source through every nested call.
 */
let regexPrefixSource: string | undefined;
let regexPrefixAnswers = new Map<number, boolean>();

function canStartRegexLiteral(source: string, index: number): boolean {
    if (regexPrefixSource !== source) {
        regexPrefixSource = source;
        regexPrefixAnswers = new Map();
    }
    const answered = regexPrefixAnswers.get(index);
    if (answered !== undefined) {
        return answered;
    }
    const answer = readCanStartRegexLiteral(source, index);
    regexPrefixAnswers.set(index, answer);
    return answer;
}

function readCanStartRegexLiteral(source: string, index: number): boolean {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            break;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return false;
            }
            cursor = open - 1;
            continue;
        }
        // A `}` keeps the merge base's statement-end reading unless it provably closes an object
        // literal in operand position, whose close ends an expression and is divided: reading every
        // `}` as a statement end hid the load behind `const r = {} / import(name) / 2`.
        if (character === '}') {
            return !objectLiteralCloseBefore(source, cursor);
        }
        if ('([{;=,.!?:~%^&*+<>|'.includes(character) || character === '-') {
            return true;
        }
        // A `)` ends an expression — `f(x) / 2` divides — except when it closes the header of a
        // control statement, whose body is a statement: `if (x) /re/.test(x)` starts one with a regex.
        if (character === ')') {
            return closesControlHeader(source, cursor);
        }
        if (character === ']' || character === '"' || character === "'" || character === '`') {
            return false;
        }
        if (isIdentifierContinue(character)) {
            let start = cursor;
            while (start >= 0 && isIdentifierContinue(source[start])) {
                start -= 1;
            }
            const identifier = source.slice(start + 1, cursor + 1);
            // A member named after a keyword or `else` is an expression end, so the `/` after it
            // divides: `obj.if / 2`, `this.default / 2`, and `this.#else / 2` all keep the division.
            // Only a keyword in keyword position — `do /re/.test(x)`, `else /re/.test(x)` — is
            // followed by a statement whose next token may open a regex.
            if (isMemberNameAt(source, start + 1)) {
                return false;
            }
            return identifier === 'else' || REGEX_PREFIX_KEYWORDS.has(identifier);
        }
        if (character >= '0' && character <= '9') {
            return false;
        }
        return false;
    }
    return true;
}

/**
 * Control-flow keywords whose parenthesised header is followed by a statement rather than an
 * expression, so its `)` ends a header and a `/` after it opens a regex literal.
 */
const CONTROL_HEADER_KEYWORDS: ReadonlySet<string> = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/**
 * Whether the `)` at `closeParen` closes a control-flow header. The header's own `(` is matched
 * backward first, so `f(x) / 2` — a call, whose `/` divides — and a member named after a keyword
 * (`obj.if (x) / 2`, `this.#while(1) / 2`) are not headers. Only a header proved here turns the `/`
 * into a regex; every shape this walk cannot decide keeps the merge base's expression-end reading.
 */
function closesControlHeader(source: string, closeParen: number): boolean {
    const open = matchingOpenDelimiterBackward(source, closeParen, '(', ')');
    if (open === undefined) {
        return false;
    }
    const before = previousSignificantCharacter(source, open - 1);
    if (before === undefined || !isIdentifierContinue(source[before])) {
        return false;
    }
    const word = readWordBackward(source, before);
    const wordStart = before - word.length + 1;
    // `for await (…)` spells its header keyword two words before the parenthesis, and the `r` of
    // `for` in front of `await` is exactly what the member guard below reads as a member's name, so
    // the pair is read first. `await (…)` alone is an expression, not a header.
    if (word === 'await') {
        const beforeAwait = previousSignificantCharacter(source, wordStart - 1);
        if (beforeAwait === undefined) {
            return false;
        }
        const headerWord = readWordBackward(source, beforeAwait);
        return headerWord === 'for' && !isMemberNameAt(source, beforeAwait - headerWord.length + 1);
    }
    // A `#` names a private member exactly as `.` names a public one, so the member guard is the
    // shared one: `this.#while(1) / require(spec) / 2` divides rather than opening a regex that
    // swallows the load.
    if (isMemberNameAt(source, wordStart)) {
        return false;
    }
    return CONTROL_HEADER_KEYWORDS.has(word);
}

/**
 * Characters before a `{` that prove it opens an object literal rather than a type literal or a
 * block: an argument or grouping parenthesis, an array element, or a sequence or argument comma.
 * Every other character keeps the merge base's statement-end reading, because a brace that could
 * start a type literal must not divide its `}`: `=` is absent — `type T = { … }`, `A & { … }`,
 * `A | { … }`, and a plain reassignment all open types or statements, not the object literal a
 * divided `}` needs — and so are `:`, the unary, arithmetic, comparison, `?`, `&`, `|`, `!`, and `~`
 * operators, and the generic or arrow `>`. `=` is admitted separately, and only for a
 * `const`/`let`/`var` declaration target, by `objectLiteralCloseBefore`.
 */
const OPERAND_POSITION_CHARACTERS = '([,';

/**
 * The declaration keywords a `=`-preceded `{` must trace back to before it proves an object literal,
 * so a type alias's `=` keeps the merge base's reading.
 */
const ASSIGNMENT_DECLARATION_KEYWORDS: ReadonlySet<string> = new Set(['const', 'let', 'var']);

/**
 * Whether the `}` at `closeBrace` provably closes an object literal in operand position, so a `/`
 * after it divides. Only a brace whose own `{` is matched backward and stands in an operand position
 * is proved; every other `}` keeps the merge base's reading, which is what keeps a type literal's `}`
 * (`type T = { a: number }`) from turning a statement-position regex into a division.
 */
function objectLiteralCloseBefore(source: string, closeBrace: number): boolean {
    const open = matchingOpenDelimiterBackward(source, closeBrace, '{', '}');
    if (open === undefined) {
        return false;
    }
    const before = previousSignificantCharacter(source, open - 1);
    if (before === undefined) {
        return false;
    }
    const character = source.charAt(before);
    if (OPERAND_POSITION_CHARACTERS.includes(character)) {
        return true;
    }
    // `=>` is the arrow token: `() => {}` is an object literal body, so its `}` divides. A lone `=`
    // is an assignment, which proves an object literal only when its target is a `const`/`let`/`var`
    // declaration — `const r = {} / import(name) / 2` divides, while `type T = { … }` is a type.
    if (character === '=') {
        return source.charAt(before - 1) === '>'
            ? true
            : isAssignmentDeclarationTarget(source, previousSignificantCharacter(source, before - 1));
    }
    if (!isIdentifierContinue(character)) {
        return false;
    }
    const word = readWordBackward(source, before);
    // `return {}` returns an object literal, but a line terminator after `return` ends the statement,
    // and the `{` then opens a block whose close keeps the statement-end reading.
    return word === 'return' && !/[\n\r\u2028\u2029]/.test(source.slice(before + 1, open));
}

/**
 * Whether the name whose last character is at `nameIndex` — the assignment target of the `=` that
 * precedes the `{` just read — traces back to a `const`/`let`/`var` declaration. The walk passes over
 * the name itself, so a declaration target proves the object literal while a reassignment's `r = {}`
 * does not.
 */
function isAssignmentDeclarationTarget(source: string, nameIndex: number | undefined): boolean {
    if (nameIndex === undefined || !isIdentifierContinue(source[nameIndex])) {
        return false;
    }
    const name = readWordBackward(source, nameIndex);
    const keyword = previousSignificantCharacter(source, nameIndex - name.length);
    if (keyword === undefined || !isIdentifierContinue(source[keyword])) {
        return false;
    }
    return ASSIGNMENT_DECLARATION_KEYWORDS.has(readWordBackward(source, keyword));
}

/**
 * The index of the opening delimiter matching the close delimiter at `closeIndex`, walking backward
 * over whitespace, comments, string, template, and regex literals so a quote or brace inside one
 * cannot end the walk early. `undefined` when no opener matches, which callers read as "not proved".
 */
function matchingOpenDelimiterBackward(
    source: string,
    closeIndex: number,
    open: string,
    close: string
): number | undefined {
    let cursor = closeIndex - 1;
    let depth = 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            // A `*`-preceded slash is a comment close only where its `/*` opener stands; without one it
            // is a regex body ending in `*`, and the regex handling below crosses it rather than the
            // walk failing over a comment it cannot place.
            const commentOpen = source.lastIndexOf('/*', cursor - 1);
            if (commentOpen !== -1) {
                cursor = commentOpen - 1;
                continue;
            }
        } else {
            const lineComment = lineCommentOpenBefore(source, cursor);
            if (lineComment !== undefined) {
                cursor = lineComment - 1;
                continue;
            }
        }
        if (character === '"' || character === "'") {
            const quoteOpen = skipQuotedBackward(source, cursor, character);
            cursor = quoteOpen === undefined ? cursor - 1 : quoteOpen - 1;
            continue;
        }
        if (character === '`') {
            const templateOpen = skipTemplateBackward(source, cursor);
            cursor = templateOpen === undefined ? cursor - 1 : templateOpen - 1;
            continue;
        }
        if (character === '/') {
            const regexOpen = regexLiteralOpenBackward(source, cursor);
            // Only an opener that stands at a regex position starts a literal. Two division slashes
            // otherwise pair — `a / g(b / c)` reads as a literal from the second `/` back to the
            // first — and the walk then steps over the `(` or `{` between them, hiding a load the
            // merge base refused.
            if (regexOpen !== undefined && canStartRegexLiteral(source, regexOpen)) {
                cursor = regexOpen - 1;
                continue;
            }
        }
        if (character === close) {
            depth += 1;
            cursor -= 1;
            continue;
        }
        if (character === open) {
            depth -= 1;
            if (depth === 0) {
                return cursor;
            }
            cursor -= 1;
            continue;
        }
        cursor -= 1;
    }
    return undefined;
}

/**
 * The index of the opening `/` of the regex literal whose closing `/` is at `closeSlash`, or
 * `undefined` when the slash closes no literal. The body is walked backward over escapes and
 * character classes, so a `[` or an escaped `/` inside a regex cannot pass for its delimiter.
 */
function regexLiteralOpenBackward(source: string, closeSlash: number): number | undefined {
    let cursor = closeSlash - 1;
    let inClass = false;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (character === '\\') {
            cursor -= 2;
            continue;
        }
        if (inClass) {
            if (character === '[') {
                inClass = false;
            }
            cursor -= 1;
            continue;
        }
        if (character === ']') {
            inClass = true;
            cursor -= 1;
            continue;
        }
        if (character === '/') {
            return cursor;
        }
        if (isLineTerminator(character)) {
            return undefined;
        }
        cursor -= 1;
    }
    return undefined;
}

/** The index of the last character before `index` that is neither whitespace nor a comment. */
function previousSignificantCharacter(source: string, index: number): number | undefined {
    let cursor = index;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const commentOpen = source.lastIndexOf('/*', cursor - 1);
            if (commentOpen === -1) {
                return undefined;
            }
            cursor = commentOpen - 1;
            continue;
        }
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        return cursor;
    }
    return undefined;
}

function skipQuoted(source: string, index: number, quote: "'" | '"'): number {
    let cursor = index + 1;
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (character === quote) {
            return cursor + 1;
        }
        cursor += 1;
    }
    return source.length;
}

type ReadSpecifier = { value: string; end: number };

function readModuleStringAfter(source: string, index: number): ReadSpecifier | undefined {
    const start = skipWhitespace(source, index);
    const quote = source[start];
    if (quote === "'" || quote === '"') {
        return readQuotedValue(source, start, quote);
    }
    if (quote === '`') {
        return readStaticTemplateValue(source, start);
    }
    return undefined;
}

function readDynamicImportSpecifier(source: string, index: number): ReadSpecifier | undefined {
    let cursor = skipWhitespace(source, index);
    if (source[cursor] !== '(') {
        return undefined;
    }
    cursor += 1;
    while (true) {
        cursor = skipWhitespace(source, cursor);
        while (source[cursor] === '<') {
            const afterType = skipTypeArguments(source, cursor, source.length);
            if (afterType === undefined) {
                break;
            }
            cursor = skipWhitespace(source, afterType);
        }
        if (source[cursor] !== '(') {
            break;
        }
        cursor += 1;
    }
    return readModuleStringAfter(source, cursor);
}

function skipBalancedParens(source: string, index: number): number | undefined {
    if (source[index] !== '(') {
        return undefined;
    }
    let cursor = index;
    let depth = 0;
    while (cursor < source.length) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = commentEnd;
            continue;
        }
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, source.length, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
        if (character === '(') {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === ')') {
            depth -= 1;
            cursor += 1;
            if (depth === 0) {
                return cursor;
            }
            continue;
        }
        cursor += 1;
    }
    return undefined;
}

function readImportMetaResolveSpecifier(source: string, index: number): ReadSpecifier | undefined {
    if (!isKeywordAt(source, index, 'import') || isPrecededByDotAccess(source, index)) {
        return undefined;
    }
    let cursor = skipWhitespace(source, index + 6);
    if (source.startsWith('?.', cursor)) {
        cursor = skipWhitespace(source, cursor + 2);
    } else if (source[cursor] === '.') {
        cursor = skipWhitespace(source, cursor + 1);
    } else {
        return undefined;
    }
    if (!isKeywordAt(source, cursor, 'meta')) {
        return undefined;
    }
    cursor = skipWhitespace(source, cursor + 4);
    if (source.startsWith('?.', cursor)) {
        cursor = skipWhitespace(source, cursor + 2);
    } else if (source[cursor] === '.') {
        cursor = skipWhitespace(source, cursor + 1);
    } else {
        return undefined;
    }
    if (!isKeywordAt(source, cursor, 'resolve')) {
        return undefined;
    }
    let afterResolve = skipWhitespace(source, cursor + 7);
    if (source.startsWith('?.', afterResolve) && source[skipWhitespace(source, afterResolve + 2)] === '(') {
        afterResolve = skipWhitespace(source, afterResolve + 2);
    }
    return readDynamicImportSpecifier(source, afterResolve);
}

function isPrecededByDotAccess(source: string, index: number): boolean {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor]!;
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                break;
            }
            cursor = open - 1;
            continue;
        }
        // A `//` comment's last character is not a token: a comment ending in `.` would otherwise be
        // read as the member-access dot. Skip back to before the `//` so the token before the name is
        // read, matching the declaration-context walk.
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '.') {
            // A spread's three dots are not member access; skip the whole token so the token before
            // the spread decides.
            if (cursor >= 2 && source.slice(cursor - 2, cursor + 1) === '...') {
                cursor -= 3;
                continue;
            }
            return true;
        }
        return false;
    }
    return false;
}

/**
 * Whether the name beginning at `index` is a member name rather than a keyword: a `.` (`obj.else`,
 * `obj?.else`) or a `#` (`this.#else`) immediately before it means the name is read as a member. Only
 * those spellings name a member — a plain identifier character ending the previous token is not member
 * access (`e in /re/` reads `in` as the operator, not a member of `e`). A `/` after a member ends an
 * expression and divides; only the bare keyword is followed by a statement, so only the bare keyword
 * can turn the `/` into a regex.
 *
 * A `.` or a `#` keeps its member reading across a line break — `obj.` newline `else / x` is still a
 * member. Same-line comments and whitespace are crossed in both cases, and a block comment that itself
 * spans lines ends the walk.
 */
function isMemberNameAt(source: string, index: number): boolean {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source.charAt(cursor);
        if (isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (isWhiteSpace(character)) {
            cursor -= 1;
            continue;
        }
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            if (lineComment === 0) {
                return false;
            }
            cursor = lineComment - 1;
            continue;
        }
        // A `/` the `*` before it opens is read as a block comment's close, exactly as the sibling
        // member-dot judgement reads it; a `*/` whose `/*` opener is absent — a regex body ending in
        // `*` — and a bare `/` here are both no comment close, so the walk stops rather than jumping
        // back to an identifier that does not name this keyword.
        if (character === '/' && source.charAt(cursor - 1) === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return false;
            }
            const comment = source.slice(open, cursor + 1);
            if (comment.includes('\n') || comment.includes('\r')) {
                return false;
            }
            cursor = open - 1;
            continue;
        }
        if (character === '.') {
            // A dot following a run of digits is a numeric literal's point only when that run holds no
            // other dot — `1.` is a point, while the second dot of `1.1.` is member access. A spread's
            // three dots are no member either; a point or a spread skips the token so the word before it
            // decides, exactly as `isPrecededByDotAccess` reads a dotted name.
            const isSpread = source.charAt(cursor - 1) === '.' && source.charAt(cursor - 2) === '.';
            const isNumericPoint = isNumericLiteralPoint(source, cursor);
            if (!isSpread && !isNumericPoint) {
                return true;
            }
            cursor = isSpread ? cursor - 3 : cursor - 2;
            continue;
        }
        return character === '#';
    }
    return false;
}

/**
 * Whether the `.` at `cursor` is a numeric literal's point: the run of digits and dots ending at
 * `cursor - 1` holds digits only, so `1.` and `1_000.` are points while the second dot of `1.1.` is
 * member access. The run must be a bare decimal's integer part: a run that continues an identifier
 * (`x1.`, `item2.`, `a1.`, `_1.`, `$1.`) or that is a number's exponent (`1e3.`, `1e+3.`, `1E+3.`) or
 * radix digits (`0x11.`, `0o17.`, `0b11.`) is not one, so its dot is member access.
 */
function isNumericLiteralPoint(source: string, cursor: number): boolean {
    if (!isDecimalDigit(source.charAt(cursor - 1))) {
        return false;
    }
    let run = cursor - 1;
    while (run >= 0 && (isDecimalDigit(source[run]) || source[run] === '.')) {
        if (source[run] === '.') {
            return false;
        }
        run -= 1;
    }
    const before = source[run];
    // A `_` directly after a digit is a numeric separator (`1_000.`), not an identifier tail, so it
    // keeps the run a plain decimal's integer part.
    const separator = before === '_' && isDecimalDigit(source[run - 1]);
    // A letter, digit, underscore, or `$` before the run continues an identifier, so the run is its
    // tail. The same check catches an unsigned exponent and a radix prefix, whose marker (`e`/`E`,
    // `x`/`X`/`o`/`O`/`b`/`B`) is a letter.
    if (isIdentifierContinue(before) && !separator) {
        return false;
    }
    // A `+`/`-` after a digit-adjacent exponent marker is the exponent's sign (`1e+3.`, `1E+3.`); a
    // sign after an identifier ending in `e` (`mode+3.`) is an operator, so the run stays a plain
    // decimal.
    if (before === '+' || before === '-') {
        const signBefore = run >= 1 ? source[run - 1] : undefined;
        if ((signBefore === 'e' || signBefore === 'E') && isDecimalDigit(source[run - 2])) {
            return false;
        }
    }
    return true;
}

function readQuotedValue(source: string, index: number, quote: "'" | '"'): ReadSpecifier | undefined {
    let cursor = index + 1;
    let value = '';
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
            if (cursor + 1 >= source.length) {
                return undefined;
            }
            value += source[cursor + 1];
            cursor += 2;
            continue;
        }
        if (character === quote) {
            return { value, end: cursor + 1 };
        }
        if (character === '\n' || character === '\r') {
            return undefined;
        }
        value += character;
        cursor += 1;
    }
    return undefined;
}

function isWhiteSpace(character: string): boolean {
    return (
        character === '\t' ||
        character === '\v' ||
        character === '\f' ||
        character === ' ' ||
        character === '\u00A0' ||
        character === '\uFEFF' ||
        /\p{General_Category=Space_Separator}/u.test(character)
    );
}

function readStaticTemplateValue(source: string, index: number): ReadSpecifier | undefined {
    let cursor = index + 1;
    let value = '';
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
            if (cursor + 1 >= source.length) {
                return undefined;
            }
            value += source[cursor + 1];
            cursor += 2;
            continue;
        }
        if (character === '`') {
            return { value, end: cursor + 1 };
        }
        if (character === '$' && source[cursor + 1] === '{') {
            return undefined;
        }
        value += character;
        cursor += 1;
    }
    return undefined;
}

function skipWhitespace(source: string, index: number): number {
    let cursor = index;
    while (cursor < source.length) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = commentEnd;
            continue;
        }
        const character = source[cursor];
        if (character !== undefined && (isWhiteSpace(character) || isLineTerminator(character))) {
            cursor += 1;
            continue;
        }
        break;
    }
    return cursor;
}

export function bareModuleSpecifiers(source: string): string[] {
    return snapshotImportSpecifiers(source).filter(
        (specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:')
    );
}

function localModuleDependencies(path: string, source: string): string[] {
    const dependencies = snapshotImportSpecifiers(source)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => posix.normalize(posix.join(posix.dirname(path), specifier)));
    return [...new Set(dependencies)];
}

/**
 * The static local-import closure of `entry`: every module reached by walking `./`-relative literal or
 * static-template imports from `entry` and, transitively, from each module it reaches, using the same
 * import scan the graph check uses. Type-only edges (`import type`, `export type ... from`) are
 * included deliberately: Node's type stripping erases them, so this closure is a superset of what the
 * command actually executes, but the very same union feeds the governance risk classification and must
 * not shrink — narrowing it to the executed graph would silently drop a changed script from
 * `native-security` classification. `readSource` supplies each module's source from the working tree,
 * so the walk crosses an undeclared intermediate instead of stopping at it. The walk refuses rather
 * than silently truncates: a reached module with no source, or a computed `import(expr)` /
 * `require(expr)` / `createRequire(...)(expr)` specifier, throws — those shapes cannot be resolved from
 * a snapshot and must not be skipped. The computed shapes the #4818 rules do not model — a callee
 * bound to another bound name, a `.resolve`/`.bind` member, a call whose callee is reached through
 * the enclosing call's argument list (`pass(require)(spec)`), and a call the declaration-context rule
 * cannot separate from a declaration — keep the merge base's reading and stay with #4835. The loader
 * itself is deliberately absent from a command's
 * executed graph — no executed source may import it, which `assertTrustedSourceGraph` refuses — so a
 * command's declared set is exactly this closure plus the loader's own static-import closure. Exported
 * so the specs pinning each command's declared set to its static closure can see over- and
 * under-declaration, which the runtime check alone cannot: it only proves the declared set is closed
 * under imports.
 */
export function trustedLocalImportClosure(
    entry: string,
    readSource: (path: string) => string | undefined
): ReadonlySet<string> {
    const closure = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
        const path = pending.pop();
        if (path === undefined || closure.has(path)) {
            continue;
        }
        closure.add(path);
        const source = readSource(path);
        if (source === undefined) {
            throw new Error(`local import closure cannot read ${path}, which ${entry} reaches`);
        }
        for (const shape of snapshotComputedDynamicSpecifiers(source)) {
            throw new Error(
                `${path} loads a module through a computed ${shape} specifier, which the trusted snapshot cannot resolve`
            );
        }
        for (const dependency of localModuleDependencies(path, source)) {
            if (!closure.has(dependency)) {
                pending.push(dependency);
            }
        }
    }
    return closure;
}

export async function runTrustedGithubWriteCommand(
    command: TrustedGithubWriteCommand,
    args: string[],
    port: TrustedSourcePort
): Promise<number> {
    const commit = port.resolveOriginMain();
    return runTrustedGithubWriteCommandAtCommit(command, args, port, commit);
}

async function runTrustedGithubWriteCommandAtCommit(
    command: TrustedGithubWriteCommand,
    args: string[],
    port: TrustedSourcePort,
    commit: string
): Promise<number> {
    if (commit.trim() === '') {
        throw new Error('origin/main did not resolve to a commit');
    }
    // Every script the command *executes* is read from `origin/main` and run
    // from the snapshot below, so whatever a lane holds for those — mutated, or
    // merely older than main — cannot reach the GitHub write. Refusing on a
    // difference protected none of them any further, and it forced a lane that
    // had only fallen behind to merge main first. A merge can resolve cleanly
    // and leave generated artifacts stale, so that requirement cost real safety
    // to buy none.
    //
    // The package route is accepted only from the protected primary checkout,
    // where this loader is compared with the pinned origin commit before the
    // closure runs. A lane path is command data; no lane package or helper is an
    // executable input to this process.
    const sources = new Map<string, string>();
    for (const path of trustedDependencyPaths(command)) {
        sources.set(path, port.readOriginSource(commit, path));
    }
    assertTrustedSourceGraph(command, sources);
    const gateWorkflow = command === 'deliver' ? await readGateWorkflow(port, commit) : undefined;
    return port.executeSnapshot(command, args, { commit, sources, gateWorkflow });
}

function errorDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The one dependency this loader takes beyond Node's builtins, and deliberately so: `yaml` is the
 * parser the GitHub-adjacent tooling in this repository already uses, and the launcher runs from the
 * protected primary checkout where it resolves.
 *
 * It is imported here rather than at the top of the file for two reasons. Only `deliver` needs a
 * workflow, so every other command must not fail to start over a package it never reads. And a
 * failure to resolve it arrives as a rejected promise the caller turns into a
 * refusal, where a static import would instead kill the process with `ERR_MODULE_NOT_FOUND` — the
 * merge gate must refuse when it cannot parse the workflow, never crash past the question.
 */
async function parseYaml(source: string): Promise<unknown> {
    const { parse } = await import('yaml');
    return parse(source);
}

/**
 * Only `deliver` reads a workflow, and it reads it at the same pinned commit its own code came from
 * — never the working tree, never a local `HEAD`, either of which would let one unpulled or
 * uncommitted edit reshape the merge gate.
 *
 * An unreadable workflow is carried across as a reason rather than thrown here, so the refusal is
 * worded and owned by the gate. Nothing is resolved or filtered on the way: whatever the workflow
 * declares for a job arrives as it was written.
 */
async function readGateWorkflow(port: TrustedSourcePort, commit: string): Promise<TrustedGateWorkflow> {
    let source: string;
    try {
        source = port.readOriginSource(commit, HEALTH_GATES_WORKFLOW_PATH);
    } catch (error) {
        return { unreadable: `it cannot be read at ${commit}: ${errorDetail(error)}` };
    }
    return summarizeGateWorkflow(source, (usesPath) => port.readOriginSource(commit, usesPath));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The parse the gate cannot perform for itself. A real YAML parser is the point: a line-oriented
 * reader diverges from it on continuation, key spelling, comment separators, block scalars, anchors,
 * aliases, tags and field indentation, and each divergence silently yields a check name GitHub never
 * reports — which matches nothing, and tolerates the cancellation it was meant to catch.
 */
export async function summarizeGateWorkflow(
    source: string,
    readCalled?: (usesPath: string) => string
): Promise<TrustedGateWorkflow> {
    let workflow: unknown;
    try {
        workflow = await parseYaml(source);
    } catch (error) {
        return { unreadable: `it is not valid YAML: ${errorDetail(error)}` };
    }
    const jobs = isRecord(workflow) ? workflow.jobs : undefined;
    if (!isRecord(jobs)) {
        return { unreadable: 'it declares no jobs mapping' };
    }
    const summary = summarizeJobs(jobs);
    const called: Record<string, TrustedCalledWorkflow> = Object.create(null) as Record<string, TrustedCalledWorkflow>;
    if (readCalled !== undefined) {
        for (const job of Object.values(summary)) {
            // Only a local call can be read at the pinned commit. Anything else stays uncarried, and
            // deriving what that means stays the gate's rule exactly as an unreadable file does.
            if (typeof job.uses !== 'string' || !job.uses.startsWith('./') || job.uses in called) {
                continue;
            }
            called[job.uses] = await summarizeCalledWorkflow(job.uses, readCalled);
        }
    }
    return { jobs: summary, called };
}

/**
 * A called workflow crosses with the same fidelity as the caller: nothing resolved, nothing
 * filtered. A file that cannot be read or parsed crosses as the reason, so the refusal is worded
 * and owned by the gate rather than thrown here.
 */
async function summarizeCalledWorkflow(
    usesPath: string,
    readCalled: (usesPath: string) => string
): Promise<TrustedCalledWorkflow> {
    let source: string;
    try {
        source = readCalled(usesPath);
    } catch (error) {
        return { unreadable: `it cannot be read at the pinned commit: ${errorDetail(error)}` };
    }
    let workflow: unknown;
    try {
        workflow = await parseYaml(source);
    } catch (error) {
        return { unreadable: `it is not valid YAML: ${errorDetail(error)}` };
    }
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        return { unreadable: 'it declares no jobs mapping' };
    }
    return { name: carriedName(workflow.name), jobs: summarizeJobs(workflow.jobs) };
}

function summarizeJobs(jobs: Record<string, unknown>): Record<string, TrustedWorkflowJob> {
    // A job id is workflow-controlled text, and GitHub accepts `__proto__` as one. Assigning that
    // key on an object literal moves the prototype instead of creating an own property, and
    // `JSON.stringify` then drops the job from the summary entirely — so the gate never sees a job
    // the workflow declares. A prototype-free map has no such key to hit.
    const summary: Record<string, TrustedWorkflowJob> = Object.create(null) as Record<string, TrustedWorkflowJob>;
    for (const [jobId, job] of Object.entries(jobs)) {
        summary[jobId] = isRecord(job)
            ? { name: carriedName(job.name), needs: job.needs, uses: job.uses, strategy: job.strategy }
            : {};
    }
    return summary;
}

/** What a name that is not text crosses as, chosen so no `JSON.stringify` can turn it back into text. */
const NON_TEXT_NAME = { notText: true };

/**
 * The summary crosses to the gate as JSON, which carries less than YAML produces: `Infinity` and
 * `NaN` — what `.inf` and `.nan` parse to — are written as `null`, and a timestamp is written as a
 * quoted string. Either way the gate stops seeing a name that is not text: `null` reads as "declares
 * no name" and answers with the job id, and a quoted timestamp reads as a name GitHub never reports.
 * Both erase the refusal such a declaration is owed, so anything but a string crosses as a value
 * that is not text on either side of the boundary. Deciding what that means stays the gate's rule.
 */
function carriedName(name: unknown): unknown {
    if (name === undefined || name === null || typeof name === 'string') {
        return name;
    }
    return NON_TEXT_NAME;
}

export async function executeTrustedSnapshot(
    command: TrustedGithubWriteCommand,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    runSnapshot: SnapshotRunner = runSnapshotModule
): Promise<number> {
    const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-write-'));
    try {
        for (const [path, source] of snapshot.sources) {
            if (!path.startsWith('scripts/') || posix.normalize(path) !== path || path.includes('..')) {
                throw new Error(`invalid trusted snapshot path ${path}`);
            }
            const target = resolve(snapshotRoot, path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        }
        const entry = commandEntries[command];
        const result = await runSnapshot(resolve(snapshotRoot, entry.path), entry.runner, args, snapshot, command);
        if (!Number.isSafeInteger(result)) {
            throw new TypeError(`trusted ${command} snapshot returned an invalid exit code`);
        }
        return result;
    } finally {
        rmSync(snapshotRoot, { recursive: true, force: true });
    }
}

async function runSnapshotModule(
    entryPath: string,
    runner: string,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    command: TrustedGithubWriteCommand
): Promise<number> {
    const source = [
        "import { pathToFileURL } from 'node:url';",
        'const [entryPath, runner, ...args] = process.argv.slice(2);',
        'const loaded = await import(pathToFileURL(entryPath).href);',
        'const command = Reflect.get(loaded, runner);',
        "if (typeof command !== 'function') throw new Error(`trusted snapshot does not export ${runner}`);",
        'const trustedLauncher = typeof process.env.SOURDAW_TRUSTED_PRIMARY_ROOT === "string" && typeof process.env.SOURDAW_TRUSTED_GIT_PATH === "string" && typeof process.env.SOURDAW_TRUSTED_GH_PATH === "string" ? { primaryRoot: process.env.SOURDAW_TRUSTED_PRIMARY_ROOT, gitPath: process.env.SOURDAW_TRUSTED_GIT_PATH, ghPath: process.env.SOURDAW_TRUSTED_GH_PATH, ...(typeof process.env.SOURDAW_TRUSTED_PS_PATH === "string" ? { psPath: process.env.SOURDAW_TRUSTED_PS_PATH } : {}), ...(typeof process.env.SOURDAW_TRUSTED_POWERSHELL_PATH === "string" ? { powershellPath: process.env.SOURDAW_TRUSTED_POWERSHELL_PATH } : {}), ...(typeof process.env.SOURDAW_TRUSTED_GIT_AI_PATH === "string" ? { gitAiPath: process.env.SOURDAW_TRUSTED_GIT_AI_PATH } : {}) } : undefined;',
        'const dependencies = runner === "runDeliverCli" ? { trustedLauncher } : undefined;',
        'const result = dependencies === undefined ? await command(args) : await command(args, dependencies);',
        "if (!Number.isSafeInteger(result)) throw new Error('trusted snapshot returned an invalid exit code');",
        'process.exitCode = result;',
    ].join('\n');
    const detached = trustedSnapshotRunsDetached(command);
    const child = spawn(
        process.execPath,
        ['--input-type=module', '--eval', source, 'trusted-snapshot-runner', entryPath, runner, ...args],
        {
            cwd: process.cwd(),
            env: trustedSnapshotEnv(snapshot),
            stdio: 'inherit',
            shell: false,
            detached,
        }
    );
    if (child.pid === undefined) {
        throw new Error('trusted snapshot launcher could not determine the child process');
    }
    const restoreSignalHandlers = detached ? forwardSnapshotSignals(child.pid, process.platform) : () => undefined;
    try {
        const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>(
            (resolve, reject) => {
                child.once('error', reject);
                child.once('close', (status, signal) => resolve({ status, signal }));
            }
        );
        if (result.status === null) {
            throw new Error(`trusted snapshot terminated by ${result.signal ?? 'unknown signal'}`);
        }
        if (result.status !== 0) {
            throw new Error(`trusted snapshot failed with exit ${result.status}`);
        }
        return result.status;
    } finally {
        restoreSignalHandlers();
    }
}

function forwardSnapshotSignals(pid: number, platform: NodeJS.Platform): () => void {
    const forward = (signal: NodeJS.Signals) => forwardTrustedSnapshotSignal(pid, true, platform, signal);
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const signal of signals) {
        process.on(signal, forward);
    }
    return () => {
        for (const signal of signals) {
            process.off(signal, forward);
        }
    };
}

export function trustedSnapshotEnv(
    snapshot: TrustedSourceSnapshot,
    parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env = trustedGitReadEnv(parent);
    if (snapshot.gateWorkflow !== undefined) {
        env[TRUSTED_GATE_WORKFLOW_ENV] = JSON.stringify(snapshot.gateWorkflow);
    }
    const launcher = snapshot.launcher;
    if (launcher === undefined) {
        return env;
    }
    env.PATH = [
        ...new Set([
            dirname(launcher.gitPath),
            dirname(launcher.ghPath),
            ...(launcher.psPath === undefined ? [] : [dirname(launcher.psPath)]),
            ...(launcher.powershellPath === undefined ? [] : [dirname(launcher.powershellPath)]),
            ...(launcher.gitAiPath === undefined ? [] : [dirname(launcher.gitAiPath)]),
            dirname(process.execPath),
        ]),
    ].join(delimiter);
    env[TRUSTED_PRIMARY_ROOT_ENV] = launcher.primaryRoot;
    env[TRUSTED_COMMON_DIR_ENV] = launcher.commonDir;
    env[TRUSTED_GIT_PATH_ENV] = launcher.gitPath;
    env[TRUSTED_GH_PATH_ENV] = launcher.ghPath;
    if (launcher.psPath !== undefined) {
        env[TRUSTED_PS_PATH_ENV] = launcher.psPath;
    }
    if (launcher.powershellPath !== undefined) {
        env[TRUSTED_POWERSHELL_PATH_ENV] = launcher.powershellPath;
    }
    if (launcher.gitAiPath !== undefined) {
        env[TRUSTED_GIT_AI_PATH_ENV] = launcher.gitAiPath;
    }
    env[TRUSTED_ORIGIN_COMMIT_ENV] = snapshot.commit;
    return env;
}

function captureGit(repositoryRoot: string, gitPath: string, args: string[]): string {
    const result = spawnSync(gitPath, args, {
        cwd: repositoryRoot,
        env: trustedGitReadEnv(),
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout;
}

// This loader must remain self-contained until it has pinned and validated the source closure, so
// the Git-read environment intentionally duplicates the identity helper's policy instead of
// importing lane-local code before trust is established.
export function trustedGitReadEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parent };
    for (const key of Object.keys(env)) {
        const normalizedKey = key.toUpperCase();
        if (
            normalizedKey.startsWith('GIT_') ||
            normalizedKey.startsWith('GH_') ||
            normalizedKey.startsWith('GITHUB_') ||
            normalizedKey.startsWith('SOURDAW_GITHUB_APP_') ||
            normalizedKey.startsWith('SOURDAW_TRUSTED_') ||
            normalizedKey.startsWith('NODE_') ||
            normalizedKey === 'SSH_AUTH_SOCK'
        ) {
            delete env[key];
        }
    }
    env.GIT_CONFIG_GLOBAL = '/dev/null';
    env.GIT_CONFIG_SYSTEM = '/dev/null';
    env.GIT_NO_REPLACE_OBJECTS = '1';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_SSH_COMMAND = '/usr/bin/false';
    env.GIT_SSH = '/usr/bin/false';
    env.GCM_INTERACTIVE = 'never';
    return env;
}

export function resolveTrustedExecutable(
    name: 'git' | 'gh' | 'ps' | 'git-ai',
    parent: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string {
    const extensions = platform === 'win32' ? ['.exe'] : [''];
    for (const directory of (parent.PATH ?? '').split(platform === 'win32' ? ';' : delimiter)) {
        for (const extension of extensions) {
            const candidate = resolve(directory || process.cwd(), `${name}${extension.toLowerCase()}`);
            try {
                accessSync(candidate, constants.X_OK);
                return realpathSync(candidate);
            } catch {
                // Try the next operator-provided PATH entry. The protected launcher freezes the
                // first executable it finds before any lane-selected child starts.
            }
        }
    }
    throw new Error(`cannot resolve trusted ${name} executable from the launcher PATH`);
}

/**
 * git-ai is operator tooling the delivery authorship sync uses when present; an operator
 * without it keeps the documented skip, so resolution is optional rather than fatal.
 */
function resolveOptionalTrustedExecutable(
    name: 'git-ai',
    parent: NodeJS.ProcessEnv,
    platform: NodeJS.Platform
): string | undefined {
    try {
        return resolveTrustedExecutable(name, parent, platform);
    } catch {
        return undefined;
    }
}

function resolveTrustedPowerShellExecutable(
    parent: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string {
    const extensions = platform === 'win32' ? ['.exe'] : [''];
    for (const directory of (parent.PATH ?? '').split(platform === 'win32' ? ';' : delimiter)) {
        for (const extension of extensions) {
            const suffix = extension === '' ? '' : extension.toLowerCase();
            const candidate = resolve(directory || process.cwd(), `powershell${suffix}`);
            try {
                accessSync(candidate, constants.X_OK);
                return realpathSync(candidate);
            } catch {
                // Try the next operator-provided PATH entry. The protected launcher freezes the
                // first executable it finds before any lane-selected child starts.
            }
        }
    }
    throw new Error('cannot resolve trusted powershell executable from the launcher PATH');
}

function repositoryCommonDir(checkoutRoot: string, gitPath: string): string {
    const value = captureGit(checkoutRoot, gitPath, ['rev-parse', '--git-common-dir']).trim();
    return realpathSync(isAbsolute(value) ? value : resolve(checkoutRoot, value));
}

export function resolveTrustedLauncherBinding(
    launcherRoot: string,
    parent: NodeJS.ProcessEnv = process.env,
    command?: TrustedGithubWriteCommand,
    platform: NodeJS.Platform = process.platform
): TrustedLauncherBinding {
    const root = realpathSync(launcherRoot);
    const gitPath = resolveTrustedExecutable('git', parent, platform);
    const commonDir = repositoryCommonDir(root, gitPath);
    const primaryRoot = realpathSync(dirname(commonDir));
    if (root !== primaryRoot) {
        throw new Error('trusted GitHub writes must be launched from the protected primary checkout');
    }
    return {
        primaryRoot,
        commonDir,
        gitPath,
        ghPath: resolveTrustedExecutable('gh', parent, platform),
        psPath: commandRequiresTrustedPs(command, platform)
            ? resolveTrustedExecutable('ps', parent, platform)
            : undefined,
        gitAiPath: command === 'deliver' ? resolveOptionalTrustedExecutable('git-ai', parent, platform) : undefined,
        powershellPath: commandRequiresTrustedPowerShell(command, platform)
            ? resolveTrustedPowerShellExecutable(parent, platform)
            : undefined,
    };
}

function commandRequiresTrustedPs(command: TrustedGithubWriteCommand | undefined, platform: NodeJS.Platform): boolean {
    return platform !== 'win32' && commandFencesItsLockOwner(command);
}

function commandRequiresTrustedPowerShell(
    command: TrustedGithubWriteCommand | undefined,
    platform: NodeJS.Platform
): boolean {
    return platform === 'win32' && commandFencesItsLockOwner(command);
}

/**
 * The launcher's snapshot is only as current as whatever process last fetched the primary's
 * origin/main ref: run right after a lane merges, a launcher that resolves without fetching
 * silently executes the pre-merge closure and reproduces failures the merge just fixed (#4436).
 * Every resolution therefore fetches first, under the operator's ambient environment — the
 * pre-trust window the delivery skill already treats as trusted — because the scrubbed
 * read-only environment strips the credential helper a non-anonymous remote needs. A failed
 * fetch never refuses the run: offline operation keeps working against the local ref, but
 * never silently — the staleness risk and the fetch error are both reported.
 */
export type OriginFetchOutcome = { fresh: true } | { fresh: false; reason: string };

export type OriginFetchSpawn = (
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv }
) => { status: number | null; stderr: string | undefined };

export function fetchOriginMain(
    input: { gitPath: string; primaryRoot: string },
    spawn: OriginFetchSpawn = (command, args, options) => spawnSync(command, args, { ...options, encoding: 'utf8' })
): OriginFetchOutcome {
    const result = spawn(input.gitPath, ['fetch', 'origin', 'main'], {
        cwd: input.primaryRoot,
        env: process.env,
    });
    if (result.status === 0) {
        return { fresh: true };
    }
    const detail = result.stderr?.trim();
    if (detail !== undefined && detail !== '') {
        return { fresh: false, reason: detail };
    }
    return { fresh: false, reason: `git fetch failed without diagnostics (exit ${result.status ?? 'signal'})` };
}

export function defaultPort(binding: TrustedLauncherBinding): TrustedSourcePort {
    return {
        resolveOriginMain: () => {
            const fetch = fetchOriginMain(binding);
            if (!fetch.fresh) {
                console.error(
                    `cannot fetch origin/main (${fetch.reason}); the trusted snapshot may be stale — ` +
                        'this run executes whatever refs/remotes/origin/main last fetched'
                );
            }
            return captureGit(binding.primaryRoot, binding.gitPath, [
                'rev-parse',
                '--verify',
                'refs/remotes/origin/main^{commit}',
            ]).trim();
        },
        readOriginSource: (commit, path) =>
            captureGit(binding.primaryRoot, binding.gitPath, ['show', `${commit}:${path}`]),
        executeSnapshot: (command, args, snapshot) =>
            executeTrustedSnapshot(command, args, { ...snapshot, launcher: binding }),
    };
}

function parseCommand(value: string | undefined): TrustedGithubWriteCommand {
    if (
        value === 'deliver' ||
        value === 'issue:claim' ||
        value === 'issue:reconcile' ||
        value === 'lane:publish' ||
        value === 'lane:sync-parent' ||
        value === 'review:accept' ||
        value === 'review:publish' ||
        value === 'review:publish:recover' ||
        value === 'review:repair' ||
        value === 'review:confirm' ||
        value === 'review:resolve' ||
        value === 'review:shadow-status' ||
        value === 'ruleset:harden'
    ) {
        return value;
    }
    throw new Error(
        'usage: trustedGithubWriteBootstrap.ts <deliver|issue:claim|issue:reconcile|lane:publish|lane:sync-parent|review:accept|review:publish|review:publish:recover|review:repair|review:confirm|review:resolve|review:shadow-status|ruleset:harden> [args...]'
    );
}

async function main(): Promise<number> {
    const executingFile = fileURLToPath(import.meta.url);
    const launcherRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const command = parseCommand(process.argv[2]);
    const binding = resolveTrustedLauncherBinding(launcherRoot, process.env, command);
    const port = defaultPort(binding);
    const commit = port.resolveOriginMain();
    const originBootstrap = port.readOriginSource(commit, BOOTSTRAP_PATH);
    if (readFileSync(executingFile, 'utf8') !== originBootstrap) {
        throw new Error('protected primary launcher does not match its pinned origin/main snapshot');
    }
    return runTrustedGithubWriteCommandAtCommit(command, process.argv.slice(3), port, commit);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
