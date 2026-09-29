import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE_SPEC = 'tests/e2e/smoke.spec.ts';

// Explicit operational entry points: adding a new script never silently opts out.
const REVIEW_TOOLING = new Set([
    'agentDeliveryScripts',
    'acceptReview',
    'claimTrackerIssue',
    'confirmReviewRepairs',
    'deliverPullRequest',
    'fileTrackerIssue',
    'prepareReview',
    'prepareReviewEntry',
    'publishLane',
    'publishReview',
    'reconcileTrackerIssue',
    'recoverDeliveryLock',
    'recoverPublishReviewLock',
    'repairReviewFinding',
    'reviewApprovalFormat',
    'reviewDocumentParser',
    'reviewDossier',
    'reviewDossierBindings',
    'reviewerModelDiversity',
    'reviewRoundEscalation',
    'reviewRiskPolicy',
    'reviewShadowStatus',
    'savedProjectStatePaths',
    'semanticReview',
    'semanticReviewContext',
    'reviewDiffSummary',
    'reviewCommentDiffPreflight',
    'reviewBundleLocator',
    'reviewApprovalContext',
    'deliveryRemoteInspection',
    'deliveryLockLegacyIncidents',
    'pullRequestReviewState',
    'pullRequestMutationLock',
    'pruneLane',
    'removeLane',
    'stackedLanes',
    'stampLaneIdentity',
    'supersedePullRequest',
    'supersedePullRequestGh',
    'syncParentLane',
    'trustedGithubWriteBootstrap',
    'trackerIssueReconciliation',
]);

const SEMANTIC_REVIEW_TOOLING = new Set([
    '__tests__/admissionScheduling.spec.ts',
    '__tests__/egressVendorShapeExtraction.spec.ts',
    '__tests__/multiPassTransport.spec.ts',
    '__tests__/semanticReview.spec.ts',
    'admissionBytes.ts',
    'candidateFindings.ts',
    'contractCarrying.ts',
    'contracts.ts',
    'egressVendorShapeExtraction.ts',
    'egressVendorShapes.ts',
    'egressVendorToml.ts',
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
    if (path.startsWith('scripts/semanticReview/')) {
        return SEMANTIC_REVIEW_TOOLING.has(path.slice('scripts/semanticReview/'.length));
    }
    const match = /^scripts\/(?:__tests__\/)?([A-Za-z]+)(?:\.spec)?\.ts$/.exec(path);
    const scriptName = match?.[1];
    return scriptName !== undefined && REVIEW_TOOLING.has(scriptName);
}

function isSpec(path: string): boolean {
    return path.startsWith('tests/e2e/') && /\.spec\.tsx?$/.test(path) && !path.includes('/__tests__/');
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

export function selectValidationPlan(paths: readonly string[], availableSpecs: readonly string[]): ValidationPlan {
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
        if (isReviewTooling(path)) {
            tooling = true;
            reasons.push({ path, reason: 'known review tooling; security/static checks without browser execution' });
            continue;
        }
        browser = true;
        if (isSpec(path) && available.has(path)) {
            selected.add(path);
            // Hardware policy is shared by these browser proofs; keep both host branches.
            if (path.startsWith('tests/e2e/browserAi')) {
                browserAi = true;
            }
            reasons.push({ path, reason: 'changed browser spec' });
        } else {
            broad = true;
            browserAi = true;
            reasons.push({
                path,
                reason: 'product, shared, deleted, renamed, or unclassified dependency; full browser coverage',
            });
        }
    }
    if (browser && !available.has(SMOKE_SPEC)) {
        throw new Error(`Required smoke spec is missing: ${SMOKE_SPEC}`);
    }
    const specs = (broad ? inventory : [...selected].sort()).filter((path) => path !== SMOKE_SPEC);
    if (broad && specs.length === 0) {
        throw new Error('Full browser coverage has no specs');
    }
    const count = Math.min(12, Math.ceil(specs.length / 12));
    const matrix: BrowserMatrix = {
        include: Array.from({ length: count }, (_, index) => ({ id: index + 1, specs: [] })),
    };
    for (const [index, spec] of specs.entries()) {
        const group = matrix.include[index % count];
        if (group === undefined) {
            throw new Error('Invalid E2E partition');
        }
        group.specs.push(spec);
    }
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
        if (!isSpec(path) || path.split('/').includes('..') || !existsSync(resolve(root, path))) {
            throw new Error(`Selected E2E spec is invalid or missing: ${path}`);
        }
        // Playwright CLI arguments are regexes against absolute file paths, not literals.
        return `^${resolve(root, path).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    });
}

function listSpecs(root: string): string[] {
    const specs: string[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true })) {
        if (typeof entry !== 'string') {
            continue;
        }
        const path = `tests/e2e/${entry}`;
        if (isSpec(path)) {
            specs.push(path);
        }
    }
    return specs;
}

function main(): void {
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
    const diff = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    const plan = selectValidationPlan(parseChangedPaths(diff), listSpecs(root));
    writeFileSync('pr-validation-scope.json', `${JSON.stringify(plan, null, 2)}\n`);
    appendFileSync(
        output,
        `profile=${plan.profile}\nbrowser=${plan.browser}\nbrowser-ai=${plan.browserAi}\ncodeql=${plan.codeql}\nmatrix=${JSON.stringify(plan.matrix)}\n`
    );
    console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
