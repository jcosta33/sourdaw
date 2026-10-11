/* eslint-disable max-lines -- Keep selection policy and verified checkout context in the same producer source. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { assertCollectedBrowserInventory } from './e2eCollectorInventory.ts';
import { verifyIntegrationCheckout } from './e2eSelectionShadowIntegration.ts';
import { partitionByDuration, readSpecDurations, type SpecDurations } from './e2eShardPartition.ts';
import { isPlaywrightCollected } from './vitestCollectionPatterns.ts';

import type { AffectedSelection } from './e2eAffectedGraph.ts';

export const SMOKE_SPEC = 'tests/e2e/smoke.spec.ts';

// Explicit operational entry points: adding a new script never silently opts out.
const REVIEW_TOOLING = new Set([
    'agentDeliveryScripts',
    'acceptReview',
    'claimTrackerIssue',
    'checkStancesRecord',
    'confirmReviewRepairs',
    'deliverPullRequest',
    'fileTrackerIssue',
    'prepareReview',
    'prepareReviewEntry',
    'publishLane',
    'publishReview',
    'reconcileTrackerIssue',
    'reconstructReviewRounds',
    'recoverDeliveryLock',
    'recoverPublishReviewLock',
    'repairReviewFinding',
    'resolveThread',
    'reviewApprovalFormat',
    'reviewDocumentParser',
    'reviewDossier',
    'reviewDossierBindings',
    'reviewDossierChain',
    'reviewDossierPublication',
    'reviewDossierReassessed',
    'reviewDossierSemanticAssessment',
    'reviewDossierViews',
    'reviewPublicationBinding',
    'reviewPublicationLegacyIncidents',
    'reviewPublicationReceiptAdoption',
    'reviewPublicationRecoveryReceipt',
    'reviewPublicationRemoteInspection',
    'reviewerModelDiversity',
    'reviewRoundEscalation',
    'reviewRiskPolicy',
    'reviewStructuralAdmission',
    'reviewRepair',
    'reviewShadowStatus',
    'savedProjectStatePaths',
    'semanticReview',
    'semanticReviewContext',
    'semanticReviewEvaluation',
    'semanticReviewMeasurement',
    'reviewDiffSummary',
    'reviewCommentDiffPreflight',
    'reviewBundleLocator',
    'reviewApprovalContext',
    'deliveryRemoteInspection',
    'deliveryLockLegacyIncidents',
    'pullRequestReviewState',
    'pullRequestMutationLock',
    'prValidationScope',
    'pruneLane',
    'removeLane',
    'retargetCapabilityPlan',
    'retargetCapabilitySnapshot',
    'rulesetHardening',
    'stackedLanes',
    'stampLaneIdentity',
    'supersedePullRequest',
    'supersedePullRequestGh',
    'syncParentLane',
    'trustedGithubWriteBootstrap',
    'typesafeRequest',
    'trackerIssueReconciliation',
]);

const REVIEW_TOOLING_SPEC_ONLY = new Set([
    'deliveryRiskPlanLoss',
    'orchestratorReviewState',
    'recoverDeliveryLockGeneral',
    'recoverPublishReviewLockReceiptReplay',
    'threeRoleTransitions',
]);

const RELEASE_TOOLING_METADATA = new Set([
    'release/open-source-inventory.json',
    'release/dependency-license-proofs.json',
]);

const SEMANTIC_REVIEW_TOOLING = new Set([
    '__tests__/admissionScheduling.spec.ts',
    '__tests__/candidateFindings.spec.ts',
    '__tests__/changeFacts.spec.ts',
    '__tests__/digestProbes.ts',
    '__tests__/egressVendorShapeExtraction.spec.ts',
    '__tests__/multiPassTransport.spec.ts',
    '__tests__/semanticReview.spec.ts',
    'admissionBytes.ts',
    'candidateFindings.ts',
    'changeFacts.ts',
    'contractCarrying.ts',
    'contracts.ts',
    'egressVendorShapeExtraction.ts',
    'egressVendorShapes.ts',
    'egressVendorToml.ts',
    'evaluation/__tests__/semanticEvaluation.spec.ts',
    'evaluation/corpus.ts',
    'evaluation/runEvaluation.ts',
    'evaluation/semanticEvaluationCorpus.json',
    'evidence.ts',
    'evidenceOrdering.ts',
    'fit.ts',
    'gitSource.ts',
    'interpret.ts',
    'passes.ts',
    'pathOrder.ts',
    'planPublication.ts',
    'provider.ts',
    'report.ts',
    'reportAssessments.ts',
    'reporting.ts',
    'requestPayload.ts',
    'requiredEvidence.ts',
    'replay.ts',
    'rules.ts',
    'run.ts',
    'scopeAccounting.ts',
    'sensitive.ts',
    'slicing.ts',
    'unitAssessment.ts',
    'unitPriority.ts',
    'verify.ts',
    'withheldReasons.ts',
]);

const SEMANTIC_MEASUREMENT_TOOLING = new Set(['artifacts.ts', 'contracts.ts', 'gaps.ts', 'record.ts']);

const OPERATIONAL_PACKAGE_SCRIPTS = new Map([['retarget:plan', 'node scripts/retargetCapabilitySnapshot.ts']]);

export type BrowserMatrix = { include: { id: number; specs: string[] }[] };
export type ValidationPlan = {
    version: 1;
    profile: 'docs' | 'tooling' | 'broad';
    browser: boolean;
    browserAi: boolean;
    codeql: boolean;
    matrix: BrowserMatrix;
    reasons: { path: string; reason: string }[];
};

function isDocumentation(path: string): boolean {
    return path.endsWith('.md') && (path.startsWith('docs/') || path.startsWith('.agents/') || !path.includes('/'));
}

function needsCodeql(path: string): boolean {
    return (
        /\.(?:[cm]?[jt]sx?)$/.test(path) ||
        path.startsWith('.github/') ||
        /^(?:package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.gitleaks\.toml)$/.test(path)
    );
}

function isReviewTooling(path: string): boolean {
    if (path === 'scripts/e2eCollectorInventory.ts') {
        return true;
    }
    if (RELEASE_TOOLING_METADATA.has(path)) {
        return true;
    }
    if (path.startsWith('scripts/semanticReview/')) {
        return SEMANTIC_REVIEW_TOOLING.has(path.slice('scripts/semanticReview/'.length));
    }
    if (path.startsWith('scripts/semanticReviewMeasurement/')) {
        return SEMANTIC_MEASUREMENT_TOOLING.has(path.slice('scripts/semanticReviewMeasurement/'.length));
    }
    const source = /^scripts\/([A-Za-z]+)\.ts$/.exec(path)?.[1];
    if (source !== undefined) {
        return REVIEW_TOOLING.has(source);
    }
    const spec = /^scripts\/__tests__\/([A-Za-z0-9]+)\.spec\.ts$/.exec(path)?.[1];
    if (spec === undefined) {
        return false;
    }
    if (REVIEW_TOOLING_SPEC_ONLY.has(spec)) {
        return true;
    }
    return REVIEW_TOOLING.has(spec.replace(/\d+$/, ''));
}

function toolingReason(path: string, packageScriptOnly: boolean): string | null {
    if (path === 'package.json' && packageScriptOnly) {
        return 'known operational script route; security/static checks without browser execution';
    }
    if (isReviewTooling(path)) {
        return 'known review tooling; security/static checks without browser execution';
    }
    return null;
}

function isSpec(path: string): boolean {
    const segments = path.split('/');
    return isPlaywrightCollected(path) && !segments.includes('..') && !segments.includes('node_modules');
}

function isRegularFile(path: string): boolean {
    try {
        return lstatSync(path).isFile();
    } catch {
        return false;
    }
}

export function parseChangedPaths(diff: string): string[] {
    if (diff === '') {
        throw new Error('Changed-path diff is empty');
    }
    const fields = diff.split('\0');
    if (fields.pop() !== '') {
        throw new Error('Changed-path diff must be NUL terminated');
    }
    const paths = new Set<string>();
    for (let index = 0; index < fields.length;) {
        const status = fields[index++];
        if (status === undefined || !/^(?:[AMDUT]|[RC]\d+)$/.test(status)) {
            throw new Error(`Unsupported diff status: ${status}`);
        }
        const count = /^[RC]/.test(status) ? 2 : 1;
        for (let offset = 0; offset < count; offset++) {
            const path = fields[index++];
            if (!path || path.startsWith('/') || path.split('/').includes('..')) {
                throw new Error('Invalid changed path');
            }
            paths.add(path);
        }
    }
    return [...paths].sort();
}

function packageHasModifiedStatus(diff: string): boolean {
    const fields = diff.split('\0');
    let modified = false;
    for (let index = 0; index < fields.length - 1;) {
        const status = fields[index++];
        const firstPath = fields[index++];
        const secondPath = status?.startsWith('R') || status?.startsWith('C') ? fields[index++] : undefined;
        if (firstPath !== 'package.json' && secondPath !== 'package.json') {
            continue;
        }
        if (modified || status !== 'M' || firstPath !== 'package.json') {
            return false;
        }
        modified = true;
    }
    return modified;
}

type PackageDocument = Record<string, unknown> & { scripts: Record<string, string> };

function readPackageBlob(root: string, revision: string): PackageDocument | null {
    const tree = execFileSync('git', ['ls-tree', revision, '--', 'package.json'], { cwd: root, encoding: 'utf8' });
    if (!/^100644 blob [a-f0-9]{40}\tpackage\.json\n$/.test(tree)) {
        return null;
    }
    const source = execFileSync('git', ['show', `${revision}:package.json`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
    });
    const parsed: unknown = JSON.parse(source);
    if (
        source !== `${JSON.stringify(parsed, null, 4)}\n` ||
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        return null;
    }
    const scripts: unknown = (parsed as Record<string, unknown>).scripts;
    if (
        !scripts ||
        typeof scripts !== 'object' ||
        Array.isArray(scripts) ||
        Object.values(scripts).some((value) => typeof value !== 'string')
    ) {
        return null;
    }
    return parsed as PackageDocument;
}

function isOperationalPackageScriptChange(root: string, diff: string, base: string, head: string): boolean {
    if (!packageHasModifiedStatus(diff)) {
        return false;
    }
    try {
        const mergeBase = execFileSync('git', ['merge-base', base, head], { cwd: root, encoding: 'utf8' }).trim();
        if (!/^[a-f0-9]{40}$/.test(mergeBase)) {
            return false;
        }
        const basePackage = readPackageBlob(root, base);
        const before = readPackageBlob(root, mergeBase);
        const after = readPackageBlob(root, head);
        if (!basePackage || !before || !after || !isDeepStrictEqual(basePackage, before)) {
            return false;
        }
        const { scripts: oldScripts, ...oldFields } = before;
        const { scripts: newScripts, ...newFields } = after;
        if (!isDeepStrictEqual(oldFields, newFields)) {
            return false;
        }
        const changedKeys = Array.from(new Set([...Object.keys(oldScripts), ...Object.keys(newScripts)])).filter(
            (key) => oldScripts[key] !== newScripts[key]
        );
        return (
            changedKeys.length > 0 &&
            changedKeys.every((key) => {
                const allowed = OPERATIONAL_PACKAGE_SCRIPTS.get(key);
                return (
                    allowed !== undefined &&
                    (oldScripts[key] === undefined || oldScripts[key] === allowed) &&
                    (newScripts[key] === undefined || newScripts[key] === allowed)
                );
            })
        );
    } catch {
        return false;
    }
}

function browserMatrix(specs: readonly string[], durations: SpecDurations): BrowserMatrix {
    if (specs.length === 0) {
        return { include: [] };
    }
    const count = Math.min(12, Math.ceil(specs.length / 12));
    return {
        include: partitionByDuration(specs, durations, count).map((group, index) => ({ id: index + 1, specs: group })),
    };
}

function browserPathSelection(
    path: string,
    available: ReadonlySet<string>,
    affected?: AffectedSelection
): { specs: readonly string[]; browserAi: boolean; broad: boolean; reason: string } {
    if (isSpec(path) && available.has(path)) {
        return {
            specs: [path],
            browserAi: path.startsWith('tests/e2e/browserAi'),
            broad: false,
            reason: 'changed browser spec',
        };
    }
    if (affected?.kind === 'narrow' && path.startsWith('src/modules/')) {
        return {
            specs: affected.specs,
            browserAi: affected.browserAi,
            broad: false,
            reason: `affected feature owners: ${affected.owners.join(', ')}`,
        };
    }
    return {
        specs: [],
        browserAi: true,
        broad: true,
        reason: 'product, shared, deleted, renamed, or unclassified dependency; full browser coverage',
    };
}

export function selectValidationPlan(
    paths: readonly string[],
    availableSpecs: readonly string[],
    durations: SpecDurations = new Map(),
    packageScriptOnly = false,
    affected?: AffectedSelection
): ValidationPlan {
    if (paths.length === 0) {
        throw new Error('Changed path list is empty');
    }
    const inventory = [...new Set(availableSpecs)].sort();
    if (inventory.some((path) => !isSpec(path))) {
        throw new Error('Invalid E2E inventory');
    }
    const available = new Set(inventory);
    const selected = new Set<string>();
    const reasons: ValidationPlan['reasons'] = [];
    let broad = false;
    let browser = false;
    let browserAi = false;
    let codeql = false;
    let tooling = false;
    for (const path of paths) {
        if (isDocumentation(path)) {
            reasons.push({ path, reason: 'documentation; no browser execution' });
            continue;
        }
        codeql ||= needsCodeql(path);
        const reason = toolingReason(path, packageScriptOnly);
        if (reason !== null) {
            tooling = true;
            reasons.push({ path, reason });
            continue;
        }
        browser = true;
        const selection = browserPathSelection(path, available, affected);
        for (const spec of selection.specs) {
            selected.add(spec);
        }
        broad ||= selection.broad;
        browserAi ||= selection.browserAi;
        reasons.push({ path, reason: selection.reason });
    }
    if (browser && !available.has(SMOKE_SPEC)) {
        throw new Error(`Required smoke spec is missing: ${SMOKE_SPEC}`);
    }
    const specs = (broad ? inventory : [...selected].sort()).filter((path) => path !== SMOKE_SPEC);
    if (broad && specs.length === 0) {
        throw new Error('Full browser coverage has no specs');
    }
    const matrix = browserMatrix(specs, durations);
    let profile: ValidationPlan['profile'] = 'docs';
    if (browser) {
        profile = 'broad';
    } else if (tooling) {
        profile = 'tooling';
    }
    return { version: 1, profile, browser, browserAi, codeql, matrix, reasons };
}

export function selectedSpecArguments(value: unknown, root: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Selected E2E specs must be a nonempty string list');
    }
    const specs: string[] = [];
    for (const path of value as unknown[]) {
        if (typeof path !== 'string') {
            throw new TypeError('Selected E2E specs must be a nonempty string list');
        }
        specs.push(path);
    }
    if (new Set(specs).size !== specs.length) {
        throw new Error('Selected E2E specs must be unique');
    }
    return specs.map((path) => {
        if (!isSpec(path) || !isRegularFile(resolve(root, path))) {
            throw new Error(`Selected E2E spec is invalid or missing: ${path}`);
        }
        // Playwright CLI arguments are regexes against absolute file paths, not literals.
        return `^${resolve(root, path).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    });
}

function listSpecs(root: string): string[] {
    const specs: string[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true, withFileTypes: true })) {
        const path = relative(root, resolve(entry.parentPath, entry.name));
        if (entry.isFile() && isSpec(path)) {
            specs.push(path);
        }
    }
    return specs;
}

function verifiedCheckoutDiff(
    root: string,
    base: string,
    head: string
): {
    checkout: string;
    firstParent: string;
    diff: string;
} {
    const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    let firstParent = base;
    let left = `${base}...${head}`;
    let right: string | undefined;
    if (checkout !== head) {
        verifyIntegrationCheckout(root, checkout, head, base);
        const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', checkout], {
            cwd: root,
            encoding: 'utf8',
        })
            .trim()
            .split(' ');
        firstParent = parents[1] ?? '';
        left = firstParent;
        right = checkout;
    }
    const diffArgs = ['diff', '--name-status', '-z', '--find-renames', left];
    if (right) {
        diffArgs.push(right);
    }
    diffArgs.push('--');
    const diff = execFileSync('git', diffArgs, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    return { checkout, firstParent, diff };
}

function widenForUnprovenHistory(
    plan: ValidationPlan,
    specs: readonly string[],
    durations: SpecDurations,
    historicalChange: boolean,
    dirtyTracked: boolean
): void {
    if (!historicalChange && !dirtyTracked) {
        return;
    }
    const full = specs.filter((path) => path !== SMOKE_SPEC);
    if (!specs.includes(SMOKE_SPEC) || full.length === 0) {
        throw new Error('Unproven checkout requires a complete browser inventory');
    }
    plan.profile = 'broad';
    plan.browser = true;
    plan.browserAi = true;
    plan.matrix = browserMatrix(full, durations);
    plan.reasons.push({
        path: dirtyTracked ? 'dirty checkout' : 'changed path history',
        reason: dirtyTracked
            ? 'tracked checkout differs from its Git commit; full browser coverage'
            : 'deleted, renamed, or type-changed path; full browser coverage',
    });
}

export async function resolveCheckoutSelection(
    root: string,
    base: string,
    head: string,
    specs: readonly string[],
    durations: SpecDurations = readSpecDurations()
): Promise<{ plan: ValidationPlan; firstParent: string; checkout: string; diff: string }> {
    const { checkout, firstParent, diff } = verifiedCheckoutDiff(root, base, head);
    const paths = parseChangedPaths(diff);
    const trackedStatus = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: root,
        encoding: 'utf8',
    });
    if (trackedStatus.status !== 0) {
        throw new Error('Cannot verify integration checkout cleanliness');
    }
    const dirtyTracked = trackedStatus.stdout !== '';
    const packageStatus = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'package.json'], {
        cwd: root,
        encoding: 'utf8',
    });
    const packageScriptOnly =
        paths.includes('package.json') &&
        packageStatus.status === 0 &&
        packageStatus.stdout === '' &&
        isOperationalPackageScriptChange(root, diff, firstParent, checkout);
    const productPaths = paths.filter(
        (path) =>
            !isDocumentation(path) &&
            toolingReason(path, packageScriptOnly) === null &&
            !(isSpec(path) && specs.includes(path))
    );
    const historicalChange = /(?:^|\0)(?:D|R\d+|C\d+|T)\0/.test(diff);
    const graphInputsDirty = spawnSync(
        'git',
        [
            'status',
            '--porcelain',
            '--untracked-files=all',
            '--',
            'src',
            'public',
            'scripts/e2eSuiteOwners.json',
            'scripts/e2eAffectedGraph.ts',
            'tsconfig.json',
        ],
        { cwd: root, encoding: 'utf8' }
    );
    const cleanGraphInputs = graphInputsDirty.status === 0 && graphInputsDirty.stdout === '';
    let affected: AffectedSelection | undefined;
    if (
        cleanGraphInputs &&
        !historicalChange &&
        productPaths.length > 0 &&
        productPaths.every((path) => path.startsWith('src/modules/'))
    ) {
        try {
            const { loadAffectedE2e } = await import('./e2eAffectedGraph.ts');
            affected = await loadAffectedE2e(root, productPaths, specs);
        } catch {
            affected = { kind: 'full', reason: 'dependency graph helper unavailable' };
        }
    }
    const plan = selectValidationPlan(paths, specs, durations, packageScriptOnly, affected);
    widenForUnprovenHistory(plan, specs, durations, historicalChange, dirtyTracked);
    if (affected?.kind === 'full') {
        plan.reasons.push({ path: 'affected graph', reason: affected.reason });
    }
    return { plan, firstParent, checkout, diff };
}

async function main(): Promise<void> {
    const root = process.cwd();
    if (process.argv[2] === 'run') {
        const args = selectedSpecArguments(JSON.parse(process.env.E2E_SPECS ?? 'null'), root);
        const result = spawnSync('pnpm', ['test:e2e', ...args, '--retries=0', '--reporter=blob'], { stdio: 'inherit' });
        if (result.error) {
            throw result.error;
        }
        process.exitCode = result.status ?? 1;
        return;
    }
    if (process.argv[2] !== 'plan') {
        throw new Error('Expected plan or run');
    }
    const { BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output } = process.env;
    if (!base || !head || !/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head) || !output) {
        throw new Error('Plan requires immutable base/head SHAs and GITHUB_OUTPUT');
    }
    const specs = listSpecs(root);
    const { plan, firstParent, checkout } = await resolveCheckoutSelection(root, base, head, specs);
    console.log(
        JSON.stringify({ eventBase: base, candidateHead: head, integrationFirstParent: firstParent, checkout })
    );
    if (plan.browser) {
        assertCollectedBrowserInventory(root, specs, [
            SMOKE_SPEC,
            ...plan.matrix.include.flatMap((group) => group.specs),
        ]);
    }
    writeFileSync('pr-validation-scope.json', `${JSON.stringify(plan, null, 2)}\n`);
    appendFileSync(
        output,
        `profile=${plan.profile}\nbrowser=${plan.browser}\nbrowser-ai=${plan.browserAi}\ncodeql=${plan.codeql}\nmatrix=${JSON.stringify(plan.matrix)}\n`
    );
    console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
/* eslint-enable max-lines */
