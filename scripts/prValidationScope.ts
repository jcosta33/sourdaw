import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { assertCollectedBrowserInventory } from './e2eCollectorInventory.ts';
import { partitionByDuration, readSpecDurations, type SpecDurations } from './e2eShardPartition.ts';
import { TEST_FIXTURE_REASON, testSidePathSelection, testSideRoutes, type TestSideRoute } from './e2eTestSideRoute.ts';
import {
    parseChangedPaths,
    parseChangedRecords,
    readCheckoutDiff,
    SELECTION_INPUTS,
} from './prValidationScopeCheckout.ts';
import { isRepositoryTooling } from './repositoryToolingPaths.ts';
import { isPlaywrightCollected, isVitestCollected } from './vitestCollectionPatterns.ts';

import type { AffectedSelection, RuntimeGraph } from './e2eAffectedGraph.ts';
import type { CoverageSelection } from './e2eCoverageSelection.ts';

export { parseChangedPaths } from './prValidationScopeCheckout.ts';

export const SMOKE_SPEC = 'tests/e2e/smoke.spec.ts';

// Explicit operational entry points: adding a new script never silently opts out.
const REVIEW_TOOLING = new Set([
    'agentDeliveryScripts',
    'acceptReview',
    'claimTrackerIssue',
    'cleanupLanes',
    'installCleanupLanes',
    'laneActivity',
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
    'reviewDiffSummary',
    'reviewCommentDiffPreflight',
    'reviewBundleLocator',
    'reviewApprovalContext',
    'deliveryRemoteInspection',
    'deliveryLockLegacyIncidents',
    'pullRequestReviewState',
    'pullRequestMutationLock',
    'prValidationScope',
    'prValidationScopeCheckout',
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

const OPERATIONAL_PACKAGE_SCRIPTS = new Map([
    ['retarget:plan', 'node scripts/retargetCapabilitySnapshot.ts'],
    ['lane:cleanup', 'node scripts/cleanupLanes.ts'],
    ['lane:cleanup:install', 'node scripts/installCleanupLanes.ts'],
]);

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

/**
 * Vitest specs under src/ never reach the browser: the production dependency graph excludes them and
 * Playwright ignores them. Non-spec files under `__tests__/` are not matched, because a browser
 * harness page may load them.
 */
function isProductUnitSpec(path: string): boolean {
    return path.startsWith('src/') && isVitestCollected(path);
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

function readPackageBlob(revision: string): PackageDocument | null {
    const tree = execFileSync('git', ['ls-tree', revision, '--', 'package.json'], { encoding: 'utf8' });
    if (!/^100644 blob [a-f0-9]{40}\tpackage\.json\n$/.test(tree)) {
        return null;
    }
    const source = execFileSync('git', ['show', `${revision}:package.json`], {
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

function isOperationalPackageScriptChange(diff: string, base: string, head: string): boolean {
    if (!packageHasModifiedStatus(diff)) {
        return false;
    }
    try {
        const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
        if (!/^[a-f0-9]{40}$/.test(mergeBase)) {
            return false;
        }
        const basePackage = readPackageBlob(base);
        const before = readPackageBlob(mergeBase);
        const after = readPackageBlob(head);
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

const FULL_COVERAGE_REASON = 'product, shared, deleted, renamed, or unclassified dependency; full browser coverage';

function browserPathSelection(
    path: string,
    available: ReadonlySet<string>,
    affected?: AffectedSelection,
    coverage?: CoverageSelection
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
    const covered = coverage?.kind === 'specs' ? coverage.paths.find((entry) => entry.path === path) : undefined;
    if (covered !== undefined) {
        return { specs: covered.specs, browserAi: covered.browserAi, broad: false, reason: covered.reason };
    }
    return {
        specs: [],
        browserAi: true,
        broad: true,
        reason: coverage?.kind === 'full' ? `${FULL_COVERAGE_REASON}; ${coverage.reason}` : FULL_COVERAGE_REASON,
    };
}

type PathSelection = { browser: false; reason: string } | ({ browser: true } & ReturnType<typeof browserPathSelection>);

/** A unit spec or unit-only test fixture runs no browser; every other product path selects specs. */
function pathSelection(
    path: string,
    available: ReadonlySet<string>,
    selections: { affected?: AffectedSelection; coverage?: CoverageSelection; testSide?: readonly TestSideRoute[] }
): PathSelection {
    if (isProductUnitSpec(path)) {
        return { browser: false, reason: 'unit test source; broad non-browser validation without browser execution' };
    }
    const side = selections.testSide?.find((route) => route.path === path);
    if (side === undefined) {
        return { browser: true, ...browserPathSelection(path, available, selections.affected, selections.coverage) };
    }
    if (side.kind === 'specs' && side.specs.length === 0) {
        return { browser: false, reason: TEST_FIXTURE_REASON };
    }
    return { browser: true, ...testSidePathSelection(side, available, FULL_COVERAGE_REASON) };
}

function planProfile(broad: boolean, tooling: boolean): ValidationPlan['profile'] {
    if (broad) {
        return 'broad';
    }
    return tooling ? 'tooling' : 'docs';
}

export function selectValidationPlan(
    paths: readonly string[],
    availableSpecs: readonly string[],
    durations: SpecDurations = new Map(),
    packageScriptOnly = false,
    affected?: AffectedSelection,
    coverage?: CoverageSelection,
    testSide?: readonly TestSideRoute[]
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
    let nonBrowser = false;
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
        if (isRepositoryTooling(path)) {
            nonBrowser = true;
            reasons.push({
                path,
                reason: 'repository tooling; broad non-browser validation without browser execution',
            });
            continue;
        }
        const selection = pathSelection(path, available, { affected, coverage, testSide });
        if (!selection.browser) {
            nonBrowser = true;
            reasons.push({ path, reason: selection.reason });
            continue;
        }
        browser = true;
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
    const profile = planProfile(browser || nonBrowser, tooling);
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

/** Every collected browser spec under tests/e2e, as repository paths. */
export function listSpecs(root: string): string[] {
    const specs: string[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true, withFileTypes: true })) {
        const path = relative(root, resolve(entry.parentPath, entry.name));
        if (entry.isFile() && isSpec(path)) {
            specs.push(path);
        }
    }
    return specs;
}

/** Paths that need browser coverage beyond documentation, repository tooling, unit specs, and collected specs. */
export function productPathsOf(
    paths: readonly string[],
    specs: readonly string[],
    packageScriptOnly: boolean
): string[] {
    return paths.filter(
        (path) =>
            !isDocumentation(path) &&
            toolingReason(path, packageScriptOnly) === null &&
            !isRepositoryTooling(path) &&
            !isProductUnitSpec(path) &&
            !(isSpec(path) && specs.includes(path))
    );
}

const HISTORICAL_STATUS = /(?:^|\0)(?:D|R\d+|C\d+|T)\0/;

/** The planner narrows only live product sources under src/modules/; a deleted, renamed, copied, or retyped path widens. */
export function canNarrow(input: {
    productPaths: readonly string[];
    candidateDiff: string;
    integrationDiff: string;
}): boolean {
    const historicalChange = [input.candidateDiff, input.integrationDiff].some((value) =>
        HISTORICAL_STATUS.test(value)
    );
    return (
        !historicalChange &&
        input.productPaths.length > 0 &&
        input.productPaths.every((path) => path.startsWith('src/modules/'))
    );
}

type RuntimeGraphResult = RuntimeGraph | { kind: 'full'; reason: string };

async function affectedFromCheckout(
    root: string,
    base: string,
    head: string,
    diff: string,
    specs: readonly string[],
    coverageMap: { path: string | undefined; createdAt: string | undefined }
): Promise<{
    paths: string[];
    packageScriptOnly: boolean;
    affected?: AffectedSelection;
    coverage?: CoverageSelection;
    testSide?: TestSideRoute[];
}> {
    const paths = parseChangedPaths(diff);
    const packageScriptOnly = paths.includes('package.json') && isOperationalPackageScriptChange(diff, base, head);
    const changedProductPaths = productPathsOf(paths, specs, packageScriptOnly);
    const graphInputsDirty = spawnSync(
        'git',
        ['status', '--porcelain', '--untracked-files=all', '--', ...SELECTION_INPUTS],
        { cwd: root, encoding: 'utf8' }
    );
    const cleanGraphInputs = graphInputsDirty.status === 0 && graphInputsDirty.stdout === '';
    const candidates = cleanGraphInputs ? changedProductPaths : [];
    const testSide = await testSideRoutes(root, candidates, parseChangedRecords(diff), specs);
    // Routed test-side modules leave the product route, so neither narrowing rule sees them.
    const productPaths = changedProductPaths.filter((path) => !testSide.some((route) => route.path === path));
    // Owner narrowing and coverage selection read one shared graph, built at most once.
    let runtime: Promise<RuntimeGraphResult> | undefined;
    const loadRuntime = async (): Promise<RuntimeGraphResult> => {
        runtime ??= import('./e2eAffectedGraph.ts').then(({ loadRuntimeGraph }) => loadRuntimeGraph(root));
        return runtime;
    };
    let affected: AffectedSelection | undefined;
    if (cleanGraphInputs && canNarrow({ productPaths, candidateDiff: diff, integrationDiff: '' })) {
        try {
            const { loadAffectedE2e } = await import('./e2eAffectedGraph.ts');
            affected = await loadAffectedE2e(root, productPaths, specs, await loadRuntime());
        } catch {
            affected = { kind: 'full', reason: 'dependency graph helper unavailable' };
        }
    }
    // Without a configured map path (a local run), the coverage rule is not in play at all.
    if (productPaths.length === 0 || affected?.kind === 'narrow' || coverageMap.path === undefined) {
        return { paths, packageScriptOnly, affected, testSide };
    }
    if (!cleanGraphInputs) {
        const coverage: CoverageSelection = { kind: 'full', reason: 'selection inputs are dirty' };
        return { paths, packageScriptOnly, affected, coverage, testSide };
    }
    const product = new Set(productPaths);
    let coverage: CoverageSelection;
    try {
        const { loadCoverageSelection } = await import('./e2eCoverageSelection.ts');
        coverage = await loadCoverageSelection({
            root,
            base,
            head,
            changes: parseChangedRecords(diff).filter((record) => product.has(record.path)),
            availableSpecs: specs,
            map: coverageMap,
            now: new Date(),
            loadRuntime,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        coverage = { kind: 'full', reason: `coverage selection failed: ${message}` };
    }
    return { paths, packageScriptOnly, affected, coverage, testSide };
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
    const { checkout, firstParent, diff } = readCheckoutDiff(root, base, head);
    const specs = listSpecs(root);
    const { paths, packageScriptOnly, affected, coverage, testSide } = await affectedFromCheckout(
        root,
        firstParent,
        checkout,
        diff,
        specs,
        { path: process.env.E2E_COVERAGE_MAP, createdAt: process.env.E2E_COVERAGE_MAP_CREATED_AT }
    );
    console.log(
        JSON.stringify({ eventBase: base, candidateHead: head, integrationFirstParent: firstParent, checkout })
    );
    const durations = readSpecDurations();
    const plan = selectValidationPlan(paths, specs, durations, packageScriptOnly, affected, coverage, testSide);
    if (affected?.kind === 'full') {
        plan.reasons.push({ path: 'affected graph', reason: affected.reason });
    }
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
