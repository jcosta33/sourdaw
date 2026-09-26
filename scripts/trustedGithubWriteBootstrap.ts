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
const importSpecifiersCache = new Map<string, string[]>();

export function snapshotImportSpecifiers(source: string): string[] {
    const cached = importSpecifiersCache.get(source);
    if (cached !== undefined) {
        return [...cached];
    }
    const specifiers = new Set<string>();
    scanImportSpecifiers(source, 0, source.length, specifiers);
    const result = [...specifiers];
    importSpecifiersCache.set(source, result);
    return [...result];
}

const COMPUTED_DYNAMIC_IMPORT_SHAPE = 'import(...)';
const COMPUTED_REQUIRE_SHAPE = 'require(...)';
const COMPUTED_CREATE_REQUIRE_SHAPE = 'createRequire(...)(...)';

const computedDynamicSpecifiersCache = new Map<string, string[]>();

/**
 * The module-loading shapes whose specifier is computed rather than a literal the snapshot can
 * satisfy: `import(expr)`, `require(expr)` / `require.resolve(expr)`, and
 * `createRequire(...)(expr)`. A literal or static-template specifier is carried by
 * `snapshotImportSpecifiers`; a computed one is exactly what the graph check must not silently
 * ignore, because the snapshot writes only the declared sources into a temporary directory and a
 * computed specifier then resolves nothing there — the command dies mid-delivery with
 * `ERR_MODULE_NOT_FOUND` while every graph check reports coverage it does not have. Each such shape
 * is refused, naming the file and the shape. Wrapped and bound callees — `(0, require)(expr)`,
 * `(require)(expr)`, a wrapped callee in a declaration-like position (`flag ? (0, require)(expr) : …`,
 * a heritage clause, a `case`, or a statement before a block), `const load = require; load(expr)`,
 * `require.call(null, expr)` / `require.apply(null, args)`, and `require.bind(null)(expr)`, whose
 * second call carries the specifier — are resolved, so they are refused too rather than silently
 * skipped. The single-file binding pass reads a loader declaration in this file: a loader name
 * declared `const`/`let`/`var`, in any declarator of its declaration, whose initializer is the
 * `require` identifier or a complete `createRequire(…)` call — spelled literally or under the alias
 * a `node:module` `createRequire` import recorded (`import { createRequire as makeRequire } from
 * 'node:module'`, then `makeRequire(url)(expr)` or `const load = makeRequire(url); load(expr)`) —
 * with a `: NodeRequire` annotation or an `as`/`satisfies` cast on that initializer, and a `.resolve`
 * member on such a loader (`load.resolve(expr)`), which loads exactly as `require.resolve(expr)`
 * does. Nothing else in the file is a loader to that pass.
 *
 * Shapes this scan does not decide are admitted, not refused, and are named here as undecided rather
 * than implied, because the binding pass is single-file: it reads a loader's declaration in this file
 * and no other file, and it reads no initializer other than the two shapes above. Undecided are a
 * loader reached through a `node:module` namespace import
 * (`import * as ns from 'node:module'` then `ns.createRequire(expr)`, declared or chained), a loader
 * assigned after its declaration (`let load; load = require;`), a parenthesised initializer
 * (`const load = (require);`, `const load = (0, require);`), a double-parenthesised callee
 * (`((require))(spec);`), a `require`-named member whose list opens right after a block-opening
 * brace (`function load() { require(spec) { run(); } }`), which the declaration walk cannot tell from
 * an object method, an initializer that names another binding rather than a loader
 * (`const a = createRequire(import.meta.url); const b = a; b(spec);`), a bound initializer
 * (`const load = require.bind(null); load(spec);`, `const r = load.resolve; r(spec);`), a binding
 * formed by a default — a parameter default, or a destructuring default
 * (`function f(load = require) { load(spec); }`, `const { load = require } = opts; load(spec);`) —
 * an erased non-null or angle-bracket assertion on the initializer
 * (`const asserted = require!;`, `const asserted = <NodeRequire>require;`), and a loader imported
 * from another file (`import { load } from './loaders.ts'; load(spec);`).
 *
 * The type-body rule refuses a `require`/`import` member only in the position its header walk can
 * place, and the position that decides is the enclosing body's, never the member's own spelling. A
 * member of a class, interface, or type-literal body is a declaration of that body and is refused,
 * first member or not (`type X = { require(…) }` and `type X = { a: string; require(…) }` decide
 * alike); a member of a plain object literal is a call site and is admitted. The same rule then also
 * refuses grammar-legal declarations whose `require`/`import` member sits in a position the header walk
 * cannot place at all — a nested property type, a parameter, return, or class-property annotation, a
 * conditional-type branch, a mapped type, a decorator-preceded member, or a union with a negative
 * literal type — a false positive that is test-pinned rather than implied. Both readings are
 * position-dependent rather than implied by the member's own shape. All three sets stay filed as
 * #4835.
 */
export function snapshotComputedDynamicSpecifiers(source: string): string[] {
    const cached = computedDynamicSpecifiersCache.get(source);
    if (cached !== undefined) {
        return [...cached];
    }
    const shapes = new Set<string>();
    scanComputedDynamicSpecifiers(source, 0, source.length, shapes);
    const result = [...shapes];
    computedDynamicSpecifiersCache.set(source, result);
    return [...result];
}

function scanComputedDynamicSpecifiers(
    source: string,
    start: number,
    end: number,
    shapes: Set<string>,
    stopAtDepthZero = false
): number {
    let index = start;
    let depth = stopAtDepthZero ? 1 : null;
    // The open template interpolations enclosing the cursor, innermost last. Each frame holds the
    // brace depth at its `${`, because a `{` inside the hole is an object literal, not a block, and so
    // is not counted by the frame that owns the hole. The walk pushes and pops these frames instead
    // of recursing once per interpolation: a template nested a few thousand deep is a legal input,
    // and the recursive walk threw `RangeError: Maximum call stack size exceeded` on it from both scan
    // entry points.
    const holes: { braceDepth: number }[] = [];
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
            holes.push({ braceDepth: depth ?? 0 });
            index += 1;
            continue;
        }
        const openHole = holes.at(-1);
        if (openHole !== undefined) {
            const character = source[index];
            if (character === '\\') {
                index += 2;
                continue;
            }
            if (character === '$' && source[index + 1] === '{') {
                holes.push({ braceDepth: depth ?? 0 });
                index += 2;
                continue;
            }
            if (character === '}' && openHole.braceDepth === (depth ?? 0)) {
                holes.pop();
                index += 1;
                continue;
            }
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
        const computed = readComputedDynamicLoad(source, index);
        if (computed !== undefined) {
            shapes.add(computed.shape);
            index = computed.end;
            continue;
        }
        index += 1;
    }
    return index;
}

type ComputedDynamicLoad = { shape: string; end: number };

/** A resolved module-load call site: the call holding the specifier and the specifier's bounds. */
type LoadSite = {
    shape: string;
    openParen: number;
    callEnd: number;
    specifierStart: number;
    specifierEnd: number;
    keywordIndex: number;
    declarationCandidate: boolean;
};

/** A single-file binding of a name to a module loader, with its declaration position. */
type LoaderBinding = { kind: 'require' | 'createRequire'; index: number };
type LoaderBindingTable = ReadonlyMap<string, readonly LoaderBinding[]>;

const loaderBindingsCache = new Map<string, LoaderBindingTable>();

function loaderBindingsFor(source: string): LoaderBindingTable {
    let table = loaderBindingsCache.get(source);
    if (table === undefined) {
        // A loader binding can only be formed from a `require` or `createRequire` spelling; skip the
        // whole pass when neither appears, which is the common case for the ESM sources scanned here.
        table =
            source.includes('require') || source.includes('createRequire') ? collectLoaderBindings(source) : new Map();
        loaderBindingsCache.set(source, table);
    }
    return table;
}

function nearestLoaderBinding(bindings: readonly LoaderBinding[], index: number): LoaderBinding | undefined {
    let found: LoaderBinding | undefined;
    for (const binding of bindings) {
        if (binding.index >= index) {
            break;
        }
        found = binding;
    }
    return found;
}

/**
 * Skip a template literal without recursing into the import scanner: scan to the closing backtick,
 * honouring escapes, and treat each `${…}` interpolation as an opaque balanced brace region. The
 * binding pass and the line-comment walk use this so collecting bindings never re-enters the scanner
 * that consults the bindings.
 *
 * The walk carries its own frame stack rather than calling the balanced-delimiter skip for each
 * interpolation, which called this function for each template inside one: a template nested a few
 * thousand holes deep is legal input, and that mutual recursion exhausted the stack.
 */
function skipTemplateOpaque(source: string, index: number): number {
    const interpolations: { braceDepth: number }[] = [];
    let cursor = index + 1;
    while (cursor < source.length) {
        const character = source[cursor];
        const openInterpolation = interpolations.at(-1);
        if (openInterpolation !== undefined) {
            if (character === '\\') {
                cursor += 2;
                continue;
            }
            if (character === '$' && source[cursor + 1] === '{') {
                interpolations.push({ braceDepth: 0 });
                cursor += 2;
                continue;
            }
            if (character === '}') {
                openInterpolation.braceDepth -= 1;
                if (openInterpolation.braceDepth === 0) {
                    interpolations.pop();
                    cursor += 1;
                    continue;
                }
                cursor += 1;
                continue;
            }
            if (character === '{') {
                openInterpolation.braceDepth += 1;
                cursor += 1;
                continue;
            }
            if (character === '`') {
                interpolations.push({ braceDepth: 1 });
                cursor += 1;
                continue;
            }
            cursor += 1;
            continue;
        }
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (character === '`') {
            return cursor + 1;
        }
        if (character === '$' && source[cursor + 1] === '{') {
            interpolations.push({ braceDepth: 0 });
            cursor += 2;
            continue;
        }
        cursor += 1;
    }
    return source.length;
}

/**
 * A balanced `open`/`close` delimiter skip that never recurses into the import scanner: comments,
 * strings, templates (opaquely), and regex literals are skipped wholesale. The regex skip is
 * context-free for the same reason as `lineCommentOpenBefore`'s: this walk reads forward only.
 */
function skipBalancedDelimitedOpaque(
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
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = skipTemplateOpaque(source, cursor);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor, false);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
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

/** A balanced-parenthesis skip that never recurses into the import scanner. */
function skipBalancedParensOpaque(source: string, index: number): number | undefined {
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
            cursor = skipTemplateOpaque(source, cursor);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor, false);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
        if (character === '(') {
            depth += 1;
        } else if (character === ')') {
            depth -= 1;
            if (depth === 0) {
                return cursor + 1;
            }
        }
        cursor += 1;
    }
    return undefined;
}

/**
 * The bounded single-file binding pass. A `const`/`let`/`var` whose initializer is the `require`
 * identifier or a `createRequire(<expr>)` call binds a require function; a `createRequire` specifier
 * imported (optionally aliased) from `node:module` binds the createRequire function itself. Only
 * declaration initializers are read. A name recorded as a loader that is later shadowed in a scope
 * this pass cannot see still resolves to the loader, so the call is refused — the fail-closed
 * reading. A name the pass never records is not a loader, so a call through it is admitted: that is
 * fail-open, and covers an assignment after declaration (`let load; load = require;`), a
 * parenthesised initializer (`const load = (require);`), a `node:module` namespace import, and every
 * other initializer shape the pass does not read, all named in the contract as undecided (#4835).
 */
function collectLoaderBindings(source: string): LoaderBindingTable {
    const bindings = new Map<string, LoaderBinding[]>();
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
            index = skipTemplateOpaque(source, index);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (isKeywordAt(source, index, 'import')) {
            const imported = readCreateRequireImport(source, index);
            if (imported !== undefined) {
                pushBinding(bindings, imported.name, { kind: 'createRequire', index });
                index = imported.end;
                continue;
            }
        }
        if (
            isKeywordAt(source, index, 'const') ||
            isKeywordAt(source, index, 'let') ||
            isKeywordAt(source, index, 'var')
        ) {
            const declared = readLoaderDeclaration(source, index, bindings);
            if (declared !== undefined) {
                for (const binding of declared.bindings) {
                    pushBinding(bindings, binding.name, { kind: binding.kind, index });
                }
                index = declared.end;
                continue;
            }
        }
        index += 1;
    }
    return bindings;
}

function pushBinding(bindings: Map<string, LoaderBinding[]>, name: string, binding: LoaderBinding): void {
    const list = bindings.get(name);
    if (list === undefined) {
        bindings.set(name, [binding]);
    } else {
        list.push(binding);
    }
}

/** The `createRequire` (optionally aliased) specifier imported from `node:module` at `importIndex`. */
function readCreateRequireImport(source: string, importIndex: number): { name: string; end: number } | undefined {
    const cursor = skipWhitespace(source, importIndex + 6);
    if (source[cursor] !== '{') {
        return undefined;
    }
    const openBrace = cursor;
    const closeBrace = skipBalancedDelimitedOpaque(source, openBrace, source.length, '{', '}');
    if (closeBrace === undefined) {
        return undefined;
    }
    let search = skipWhitespace(source, openBrace + 1);
    let name: string | undefined;
    while (search < closeBrace - 1) {
        if (isKeywordAt(source, search, 'createRequire')) {
            let after = skipWhitespace(source, search + 'createRequire'.length);
            name = 'createRequire';
            if (isKeywordAt(source, after, 'as')) {
                after = skipWhitespace(source, after + 2);
                const start = after;
                if (!isIdentifierStart(source[after])) {
                    return undefined;
                }
                while (isIdentifierContinue(source[after])) {
                    after += 1;
                }
                name = source.slice(start, after);
            }
            break;
        }
        search += 1;
    }
    if (name === undefined) {
        return undefined;
    }
    let afterBrace = skipWhitespace(source, closeBrace);
    if (!isKeywordAt(source, afterBrace, 'from')) {
        return undefined;
    }
    afterBrace = skipWhitespace(source, afterBrace + 4);
    const quote = source[afterBrace];
    if (quote !== "'" && quote !== '"') {
        return undefined;
    }
    const module = readQuotedValue(source, afterBrace, quote);
    if (module === undefined || module.value !== 'node:module') {
        return undefined;
    }
    return { name, end: module.end };
}

/** One declarator of a `const`/`let`/`var` declaration whose initializer binds a loader. */
type LoaderDeclarator = { name: string; kind: 'require' | 'createRequire' };

/**
 * Every declarator of a `const`/`let`/`var` declaration whose initializer binds a loader, plus the
 * position just past the first declarator. Every declarator is read — `const url = import.meta.url,
 * load = createRequire(url)` binds the second — while `end` stops inside the first declarator, so a
 * nested declaration in a later declarator's initializer is still visited by the caller's walk. A
 * type annotation before the `=` is erased at run time and skipped.
 */
function readLoaderDeclaration(
    source: string,
    keywordIndex: number,
    known: LoaderBindingTable
): { bindings: readonly LoaderDeclarator[]; end: number } | undefined {
    const keywordLength = source.startsWith('const', keywordIndex) ? 5 : 3;
    let cursor = skipWhitespace(source, keywordIndex + keywordLength);
    const bindings: LoaderDeclarator[] = [];
    let end: number | undefined;
    while (cursor < source.length) {
        const nameStart = cursor;
        if (!isIdentifierStart(source[cursor])) {
            break;
        }
        while (isIdentifierContinue(source[cursor])) {
            cursor += 1;
        }
        const name = source.slice(nameStart, cursor);
        cursor = skipWhitespace(source, cursor);
        if (source[cursor] === ':') {
            // A type annotation is erased at run time; the initializer after it is the value.
            cursor = skipWhitespace(source, typeEndAt(source, cursor + 1));
        }
        if (source[cursor] === '=') {
            const initializerStart = skipWhitespace(source, cursor + 1);
            const initializer = readLoaderInitializer(source, initializerStart, known);
            if (initializer === undefined) {
                cursor = initializerStart;
            } else {
                bindings.push({ name, kind: initializer.kind });
                cursor = initializer.end;
            }
        }
        end ??= cursor;
        const separator = topLevelSeparator(source, cursor, source.length, ',;');
        if (separator === undefined || source[separator] !== ',') {
            break;
        }
        cursor = skipWhitespace(source, separator + 1);
    }
    return end === undefined ? undefined : { bindings, end };
}

/**
 * The loader a declarator initializer at `start` binds: the `require` identifier, a
 * `createRequire(<expr>)` call, or `undefined` when the initializer is anything else — including
 * `require('…')` and `createRequire(…)(…)`, which name the loaded module or a method of it rather
 * than a loader. `end` is the initializer's end, after an erased `as`/`satisfies` cast.
 */
function readLoaderInitializer(
    source: string,
    start: number,
    known: LoaderBindingTable
): { kind: 'require' | 'createRequire'; end: number } | undefined {
    const callee = loaderCalleeAt(source, start, known);
    if (callee === undefined) {
        return undefined;
    }
    let end = callee.end;
    if (callee.kind === 'createRequire') {
        const open = skipWhitespace(source, end);
        if (source[open] !== '(') {
            return undefined;
        }
        // A complete `createRequire(<expr>)` binds the require function it returns; a chained
        // `('…')` after it names the loaded module, so only a statement end binds.
        const afterCall = skipBalancedParensOpaque(source, open);
        if (afterCall === undefined) {
            return undefined;
        }
        end = afterCall;
    }
    end = skipInitializerCast(source, end);
    return isInitializerEnd(source, end) ? { kind: 'require', end } : undefined;
}

/**
 * The loader function named at `start`: the `require` identifier, or `createRequire` either spelled
 * literally or imported under the alias a `node:module` import recorded in `known`.
 */
function loaderCalleeAt(
    source: string,
    start: number,
    known: LoaderBindingTable
): { kind: 'require' | 'createRequire'; end: number } | undefined {
    if (isPrecededByDotAccess(source, start)) {
        return undefined;
    }
    if (isKeywordAt(source, start, 'require')) {
        return { kind: 'require', end: start + 'require'.length };
    }
    if (isKeywordAt(source, start, 'createRequire')) {
        return { kind: 'createRequire', end: start + 'createRequire'.length };
    }
    const word = readWordForward(source, start);
    const bindings = known.get(word);
    const binding = bindings === undefined ? undefined : nearestLoaderBinding(bindings, start);
    return binding?.kind === 'createRequire' ? { kind: 'createRequire', end: start + word.length } : undefined;
}

/**
 * The end of an erased `as`/`satisfies` cast chain following the initializer at `index`, or `index`
 * itself when no cast follows. The cast may begin on a later line — `as` continues the expression
 * across a line terminator, so no semicolon is inserted before it — and the whitespace is therefore
 * only crossed to read the cast, never to decide the initializer's end.
 */
function skipInitializerCast(source: string, index: number): number {
    let cursor = index;
    while (true) {
        const after = skipWhitespace(source, cursor);
        if (isKeywordAt(source, after, 'as')) {
            cursor = typeEndAt(source, skipWhitespace(source, after + 2));
            continue;
        }
        if (isKeywordAt(source, after, 'satisfies')) {
            cursor = typeEndAt(source, skipWhitespace(source, after + 'satisfies'.length));
            continue;
        }
        return cursor;
    }
}

/**
 * The first top-level token that cannot continue an erased type at or after `start` — `=`, `,`, `;`,
 * `)`, `]`, or `}`. The walk is opaque: a balanced group, a template, or a comment is skipped whole,
 * and a balanced `<…>` is skipped as one group, because this runs inside the binding pass, which the
 * import scanner consults, so it must never re-enter that scanner. `=>` is skipped so an arrow's `=`
 * is not read as the end of the type.
 */
function typeEndAt(source: string, start: number): number {
    let cursor = start;
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
            cursor = skipTemplateOpaque(source, cursor);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            const after = skipBalancedDelimitedOpaque(
                source,
                cursor,
                source.length,
                character,
                matchingTypeDelimiter(character)
            );
            cursor = after === undefined ? source.length : after;
            continue;
        }
        if (character === '<') {
            const after = skipBalancedDelimitedOpaque(source, cursor, source.length, '<', '>');
            if (after !== undefined) {
                cursor = after;
                continue;
            }
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            continue;
        }
        if ('=,;)]}'.includes(character ?? '')) {
            return cursor;
        }
        cursor += 1;
    }
    return cursor;
}

/**
 * Whether the loader initializer ends at `index` — the position right after the `require` identifier
 * or the `)` of a `createRequire(<expr>)` call — so the name binds a loader. The initializer ends at
 * an explicit `;`, a declarator comma, end of input, or a line terminator that ASI turns into a
 * statement end (the next significant character does not continue the expression). A line terminator
 * before `(`, `.`, `[`, or `?.` continues the expression (`require\n('yaml')`), so the name holds a
 * module or a method of it, not a loader, and no binding forms. The ASI reading fails closed: any
 * token that is not an unambiguous continuation ends the initializer, so the binding forms and a
 * later call through the name is refused.
 */
function isInitializerEnd(source: string, index: number): boolean {
    let cursor = index;
    let crossedLineTerminator = false;
    while (cursor < source.length) {
        const character = source[cursor];
        if (character !== undefined && isWhiteSpace(character)) {
            cursor += 1;
            continue;
        }
        if (character !== undefined && isLineTerminator(character)) {
            crossedLineTerminator = true;
            cursor += 1;
            continue;
        }
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            if (source.startsWith('//', cursor)) {
                crossedLineTerminator = true;
            }
            cursor = commentEnd;
            continue;
        }
        break;
    }
    const character = source[cursor];
    if (character === ';' || character === ',' || character === undefined) {
        return true;
    }
    if (!crossedLineTerminator) {
        return false;
    }
    if (character === '(' || character === '.' || character === '[') {
        return false;
    }
    if (character === '?' && source[cursor + 1] === '.') {
        return false;
    }
    return true;
}

/**
 * The `(` that opens the call whose callee expression ends at `calleeEnd`, unwrapping a
 * parenthesised or comma parenthesised callee (`(require)(…)`, `(0, require)(…)`). `wrappedCallee`
 * records that unwrapping: a wrapped callee is always a call, never a declaration's name, so its
 * parenthesised list is never read as a parameter list.
 */
type CallOpen = { openParen: number; wrappedCallee: boolean };

function callOpenParen(source: string, calleeEnd: number, calleeIndex: number): CallOpen | undefined {
    const cursor = skipWhitespace(source, calleeEnd);
    if (source[cursor] === '(') {
        return { openParen: cursor, wrappedCallee: false };
    }
    if (source.startsWith('?.', cursor)) {
        const after = skipWhitespace(source, cursor + 2);
        return source[after] === '(' ? { openParen: after, wrappedCallee: false } : undefined;
    }
    if (source[cursor] === ')') {
        const beforeCallee = previousSignificantCharacter(source, calleeIndex - 1);
        if (beforeCallee === undefined || (source[beforeCallee] !== '(' && source[beforeCallee] !== ',')) {
            return undefined;
        }
        const after = skipWhitespace(source, cursor + 1);
        if (source.startsWith('?.', after)) {
            const inner = skipWhitespace(source, after + 2);
            return source[inner] === '(' ? { openParen: inner, wrappedCallee: true } : undefined;
        }
        return source[after] === '(' ? { openParen: after, wrappedCallee: true } : undefined;
    }
    return undefined;
}

/**
 * The first top-level character in `terminators` inside `[start, end)`, or `undefined` when none.
 * Templates and balanced groups are skipped by the opaque walks, so this stays usable inside the
 * binding pass, which the import scanner consults and must never re-enter.
 */
function topLevelSeparator(source: string, start: number, end: number, terminators: string): number | undefined {
    let cursor = start;
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
            cursor = skipTemplateOpaque(source, cursor);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            const after = skipBalancedDelimitedOpaque(source, cursor, end, character, matchingTypeDelimiter(character));
            cursor = after === undefined ? end : after;
            continue;
        }
        if (terminators.includes(character ?? '')) {
            return cursor;
        }
        cursor += 1;
    }
    return undefined;
}

/** The first argument-level `,` inside `[start, end)`, or `undefined` when none exists. */
function topLevelArgumentComma(source: string, start: number, end: number): number | undefined {
    return topLevelSeparator(source, start, end, ',');
}

/**
 * Resolve the load call whose callee is `require`/`createRequire` (ending at `calleeEnd`), including
 * `.call`/`.apply` on a require callee and wrapped callees. `declarationCandidate` marks a bare
 * `require(` whose list may be a declaration's parameter list instead of a call.
 */
function resolveLoadSite(
    source: string,
    calleeIndex: number,
    calleeEnd: number,
    kind: 'require' | 'createRequire',
    declarationCandidate: boolean
): LoadSite | undefined {
    const cursor = skipWhitespace(source, calleeEnd);
    if (kind === 'require' && (source[cursor] === '.' || source.startsWith('?.', cursor))) {
        const afterDot =
            source[cursor] === '.' ? skipWhitespace(source, cursor + 1) : skipWhitespace(source, cursor + 2);
        const method = readWordForward(source, afterDot);
        if (method === 'call' || method === 'apply') {
            const call = callOpenParen(source, afterDot + method.length, afterDot);
            if (call === undefined) {
                return undefined;
            }
            const openParen = call.openParen;
            const callEnd = endOfBalancedCall(source, openParen);
            const contentEnd = callEnd - 1;
            const comma = topLevelArgumentComma(source, openParen + 1, contentEnd);
            if (comma === undefined) {
                return undefined;
            }
            return {
                shape: COMPUTED_REQUIRE_SHAPE,
                openParen,
                callEnd,
                specifierStart: skipWhitespace(source, comma + 1),
                specifierEnd: contentEnd,
                keywordIndex: calleeIndex,
                declarationCandidate: false,
            };
        }
        if (method === 'bind') {
            // `bind` returns a bound require function, so the load is the second call — the first
            // call's arguments are a bound `this` and partial arguments, never the specifier.
            const call = callOpenParen(source, afterDot + method.length, afterDot);
            if (call === undefined) {
                return undefined;
            }
            const afterFirstCall = skipBalancedParens(source, call.openParen);
            if (afterFirstCall === undefined) {
                return undefined;
            }
            let second = skipWhitespace(source, afterFirstCall);
            if (source.startsWith('?.', second) && source[skipWhitespace(source, second + 2)] === '(') {
                second = skipWhitespace(source, second + 2);
            }
            if (source[second] !== '(') {
                return undefined;
            }
            const callEnd = endOfBalancedCall(source, second);
            return {
                shape: COMPUTED_REQUIRE_SHAPE,
                openParen: second,
                callEnd,
                specifierStart: skipWhitespace(source, second + 1),
                specifierEnd: callEnd - 1,
                keywordIndex: calleeIndex,
                declarationCandidate: false,
            };
        }
        // Not `.call`/`.apply`/`.bind`: fall through to the call-open walk below. A `.resolve` member
        // never reaches here, because the caller already moved the callee end past it.
    }
    const call = callOpenParen(source, calleeEnd, calleeIndex);
    if (call === undefined) {
        return undefined;
    }
    // A wrapped callee (`(require)(…)`, `(0, require)(…)`) is always a call: the parentheses are the
    // callee's, so the list that follows them is an argument list, never a declaration's parameters.
    const mayDeclare = declarationCandidate && !call.wrappedCallee;
    const openParen = call.openParen;
    if (kind === 'createRequire') {
        const afterFirstCall = skipBalancedParens(source, openParen);
        if (afterFirstCall === undefined) {
            return undefined;
        }
        let second = skipWhitespace(source, afterFirstCall);
        if (source.startsWith('?.', second) && source[skipWhitespace(source, second + 2)] === '(') {
            second = skipWhitespace(source, second + 2);
        }
        if (source[second] !== '(') {
            return undefined;
        }
        const callEnd = endOfBalancedCall(source, second);
        return {
            shape: COMPUTED_CREATE_REQUIRE_SHAPE,
            openParen: second,
            callEnd,
            specifierStart: skipWhitespace(source, second + 1),
            specifierEnd: callEnd - 1,
            keywordIndex: calleeIndex,
            declarationCandidate: false,
        };
    }
    const callEnd = endOfBalancedCall(source, openParen);
    return {
        shape: COMPUTED_REQUIRE_SHAPE,
        openParen,
        callEnd,
        specifierStart: skipWhitespace(source, openParen + 1),
        specifierEnd: callEnd - 1,
        keywordIndex: calleeIndex,
        declarationCandidate: mayDeclare,
    };
}

/**
 * The callee end for the loader name ending at `nameEnd`, and whether that name may still be a
 * declaration. A `.resolve`/`?.resolve` member moves the end over it, because `require.resolve(spec)`
 * and a bound loader's `load.resolve(spec)` are the same load; a member call is never a declaration.
 */
function loaderCalleeEnd(source: string, nameEnd: number): { calleeEnd: number; declarationCandidate: boolean } {
    const cursor = skipWhitespace(source, nameEnd);
    let memberStart: number | undefined;
    if (source[cursor] === '.') {
        memberStart = cursor + 1;
    } else if (source.startsWith('?.', cursor)) {
        memberStart = cursor + 2;
    }
    if (memberStart !== undefined) {
        const afterDot = skipWhitespace(source, memberStart);
        if (isKeywordAt(source, afterDot, 'resolve')) {
            return { calleeEnd: afterDot + 'resolve'.length, declarationCandidate: false };
        }
    }
    return { calleeEnd: nameEnd, declarationCandidate: true };
}

/**
 * The load site at `index` for `require`, `createRequire`, or a loader binding. `import` is handled
 * separately because its dynamic form cannot be wrapped or bound. A binding call resolves to the
 * nearest preceding loader binding; shadowing this pass cannot see leaves that resolution in place.
 */
function loadSiteAt(source: string, index: number): LoadSite | undefined {
    if (isKeywordAt(source, index, 'require')) {
        if (isPrecededByDotAccess(source, index)) {
            return undefined;
        }
        const callee = loaderCalleeEnd(source, index + 'require'.length);
        return resolveLoadSite(source, index, callee.calleeEnd, 'require', callee.declarationCandidate);
    }
    if (isKeywordAt(source, index, 'createRequire')) {
        if (isPrecededByDotAccess(source, index)) {
            return undefined;
        }
        return resolveLoadSite(source, index, index + 'createRequire'.length, 'createRequire', false);
    }
    if (isIdentifierStart(source[index]) && !isIdentifierContinue(source[index - 1])) {
        const word = readWordForward(source, index);
        const bindings = loaderBindingsFor(source).get(word);
        if (bindings !== undefined) {
            const binding = nearestLoaderBinding(bindings, index);
            if (binding !== undefined && !isPrecededByDotAccess(source, index)) {
                // A `require`-kind binding behaves like `require` itself, so a member or function
                // named after it is still a declaration candidate and a `.resolve` member is still a
                // load; a `createRequire` binding cannot be either, because its second call is
                // always a load.
                const callee =
                    binding.kind === 'require'
                        ? loaderCalleeEnd(source, index + word.length)
                        : { calleeEnd: index + word.length, declarationCandidate: false };
                return resolveLoadSite(source, index, callee.calleeEnd, binding.kind, callee.declarationCandidate);
            }
        }
    }
    return undefined;
}

/** The computed-load verdict for a resolved site, or `undefined` when the specifier is static. */
function computedDynamicLoadFromSite(source: string, site: LoadSite): ComputedDynamicLoad | undefined {
    if (
        site.declarationCandidate &&
        isParameterListRegion(source, site.keywordIndex, site.specifierStart, site.specifierEnd, site.callEnd)
    ) {
        return undefined;
    }
    if (staticSpecifierEnd(source, site.specifierStart, site.specifierEnd) !== undefined) {
        return undefined;
    }
    return { shape: site.shape, end: site.callEnd };
}

/** The literal value of a static specifier site, or `undefined` when it is not a static literal. */
function staticSpecifierForSite(source: string, site: LoadSite): ReadSpecifier | undefined {
    if (staticSpecifierEnd(source, site.specifierStart, site.specifierEnd) === undefined) {
        return undefined;
    }
    return readStaticSpecifierValue(source, site.specifierStart, site.specifierEnd);
}

/** The string or static-template value of a literal specifier, through grouping and angle brackets. */
function readStaticSpecifierValue(source: string, start: number, end: number): ReadSpecifier | undefined {
    let cursor = skipWhitespace(source, start);
    if (cursor >= end) {
        return undefined;
    }
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
    while (source[cursor] === '(') {
        const close = skipBalancedParens(source, cursor);
        if (close === undefined || close - 1 > end) {
            return undefined;
        }
        const inner = readStaticSpecifierValue(source, cursor + 1, close - 1);
        if (inner === undefined) {
            return undefined;
        }
        return { value: inner.value, end: close };
    }
    const first = source[cursor];
    if (first === "'" || first === '"') {
        return readQuotedValue(source, cursor, first);
    }
    if (first === '`') {
        return readStaticTemplateValue(source, cursor);
    }
    return undefined;
}

function readComputedDynamicLoad(source: string, index: number): ComputedDynamicLoad | undefined {
    if (isKeywordAt(source, index, 'import') && !isPrecededByDotAccess(source, index)) {
        const afterKeyword = skipWhitespace(source, index + 6);
        if (source[afterKeyword] === '(') {
            return computedDynamicLoad(source, afterKeyword, COMPUTED_DYNAMIC_IMPORT_SHAPE, index, true);
        }
        return undefined;
    }
    const site = loadSiteAt(source, index);
    return site === undefined ? undefined : computedDynamicLoadFromSite(source, site);
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
    // declaration whatever precedes it, while the same name in a statement block stays a call — the
    // header walk in `classLikeBodyOpenBefore` tells the two bodies apart.
    let cursor = keywordIndex - 1;
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
            return true;
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
 * The index of the `{` that opens the innermost brace-delimited region containing `keywordIndex`,
 * skipping braces that belong to string, template, comment, or regex-literal content on the way, or
 * `undefined` when no such brace precedes the name. A brace inside a regex body (`/}/`) is an
 * expression token this walk must not read as a delimiter.
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
        if (character === '/') {
            const open = regexLiteralOpenBackward(source, cursor);
            if (open !== undefined) {
                cursor = open - 1;
                continue;
            }
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
 * The index of the previous significant character before `cursor` — skipping whitespace, line and
 * block comments, string and template literals, and regex literals — or `-1` when none exists. The
 * backward walks share this so a quote, brace, or slash inside a literal never reads as a token.
 */
function skipBackwardTrivia(source: string, cursor: number): number {
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return -1;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return -1;
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
        if (character === '/') {
            const open = regexLiteralOpenBackward(source, cursor);
            if (open !== undefined) {
                cursor = open - 1;
                continue;
            }
        }
        return cursor;
    }
    return -1;
}

/**
 * The index just before the opening delimiter of the balanced `open`/`close` group whose closing
 * delimiter is at `closeIndex`, or `undefined` when none closes before the start of input. Skips
 * strings, templates, comments, and regex literals inside the group.
 */
function skipBackwardBalancedDelimited(
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
            const blockOpen = source.lastIndexOf('/*', cursor - 1);
            if (blockOpen === -1) {
                return undefined;
            }
            cursor = blockOpen - 1;
            continue;
        }
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
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
            if (regexOpen !== undefined) {
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
                return cursor - 1;
            }
            cursor -= 1;
            continue;
        }
        cursor -= 1;
    }
    return undefined;
}

/**
 * Whether the `{` at `openIndex` opens a class, interface, or type-literal body. The enclosing
 * construct is read from the header tokens with balanced `<>`, `()`, and `[]` and a proper
 * terminator, so a generic header (`class ModuleLoader<T>`, `interface Loader<T> extends Base<T>`),
 * a type alias whose object-literal type is this `{` (`type Loader = {`), and a type-annotated
 * object literal (`const l: {`) are bodies, while a block after a completed `type` alias
 * (`type Specifier = string\n{ … }`) or after any other complete statement is not.
 */
function classLikeBodyOpenBefore(source: string, openIndex: number): boolean {
    const before = skipBackwardTrivia(source, openIndex - 1);
    if (before < 0) {
        return false;
    }
    const character = source[before];
    if (character === '=') {
        return typeAliasBodyOpenBefore(source, openIndex);
    }
    if (character === ':') {
        return annotationBodyOpenBefore(source, openIndex);
    }
    // A type operator or delimiter directly before the `{` leaves the type expression incomplete, so
    // the `{` completes an object type; walk back over the expression to its header. A union or
    // intersection member, a grouping or tuple opener, and a separator or balanced close all qualify.
    if (
        character === '|' ||
        character === '&' ||
        character === '(' ||
        character === '[' ||
        character === '<' ||
        character === ',' ||
        character === ')' ||
        character === ']'
    ) {
        return typeExpressionBodyOpenBefore(source, openIndex);
    }
    if (character === '>') {
        // `=>` continues a type (a function return type); a generic-close `>` ends a class/interface
        // header, so the two are read differently.
        return source[before - 1] === '='
            ? arrowReturnBodyOpenBefore(source, openIndex)
            : classInterfaceBodyOpenBefore(source, openIndex);
    }
    if (isIdentifierStart(character)) {
        const word = readWordBackward(source, before);
        if (TYPE_OPERATOR_KEYWORDS.has(word)) {
            return typeExpressionBodyOpenBefore(source, openIndex);
        }
        return classInterfaceBodyOpenBefore(source, openIndex);
    }
    return false;
}

/** Whether a `type Name [<…>] =` header immediately precedes the `{` at `openIndex`. */
function typeAliasBodyOpenBefore(source: string, openIndex: number): boolean {
    let cursor = skipBackwardTrivia(source, openIndex - 1);
    if (cursor < 0 || source[cursor] !== '=') {
        return false;
    }
    cursor = skipBackwardTrivia(source, cursor - 1);
    if (cursor < 0) {
        return false;
    }
    if (source[cursor] === '>') {
        const afterOpen = skipBackwardBalancedDelimited(source, cursor, '<', '>');
        if (afterOpen === undefined) {
            return false;
        }
        cursor = skipBackwardTrivia(source, afterOpen);
        if (cursor < 0) {
            return false;
        }
    }
    if (!isIdentifierContinue(source[cursor])) {
        return false;
    }
    const name = readWordBackward(source, cursor);
    const beforeName = skipBackwardTrivia(source, cursor - name.length);
    if (beforeName < 0) {
        return false;
    }
    return readWordBackward(source, beforeName) === 'type';
}

/** Whether a `const`/`let`/`var Name :` annotation immediately precedes the `{` at `openIndex`. */
function annotationBodyOpenBefore(source: string, openIndex: number): boolean {
    let cursor = skipBackwardTrivia(source, openIndex - 1);
    if (cursor < 0 || source[cursor] !== ':') {
        return false;
    }
    cursor = skipBackwardTrivia(source, cursor - 1);
    if (cursor < 0 || !isIdentifierContinue(source[cursor])) {
        return false;
    }
    const name = readWordBackward(source, cursor);
    const beforeName = skipBackwardTrivia(source, cursor - name.length);
    if (beforeName < 0) {
        return false;
    }
    const keyword = readWordBackward(source, beforeName);
    return keyword === 'const' || keyword === 'let' || keyword === 'var';
}

/** Type-operator keywords a type expression may contain between its `{` and its header. */
const TYPE_OPERATOR_KEYWORDS: ReadonlySet<string> = new Set([
    'keyof',
    'typeof',
    'readonly',
    'extends',
    'implements',
    'unique',
    'infer',
    'as',
    'satisfies',
    'is',
]);

/** Declaration keywords whose header ends in a type expression the `{` completes. */
const TYPE_HEADER_KEYWORDS: ReadonlySet<string> = new Set([
    'type',
    'interface',
    'class',
    'const',
    'let',
    'var',
    'function',
]);

/**
 * Whether the `{` at `openIndex` completes a type expression belonging to a `type`/`interface`/
 * `class` header or a `:`/`=` annotation. The walk reads backward over type-position tokens —
 * operators (`|`, `&`, `,`, `.`, `?`, `:`), balanced `<…>`, `(…)`, `[…]`, and `{…}` groups, type
 * keywords, and type atoms — and succeeds when it reaches a header keyword. A statement boundary — a
 * block keyword, a `;`, or an unmatched delimiter — ends the walk with false, so a block after a
 * completed statement is never claimed by an earlier `type` keyword.
 */
function typeExpressionBodyOpenBefore(source: string, openIndex: number): boolean {
    let cursor = openIndex - 1;
    while (true) {
        cursor = skipBackwardTrivia(source, cursor);
        if (cursor < 0) {
            return false;
        }
        const character = source[cursor];
        if (character === '>' || character === ')' || character === ']' || character === '}') {
            if (character === '>' && cursor >= 1 && source[cursor - 1] === '=') {
                cursor -= 2;
                continue;
            }
            const open = matchingOpenDelimiter(character);
            const afterOpen = skipBackwardBalancedDelimited(source, cursor, open, character);
            if (afterOpen === undefined) {
                return false;
            }
            // A `)` whose `(` is not part of this type expression is not a type-position operator: it
            // closes a call, a parameter list, or a statement's group, so this `{` does not complete a
            // type body and the walk stops rather than reading back into an earlier declaration. A `(`
            // that follows an identifier, a member access, or a closing delimiter is one of those;
            // without this, the body of `function f() { … }` read as a type context and refused the
            // loads after it.
            if (character === ')' && isCallParenthesisBefore(source, afterOpen)) {
                return false;
            }
            cursor = afterOpen;
            continue;
        }
        if (
            character === '|' ||
            character === '&' ||
            character === '=' ||
            character === ',' ||
            character === '.' ||
            character === '(' ||
            character === '[' ||
            character === '<' ||
            character === '?' ||
            character === ':'
        ) {
            cursor -= 1;
            continue;
        }
        if (isIdentifierContinue(character)) {
            const word = readWordBackward(source, cursor);
            if (TYPE_HEADER_KEYWORDS.has(word)) {
                return true;
            }
            if (TYPE_OPERATOR_KEYWORDS.has(word)) {
                cursor -= word.length;
                continue;
            }
            if (BLOCK_INTRODUCER_KEYWORDS.has(word)) {
                return false;
            }
            cursor -= word.length;
            continue;
        }
        return false;
    }
}

/**
 * Whether the parenthesis whose `(` is one past `afterOpen` opens a call, a parameter list, or a
 * statement's group rather than a grouped type. A `(` that follows an identifier, a member access, or
 * a closing delimiter is one of those, so the parenthesis is an expression, not a type-position group.
 */
function isCallParenthesisBefore(source: string, afterOpen: number): boolean {
    const before = skipBackwardTrivia(source, afterOpen);
    if (before < 0) {
        return false;
    }
    const character = source.charAt(before);
    return isIdentifierContinue(character) || character === ')' || character === ']' || character === '}';
}

/**
 * Whether a `class` or `interface` header — a name, optional generics, and optional
 * `extends`/`implements` clauses with balanced `<>`, `()`, and `[]` — immediately precedes the `{`
 * at `openIndex`. A `>` in the walk that belongs to an arrow (`=>`) is not read as a generic close.
 */
function classInterfaceBodyOpenBefore(source: string, openIndex: number): boolean {
    let cursor = openIndex - 1;
    while (true) {
        cursor = skipBackwardTrivia(source, cursor);
        if (cursor < 0) {
            return false;
        }
        const character = source[cursor];
        if (character === '>') {
            if (cursor >= 1 && source[cursor - 1] === '=') {
                cursor -= 2;
                continue;
            }
            const afterOpen = skipBackwardBalancedDelimited(source, cursor, '<', '>');
            if (afterOpen === undefined) {
                return false;
            }
            cursor = afterOpen;
            continue;
        }
        if (character === ')' || character === ']') {
            const afterOpen = skipBackwardBalancedDelimited(source, cursor, character === ')' ? '(' : '[', character);
            if (afterOpen === undefined) {
                return false;
            }
            cursor = afterOpen;
            continue;
        }
        if (isIdentifierContinue(character)) {
            const word = readWordBackward(source, cursor);
            if (word === 'class' || word === 'interface') {
                return true;
            }
            if (BLOCK_INTRODUCER_KEYWORDS.has(word)) {
                return false;
            }
            cursor -= word.length;
            continue;
        }
        if (character === '.' || character === ',') {
            cursor -= 1;
            continue;
        }
        return false;
    }
}

/**
 * Whether the `{` at `openIndex` completes an arrow *type* — a function type whose return type is the
 * object type `{` opens — rather than an arrow *function body*. `type X = () => {` and
 * `const f: () => {` are types, so a `require`/`import` member inside is a declaration; `const f =
 * () => {` is a value, so the body is a function body and a `require`/`import` name inside is a call.
 */
function arrowReturnBodyOpenBefore(source: string, openIndex: number): boolean {
    let cursor = skipBackwardTrivia(source, openIndex - 1);
    if (cursor < 1 || source[cursor] !== '>' || source[cursor - 1] !== '=') {
        return false;
    }
    cursor = skipBackwardTrivia(source, cursor - 2);
    if (cursor < 0 || source[cursor] !== ')') {
        return false;
    }
    const afterParams = skipBackwardBalancedDelimited(source, cursor, '(', ')');
    if (afterParams === undefined) {
        return false;
    }
    cursor = skipBackwardTrivia(source, afterParams);
    if (cursor < 0) {
        return false;
    }
    const character = source[cursor];
    if (character === ':') {
        // A return-type or property annotation (`f(): () => {`, `const f: () => {`) is a type.
        return true;
    }
    if (character === '=') {
        // `type X = () => {` is a type alias; `const f = () => {` is a value arrow.
        const beforeEqual = skipBackwardTrivia(source, cursor - 1);
        if (beforeEqual < 0 || !isIdentifierContinue(source[beforeEqual])) {
            return false;
        }
        const name = readWordBackward(source, beforeEqual);
        const beforeName = skipBackwardTrivia(source, beforeEqual - name.length);
        if (beforeName < 0) {
            return false;
        }
        return readWordBackward(source, beforeName) === 'type';
    }
    return false;
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
 * block comment from masking a real token. The tokens it passes are read forward-only, but a `/` is
 * read as a regex only at a genuine regex position, decided from the token before it. Reading every
 * `/` by its shape alone made `a/b//of` a regex opening at the division, which swallowed the real
 * `//` and let the token before the comment — not the token before the `/` — decide the next line.
 * Asking for that token stays inside the backward walk, so it does not re-enter this scan.
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
            index = skipTemplateOpaque(source, index);
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
            cursor = scanImportTemplate(source, cursor, end, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
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
            cursor = scanImportTemplate(source, cursor, end, new Set());
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
            cursor = scanImportTemplate(source, cursor, end, new Set());
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

/** The opening delimiter matching the given closing delimiter. */
function matchingOpenDelimiter(close: ')' | ']' | '}' | '>'): '(' | '[' | '{' | '<' {
    if (close === ')') {
        return '(';
    }
    if (close === ']') {
        return '[';
    }
    if (close === '}') {
        return '{';
    }
    return '<';
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
    stopAtDepthZero = false
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
            index = scanImportTemplate(source, index, end, specifiers);
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
        const site = loadSiteAt(source, index);
        if (site !== undefined) {
            const spec = staticSpecifierForSite(source, site);
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

/**
 * Scan one template literal for import specifiers. Inside a `${…}` hole the hole is code, so the same
 * `from`, `import(...)`, `require(...)`, and `createRequire(...)(...)` shapes are read there; the
 * literal parts between holes contribute nothing. The walk carries an explicit frame stack instead of
 * recursing once per interpolation — a template nested a few thousand holes deep is legal input, and
 * the recursive form threw `RangeError: Maximum call stack size exceeded` out of this scan. Each frame
 * records the brace depth inside its hole, because an object literal there is not a block and must not
 * close it.
 */
function scanImportTemplate(source: string, index: number, end: number, specifiers: Set<string>): number {
    // The open templates and interpolations enclosing the cursor, innermost last. A frame in template
    // mode is literal text, so only a backtick or a `${` moves the walk on; a frame in hole mode is
    // code. The stack replaces recursing once per interpolation.
    const frames: { inTemplate: boolean; braceDepth: number }[] = [{ inTemplate: true, braceDepth: 0 }];
    let cursor = index + 1;
    while (cursor < end) {
        const character = source[cursor];
        const top = frames.at(-1);
        if (top === undefined) {
            return cursor;
        }
        if (top.inTemplate) {
            if (character === '\\') {
                cursor += 2;
                continue;
            }
            if (character === '`') {
                frames.pop();
                cursor += 1;
                continue;
            }
            if (character === '$' && source[cursor + 1] === '{') {
                frames.push({ inTemplate: false, braceDepth: 0 });
                cursor += 2;
                continue;
            }
            cursor += 1;
            continue;
        }
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            frames.push({ inTemplate: true, braceDepth: 0 });
            cursor += 1;
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
        if (character === '{') {
            top.braceDepth += 1;
            cursor += 1;
            continue;
        }
        if (character === '}') {
            if (top.braceDepth === 0) {
                frames.pop();
            } else {
                top.braceDepth -= 1;
            }
            cursor += 1;
            continue;
        }
        if (isKeywordAt(source, cursor, 'from')) {
            const specifier = readModuleStringAfter(source, cursor + 4);
            if (specifier !== undefined) {
                specifiers.add(specifier.value);
                cursor = specifier.end;
                continue;
            }
        }
        if (isKeywordAt(source, cursor, 'import') && !isPrecededByDotAccess(source, cursor)) {
            const staticSpecifier = readModuleStringAfter(source, cursor + 6);
            if (staticSpecifier !== undefined) {
                specifiers.add(staticSpecifier.value);
                cursor = staticSpecifier.end;
                continue;
            }
            const dynamic = readDynamicImportSpecifier(source, cursor + 6);
            if (dynamic !== undefined) {
                specifiers.add(dynamic.value);
                cursor = dynamic.end;
                continue;
            }
        }
        const site = loadSiteAt(source, cursor);
        if (site !== undefined) {
            const spec = staticSpecifierForSite(source, site);
            if (spec !== undefined) {
                specifiers.add(spec.value);
                cursor = spec.end;
                continue;
            }
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

function isIdentifierContinue(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function isIdentifierStart(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z_$]/.test(character);
}

/** The identifier word starting at `start`, read forward to its last character. */
function readWordForward(source: string, start: number): string {
    let cursor = start;
    while (cursor < source.length && isIdentifierContinue(source[cursor])) {
        cursor += 1;
    }
    return source.slice(start, cursor);
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
 * Keywords after which a `/` opens a regular-expression literal because the keyword expects an
 * expression. `else` and `do` belong here: each is followed by a statement, so `if (x) run(); else
 * /re/.test(y)` is a regex. `extends` is deliberately absent — it expects a type or class
 * expression, never a regex — so a division after a heritage clause is not read as a regex.
 */
const REGEX_PREFIX_KEYWORDS = new Set([
    'return',
    'throw',
    'case',
    'delete',
    'default',
    'typeof',
    'void',
    'await',
    'yield',
    'in',
    'of',
    'instanceof',
    'new',
    'do',
    'else',
]);

/**
 * The reserved words of JavaScript and TypeScript. A word that spells one of these continues an
 * identifier but ends no expression, so a `!` after it is a prefix negation rather than a postfix
 * assertion. Contextual keywords that are also ordinary names (`require`, `undefined`) stay out: each
 * is a legal asserted operand in TypeScript, so reading one as a keyword would turn a real division
 * into a regex.
 */
const JS_KEYWORDS: ReadonlySet<string> = new Set([
    'abstract',
    'any',
    'as',
    'asserts',
    'async',
    'await',
    'bigint',
    'boolean',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'if',
    'implements',
    'import',
    'in',
    'infer',
    'instanceof',
    'interface',
    'is',
    'keyof',
    'let',
    'module',
    'namespace',
    'never',
    'new',
    'null',
    'number',
    'object',
    'of',
    'out',
    'override',
    'package',
    'private',
    'protected',
    'public',
    'readonly',
    'return',
    'satisfies',
    'static',
    'string',
    'super',
    'switch',
    'symbol',
    'this',
    'throw',
    'true',
    'try',
    'type',
    'typeof',
    'unique',
    'unknown',
    'var',
    'void',
    'while',
    'with',
    'yield',
]);

/**
 * Keywords whose parenthesised header is followed by a statement rather than an expression, so a
 * `/` after the closing parenthesis opens a regex (`if (x) /re/`). The parenthesis must be the
 * header's own — `if (x) foo() /re/` still divides, because the `)` before the `/` closes `foo()`.
 */
const CONTROL_HEADER_KEYWORDS = new Set(['if', 'for', 'while', 'with', 'switch', 'catch']);

/** The index of the first line terminator at or after `from`, or the source's length. */
function lineEndAfter(source: string, from: number): number {
    let cursor = from;
    while (cursor < source.length && !isLineTerminator(source[cursor] ?? '')) {
        cursor += 1;
    }
    return cursor;
}

function skipRegexLiteral(source: string, index: number, consultBackwardContext = true): number | undefined {
    if (source[index] !== '/') {
        return undefined;
    }
    if (consultBackwardContext && !canStartRegexLiteral(source, index)) {
        return undefined;
    }
    // A regex literal cannot span a line. A `/` in regex position with no closing `/` on its own line
    // is not one: reading `a/b//of` then a newline then `/require(spec)/g;` that way consumed the
    // parser's real `require` call as the regex body. An unreadable `/` is left to the walk as
    // division, the reading that admits rather than hides.
    if (!source.slice(index + 1, lineEndAfter(source, index)).includes('/')) {
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
 * The index of the previous non-whitespace, non-comment character before `cursor`, or `undefined`
 * when none exists. Block and line comments are transparent — a slash after either reads the token
 * before the comment — but string, template, and regex literals are not skipped here: the caller
 * classifies them, because a `/` after any of those is division.
 *
 * This walk and the forward walks that must stay opaque — `lineCommentOpenBefore` here and the
 * `…Opaque` skippers below — read a regex literal with `consultBackwardContext` false. Asking
 * whether a `/` opens a regex asks this function for the token before it, which asks
 * `lineCommentOpenBefore`, which walks the line forward; a template interpolation holding a `/`
 * (`const t = `${a / b}`;`) therefore reached this function again from inside its own walk and
 * recursed without bound. Reading a regex by its shape alone removes that edge, so no input can
 * exhaust the stack, and an unreadable `/` is left to the walk — division, the reading that
 * admits rather than hides.
 */
function previousSignificantCharacter(source: string, cursor: number): number | undefined {
    return scanBackwardForToken(source, cursor, true);
}

/**
 * The same walk with the line-comment scan left out. The line-comment scan asks whether a `/` opens
 * a regex, which asks the backward walk for the token before that `/`, so a walk that consults it can
 * re-enter the same scan. Callers that only read a token backward use this walk and stay total.
 */
function previousSignificantCharacterBackward(source: string, cursor: number): number | undefined {
    return scanBackwardForToken(source, cursor, false);
}

function scanBackwardForToken(source: string, cursor: number, skipLineComments: boolean): number | undefined {
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
        if (skipLineComments) {
            // A `//` comment's last word is not a token: `const t = 1 // of\n/re/` must read the `1`,
            // not the comment's `of`. Skip back to before the `//` so the token before the name is
            // read.
            const lineComment = lineCommentOpenBefore(source, cursor);
            if (lineComment !== undefined) {
                cursor = lineComment - 1;
                continue;
            }
        }
        return cursor;
    }
    return undefined;
}

/**
 * Whether the identifier word starting at `start` is a `#` private member name rather than the
 * keyword it spells: `this.#case` is a member access, so a `/` after it is division, and `this.#if(x)`
 * is a call, so the `)` closes no control header.
 */
function isPrivateNameStart(source: string, start: number): boolean {
    return source[start - 1] === '#';
}

/**
 * The opening `/` of the regex literal whose closing `/` is at `closeSlash`, or `undefined` when
 * `closeSlash` is not a regex close. Walks the regex body backward — escaping, character classes,
 * and newline termination — then confirms the opening `/` is in regex position, so a division
 * slash is never mistaken for a close.
 */
function regexLiteralOpenBackward(source: string, closeSlash: number): number | undefined {
    let cursor = closeSlash - 1;
    let inClass = false;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (cursor >= 1 && source[cursor - 1] === '\\') {
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
            return canStartRegexLiteral(source, cursor) ? cursor : undefined;
        }
        if (isLineTerminator(character)) {
            return undefined;
        }
        cursor -= 1;
    }
    return undefined;
}

/**
 * The opening `(` that matches the closing `)` at `closeParen`, or `undefined` when none does.
 * Skips strings, templates, comments, and regex literals inside the parentheses so a quote, brace,
 * or slash within them cannot end the walk early.
 */
function matchingOpenParenBackward(source: string, closeParen: number): number | undefined {
    let cursor = closeParen - 1;
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
        if (character === '/') {
            const open = regexLiteralOpenBackward(source, cursor);
            if (open !== undefined) {
                cursor = open - 1;
                continue;
            }
        }
        if (character === ')') {
            depth += 1;
            cursor -= 1;
            continue;
        }
        if (character === '(') {
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
 * Whether the token before the `!` at `bang` ends an expression, which makes that `!` postfix and a
 * `/` after it a division. The character before the assertion decides — an identifier, a digit, a
 * literal quote, `)`, `]`, `}`, or a `++`/`--` — never the `/`'s own position, so `a! / require(x)`
 * keeps its load. A prefix `!` (`!!x`, `!x`) ends no expression, so the `/` after it is still a
 * regex.
 *
 * An identifier character alone is not enough: every keyword continues an identifier, so the word
 * decides. A keyword before the `!` ends no expression, which makes the `!` a prefix and the `/`
 * after it a regex — `return !/require(spec)/.test(x)` hid its load while `return` alone read as an
 * expression end. A property or private name spelling a keyword (`cfg.return`, `this.#return`) is a
 * member, not the keyword, and still ends an expression.
 *
 * The walk reads backward only, so this stays total for input the forward reader is already inside.
 */
function tokenBeforeEndsExpression(source: string, bang: number): boolean {
    const before = previousSignificantCharacterBackward(source, bang - 1);
    if (before === undefined) {
        return false;
    }
    const character = source.charAt(before);
    if (character === "'" || character === '"' || character === '`') {
        return true;
    }
    if (character === ')' || character === ']' || character === '}') {
        return true;
    }
    if (character === '+' || character === '-') {
        return source.charAt(before - 1) === character;
    }
    if (character === '!') {
        return tokenBeforeEndsExpression(source, before);
    }
    if (isDecimalDigit(character)) {
        return true;
    }
    if (!isIdentifierContinue(character)) {
        return false;
    }
    const word = readWordBackward(source, before);
    const wordStart = before - word.length + 1;
    if (isPrecededByDotAccess(source, wordStart) || isPrivateNameStart(source, wordStart)) {
        return true;
    }
    return !JS_KEYWORDS.has(word);
}

/**
 * Whether a `/` may open a regex after the `)` at `closeParen`: only when that parenthesis closes a
 * control-flow header (`if`, `for`, `while`, `with`, `switch`, `catch`) whose body is a statement,
 * including a `for await (…)` header spelled with two words. A `)` closing a call or grouping is an
 * expression end, so a following `/` is division, and a member named after a control keyword
 * (`obj.catch`, `obj.if`) is not a header.
 */
function closingParenAllowsRegex(source: string, closeParen: number): boolean {
    const open = matchingOpenParenBackward(source, closeParen);
    if (open === undefined) {
        return false;
    }
    const beforeOpen = previousSignificantCharacter(source, open - 1);
    if (beforeOpen === undefined || !isIdentifierContinue(source[beforeOpen])) {
        return false;
    }
    const word = readWordBackward(source, beforeOpen);
    const wordStart = beforeOpen - word.length + 1;
    if (isPrecededByDotAccess(source, wordStart) || isPrivateNameStart(source, wordStart)) {
        return false;
    }
    if (CONTROL_HEADER_KEYWORDS.has(word)) {
        return true;
    }
    // `for await (…)` spells its header keyword two words before the parenthesis; a plain
    // `await (…)` is not a header.
    if (word === 'await') {
        const beforeAwait = previousSignificantCharacter(source, beforeOpen - word.length);
        if (beforeAwait !== undefined && isIdentifierContinue(source[beforeAwait])) {
            const beforeWord = readWordBackward(source, beforeAwait);
            return !isPrecededByDotAccess(source, beforeAwait - beforeWord.length + 1) && beforeWord === 'for';
        }
    }
    return false;
}

/**
 * Whether a `}` at `closeBrace` closes a declaration body — a class, interface, enum, namespace, or
 * function declaration, or a statement block — which ends a statement so a following `/` opens a
 * regex. A `}` that closes an expression-position body (an object literal in operand position, a
 * class or function expression, or an arrow function body) ends an expression, so a following `/` is
 * division.
 *
 * The statement-end reading is the fallback, not a recognition: a close is division only when the
 * construct that owns it is provably an expression, so a `}` in a shape this walk does not model
 * keeps the statement-end reading rather than turning a statement-position regex into code. Reading
 * an unrecognised close as an expression end refused `export {}`, `const enum E {}`,
 * `declare global {}`, and a `switch` case block, whose following regex the merge base admitted.
 */
function closeBraceStartsStatement(source: string, closeBrace: number): boolean {
    const beforeOpen = skipBackwardBalancedDelimited(source, closeBrace, '{', '}');
    if (beforeOpen === undefined) {
        return true;
    }
    // The walk answers with the index before the opening brace; `expressionBodyOpenBefore` reads the
    // brace at its own position, so `foo({} / require(spec) / 2)` is a body in operand position and
    // the close before the division is an expression end.
    return !expressionBodyOpenBefore(source, beforeOpen + 1);
}

/**
 * Characters after which a `{` opens an object literal in operand position, not a statement block.
 * Identifier characters are deliberately absent: a word ends a declaration header (`class C_`), and
 * reading its last character as an operand position turned the following regex into code and hid the
 * load behind it.
 */
const OPERAND_POSITION_CHARACTERS = '=(?&|+-*/%^[';

/**
 * Whether the `{` at `openIndex` opens an expression-position body, whose close ends an expression:
 * an arrow body, a class or function expression body, or an object literal in operand position. Only
 * a shape proved here is division; every other close keeps the statement-end reading, so the default
 * is the merge base's rather than a recognition that can regress.
 */
function expressionBodyOpenBefore(source: string, openIndex: number): boolean {
    const before = skipBackwardTrivia(source, openIndex - 1);
    if (before < 0) {
        return false;
    }
    const character = source.charAt(before);
    if (character === ':') {
        return !labelledBlockOpenBefore(source, openIndex);
    }
    // A `=` at the end of a `type` alias header opens that alias's body, a declaration. An `=`
    // anywhere else is an assignment, a value position where a `{` is an object literal: reading
    // every `=` as an operand position read `type X = { … }` as an expression body, which let the
    // type-body rule refuse load after load that a member-first body declares.
    if (character === '=') {
        return !isTypeAliasHeaderBefore(source, before);
    }
    if (OPERAND_POSITION_CHARACTERS.includes(character)) {
        return true;
    }
    if (character === '>' && source.charAt(before - 1) === '=') {
        return true; // an arrow body is an expression
    }
    // A `{` that directly follows a template hole's `${` is an operand-position body by the same
    // reading as one that follows a `(`: the brace starts the hole's expression, so its close ends
    // one and a following `/` is division. `const t = \`${ {a:1} / import(spec) / 2 }\`` hid its
    // import while only the `${`-shaped hole without the trailing division was read.
    if (character === '$' && source.charAt(before - 1) === '`') {
        return true;
    }
    return classOrFunctionExpressionBefore(source, before);
}

/**
 * Whether the `=` at `equals` ends a `type` alias header, whose `{` is then a type body rather than an
 * object literal. `type X = { … }` and `type X<T> = { … }` are declarations; `const x = { … }`, a
 * parameter default, and every other `=` are value positions whose `{` is an expression body.
 */
function isTypeAliasHeaderBefore(source: string, equals: number): boolean {
    let cursor = skipBackwardTrivia(source, equals - 1);
    if (cursor < 0) {
        return false;
    }
    if (source.charAt(cursor) === '>') {
        const afterOpen = skipBackwardBalancedDelimited(source, cursor, '<', '>');
        if (afterOpen === undefined) {
            return false;
        }
        cursor = skipBackwardTrivia(source, afterOpen);
    }
    if (cursor < 0 || !isIdentifierContinue(source.charAt(cursor))) {
        return false;
    }
    const name = readWordBackward(source, cursor);
    const beforeName = skipBackwardTrivia(source, cursor - name.length);
    return beforeName >= 0 && readWordBackward(source, beforeName) === 'type';
}

/** Characters that end a class, function, or method header scan without naming one. */
const HEADER_BOUNDARY_CHARACTERS = ';,\\{}:=';

/**
 * Whether a `class` or `function` keyword that `isDeclarationStatementPosition` does not place at
 * statement position — an expression — ends the header at `before`. Walking the header's own tokens
 * reaches the keyword: balanced parameter, generic, and index lists, the heritage clause or the
 * declaration's name, and the modifiers before it. A token that names no header stops the walk, so a
 * method body (`{ foo() {} }`), a call argument, and a bare statement block are not read as
 * expressions, and a declaration statement (`export default function f() {}`) keeps its reading.
 */
function classOrFunctionExpressionBefore(source: string, before: number): boolean {
    let cursor = before;
    while (cursor >= 0) {
        const character = source.charAt(cursor);
        if (character === '' || HEADER_BOUNDARY_CHARACTERS.includes(character)) {
            return false;
        }
        if (character === ')' || character === ']' || (character === '>' && source.charAt(cursor - 1) !== '=')) {
            const group = matchingHeaderDelimiter(character);
            const open = skipBackwardBalancedDelimited(source, cursor, group.open, group.close);
            if (open === undefined) {
                return false;
            }
            cursor = skipBackwardTrivia(source, open - 1);
            continue;
        }
        if (!isIdentifierContinue(character)) {
            return false;
        }
        const word = readWordBackward(source, cursor);
        const wordStart = cursor - word.length + 1;
        if (word === 'class') {
            // A `class` header is a declaration when it names a class and its own position is a
            // statement boundary; `class extends Base {}` names an expression, and so does a named
            // class after `=`. Reaching that keyword means walking past the name, its generics, and
            // any heritage clause, which are the header tokens the walk above already skips.
            const nameStart = skipBackwardTrivia(source, cursor + 1);
            const extendsClause = isKeywordAt(source, nameStart, 'extends');
            if (isIdentifierContinue(source.charAt(nameStart)) && !extendsClause) {
                return !isDeclarationStatementPosition(source, wordStart);
            }
            return !isDeclarationStatementPosition(source, wordStart) || isOperandPositionKeyword(source, wordStart);
        }
        if (word === 'function') {
            return !isDeclarationStatementPosition(source, wordStart);
        }
        cursor = skipBackwardTrivia(source, wordStart - 1);
    }
    return false;
}

/** Whether the token before the `class` at `keywordStart` puts that keyword in operand position. */
function isOperandPositionKeyword(source: string, keywordStart: number): boolean {
    const before = skipBackwardTrivia(source, keywordStart - 1);
    return before >= 0 && OPERAND_POSITION_CHARACTERS.includes(source.charAt(before));
}

/** The `open`/`close` pair of a header delimiter whose closing character is `close`. */
function matchingHeaderDelimiter(close: string): { open: string; close: string } {
    if (close === ')') {
        return { open: '(', close: ')' };
    }
    if (close === ']') {
        return { open: '[', close: ']' };
    }
    return { open: '<', close: '>' };
}

/**
 * Whether the `{` at `openIndex` follows a statement label (`foo: {}`) or a `case`/`default` clause
 * (`switch (x) { case 1: {} }`), whose block ends a statement when it closes. The `:` separates the
 * clause only when the token before it begins a statement — the start of input, another statement, a
 * control header's body, or a `case`/`default` keyword. A `:` after a name inside a brace-delimited
 * body (`{ foo: {} }`, `class C { foo: {} }`) is a property or member annotation instead, and that
 * brace may be an object literal whose close ends an expression, so it is not read as a clause.
 */
function labelledBlockOpenBefore(source: string, openIndex: number): boolean {
    const colon = skipBackwardTrivia(source, openIndex - 1);
    if (colon < 0 || source.charAt(colon) !== ':') {
        return false;
    }
    return clauseColonBefore(source, colon) || labelColonBefore(source, colon);
}

/** Characters an expression between a `case`/`default` keyword and its colon may contain. */
const CLAUSE_EXPRESSION_CHARACTERS = '.+-*/%<>=!&|^~,:';

/**
 * Whether the `:` at `colon` ends a `case`/`default` clause, read from the clause's own shape rather
 * than from the last character of its expression. Walking back over the clause's expression is what
 * recognizes `case 1 + 2:`, `case f(x):`, `case a.b:`, `case 'k':`, `case [1]:`, and
 * `case a ? b : c:`: each of those ends in a character that is not an identifier, so a walk that only
 * skipped one name read every one of them as an annotation or a label and hid the load behind the
 * block they introduce.
 */
function clauseColonBefore(source: string, colon: number): boolean {
    let cursor = skipBackwardTrivia(source, colon - 1);
    while (cursor >= 0) {
        const character = source.charAt(cursor);
        if (character === 'f' && readWordBackward(source, cursor) === 'default') {
            return true;
        }
        if (character === 'e' && readWordBackward(source, cursor) === 'case') {
            // `obj.case` and `this.#case` are members, never the keyword.
            const wordStart = cursor - 'case'.length + 1;
            return !isPrecededByDotAccess(source, wordStart) && !isPrivateNameStart(source, wordStart);
        }
        if (character === ')' || character === ']' || character === '}' || character === '>') {
            const group = matchingHeaderDelimiter(character);
            const open = skipBackwardBalancedDelimited(source, cursor, group.open, group.close);
            if (open === undefined) {
                return false;
            }
            cursor = skipBackwardTrivia(source, open - 1);
            continue;
        }
        // A ternary's `?` belongs to the clause's own expression, never to the clause, so a `?` on the
        // way back means the colon closed a ternary rather than the clause. The `?` of an optional
        // property has a `:` of its own, which the `:` case below stops at.
        if (character === '?') {
            return false;
        }
        if (character === '"' || character === "'") {
            const open = skipQuotedBackward(source, cursor, character);
            if (open === undefined) {
                return false;
            }
            cursor = skipBackwardTrivia(source, open - 1);
            continue;
        }
        // A clause's expression is ordinary code: its atoms, its member access, its index and call
        // results, and its operators all sit between the keyword and the colon. Walking them is what
        // reads `case 1 + 2:`, `case f(x):`, `case a.b:`, `case [1]:`, and `case a ? b : c:`.
        if (!isIdentifierContinue(character) && !CLAUSE_EXPRESSION_CHARACTERS.includes(character)) {
            return false;
        }
        cursor = skipBackwardTrivia(source, cursor - 1);
    }
    return false;
}

/**
 * Whether the `:` at `colon` ends a statement label (`foo:`), read from the label name alone: the name
 * must be an identifier and the token before it a statement boundary or a control header's body. A
 * `:` after a name inside a brace-delimited body is a property or member annotation.
 */
function labelColonBefore(source: string, colon: number): boolean {
    const cursor = skipBackwardTrivia(source, colon - 1);
    if (cursor < 0 || !isIdentifierContinue(source.charAt(cursor))) {
        return false;
    }
    const name = readWordBackward(source, cursor);
    const nameStart = cursor - name.length + 1;
    const beforeName = skipBackwardTrivia(source, nameStart - 1);
    if (name === 'default' && isIdentifierStart(source.charAt(nameStart))) {
        return true; // `default: { … }` — a switch clause, and a legal label
    }
    if (!isIdentifierStart(source.charAt(nameStart))) {
        return false; // the `:` ends no label name (`{ 1: {} }` is a property)
    }
    if (beforeName < 0) {
        return true;
    }
    const character = source.charAt(beforeName);
    if (character === ';' || character === '}') {
        return true;
    }
    return character === ')' && closingParenAllowsRegex(source, beforeName);
}

/** Modifiers that can precede a declaration keyword at statement position. */
const DECLARATION_MODIFIER_KEYWORDS: ReadonlySet<string> = new Set([
    'abstract',
    'async',
    'export',
    'default',
    'declare',
]);

/**
 * Whether the declaration keyword starting at `keywordStart` sits at statement position: the token
 * before it, after skipping leading modifiers, is a statement boundary or the start of input. A
 * `class`/`function` after `=`, `(`, `,`, `return`, or another expression token is an expression.
 */
function isDeclarationStatementPosition(source: string, keywordStart: number): boolean {
    let before = skipBackwardTrivia(source, keywordStart - 1);
    while (before >= 0 && isIdentifierContinue(source[before])) {
        const word = readWordBackward(source, before);
        if (DECLARATION_MODIFIER_KEYWORDS.has(word)) {
            before = skipBackwardTrivia(source, before - word.length);
            continue;
        }
        return false;
    }
    if (before < 0) {
        return true;
    }
    const character = source[before];
    return character === ';' || character === '{' || character === '}';
}

/**
 * The regex-versus-division decision, made from the previous significant token rather than the
 * single preceding character. A `/` opens a regex after an operator, `(`, `[`, `{`, `,`, `;`, `:`,
 * `=`, `!`, `&`, `|`, `?`, `=>`, a keyword that expects an expression, or at the start of input;
 * it is division after an identifier, number, string, template, regex literal, `)`, `]`, `}`, or
 * `++`/`--`. The reading of `)`, `]`, and `}` is position-dependent and precedence-ordered: the
 * token alone never decides. A `)` consults the control-header context, so `if (x) /re/` is a regex
 * while `foo() / 2` divides. A `}` consults the construct that owns it, so a declaration or statement
 * block close (`class C {}`, `export {}`) is a statement end and a regex follows, while an object
 * literal in operand position (`const r = { x: 1 }`, `foo({} / 2)`, a template hole's `${ {a:1}`)
 * ends an expression and a division follows; the statement-end reading is the fallback for every
 * close the walk does not model, and an operand-position reading is checked first wherever the walk
 * can prove one. A `]` is always an expression end.
 */
function canStartRegexLiteral(source: string, index: number): boolean {
    const previous = previousSignificantCharacter(source, index - 1);
    if (previous === undefined) {
        return true;
    }
    const character = source[previous];
    if (character === ')') {
        return closingParenAllowsRegex(source, previous);
    }
    if (character === '}') {
        return closeBraceStartsStatement(source, previous);
    }
    if (character === ']') {
        return false;
    }
    if (character === '"' || character === "'" || character === '`') {
        return false;
    }
    if (character === '+' || character === '-') {
        // `++`/`--` end an expression, so a `/` after either is division.
        return source[previous - 1] !== character;
    }
    if (character === '!') {
        // `!` is postfix — so a `/` after it is division, exactly as after `++` — when the token
        // before it ends an expression: `const y = a! / require(spec) / 2;` sees the load. A prefix
        // `!` (`const y = !import(spec) / 2;`) keeps its operator reading, where the `/` follows the
        // asserted operand. Reading every `!` as an operator prefix hid the load behind one.
        return !tokenBeforeEndsExpression(source, previous);
    }
    if (character === '/') {
        // A `/` that closes a regex is an expression end; any other `/` is a division operator,
        // after which a regex may start (`a / /re/`).
        return regexLiteralOpenBackward(source, previous) === undefined;
    }
    if (isIdentifierContinue(character)) {
        // A property named after a prefix keyword (`cfg.case`, `box.new`) and a `#` private member
        // named after one (`this.#case`) are not the keyword, so a `/` after either is division.
        const word = readWordBackward(source, previous);
        const wordStart = previous - word.length + 1;
        if (isPrecededByDotAccess(source, wordStart) || isPrivateNameStart(source, wordStart)) {
            return false;
        }
        return REGEX_PREFIX_KEYWORDS.has(word);
    }
    if (isDecimalDigit(character)) {
        return false;
    }
    return character !== undefined && '([{;=,.!?:~%^&*+<>|'.includes(character);
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
            cursor = scanImportTemplate(source, cursor, source.length, new Set());
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
 * a snapshot and must not be skipped. Wrapped and bound callees are resolved through the single-file
 * binding pass, and a binding whose shadowing the pass cannot decide is refused rather than guessed.
 * The loader itself is deliberately absent from a command's
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
