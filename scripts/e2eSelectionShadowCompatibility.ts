import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { parseDocument } from 'yaml';

import {
    compareAuthoritativePlan,
    integrationDeltaDiff,
    ShadowSkipError,
    unionChangedPaths,
} from './e2eSelectionShadowAgreement.ts';
import {
    git,
    hashInventoryFile,
    listIntegrationInventory,
    readHeadSourceBindings,
    treeEntry,
} from './e2eSelectionShadowIntegration.ts';
import { parseSpecDurations } from './e2eShardPartition.ts';
import { SMOKE_SPEC } from './prValidationScope.ts';

export function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

export function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function healthPolicyDigest(workflowSource: string): string {
    const document = parseDocument(workflowSource);
    if (document.errors.length > 0) {
        throw new Error('Invalid health workflow YAML');
    }
    const workflow: unknown = document.toJS();
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        throw new Error('Invalid health workflow');
    }
    const { jobs, ...top } = workflow;
    if (!isRecord(jobs)) {
        throw new Error('Invalid health workflow jobs');
    }
    const required = Object.fromEntries(
        ['scope', 'validation', 'affected', 'codeql', 'gate'].map((name) => [name, jobs[name]])
    );
    if (Object.values(required).some((job) => job === undefined)) {
        throw new Error('Missing required health job');
    }
    return sha256(canonical({ ...top, jobs: required }));
}

const SHADOW_CAPABILITY_PATHS = [
    'scripts/e2eSelectionShadow.ts',
    'scripts/e2eSelectionShadowCertificate.json',
    'scripts/e2eSelectionShadowIntegration.ts',
] as const;
const CONTROL_SOURCE_PATHS = [
    'scripts/e2eSelectionShadow.ts',
    'scripts/e2eSelectionShadowAgreement.ts',
    'scripts/e2eSelectionShadowCompatibility.ts',
    'scripts/e2eSelectionShadowIntegration.ts',
    'scripts/e2eSelectionShadowCertificate.json',
    'scripts/e2eAffectedGraph.ts',
    'scripts/e2eShardPartition.ts',
    'scripts/e2eSpecDurations.json',
    'scripts/prValidationScope.ts',
    'scripts/vitestCollectionPatterns.ts',
] as const;

export function candidateShadowCapability(
    root: string,
    head: string,
    controlRoot: string,
    base: string,
    entryPath: string
): 'supported' | 'unsupported' {
    if (realpathSync(entryPath) !== realpathSync(resolve(controlRoot, 'scripts/e2eSelectionShadow.ts'))) {
        throw new Error('Executing shadow source differs from the control checkout');
    }
    readHeadSourceBindings(controlRoot, base, CONTROL_SOURCE_PATHS, CONTROL_SOURCE_PATHS);
    const entries = SHADOW_CAPABILITY_PATHS.map((path) => ({ path, entry: treeEntry(head, path, root) }));
    if (entries.every(({ entry }) => entry === null)) {
        const history = git(
            ['log', '--full-history', '-1', '--format=%H', head, '--', ...SHADOW_CAPABILITY_PATHS],
            root
        )
            .toString('utf8')
            .trim();
        if (history === '') {
            return 'unsupported';
        }
    }
    for (const { path, entry } of entries) {
        if (entry?.mode !== '100644') {
            throw new Error(`Declared shadow capability is missing or nonregular: ${path}`);
        }
        const source = git(['show', `${head}:${path}`], root);
        if (hashInventoryFile(resolve(root, path)) !== sha256(source)) {
            throw new Error(`Shadow capability in checkout disagrees with immutable head: ${path}`);
        }
        if (path.endsWith('.json')) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(source.toString('utf8'));
            } catch {
                throw new Error('Declared shadow certificate is malformed');
            }
            if (
                !isRecord(parsed) ||
                typeof parsed.candidatePath !== 'string' ||
                !Array.isArray(parsed.rows) ||
                !isRecord(parsed.sourceHashes)
            ) {
                throw new Error('Declared shadow certificate is malformed');
            }
        } else {
            const sourceText = source.toString('utf8');
            const diagnostics =
                ts.transpileModule(sourceText, {
                    fileName: path,
                    reportDiagnostics: true,
                    compilerOptions: { target: ts.ScriptTarget.Latest },
                }).diagnostics ?? [];
            if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
                throw new Error(`Declared shadow capability is malformed: ${path}`);
            }
            if (ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest).statements.length === 0) {
                throw new Error(`Declared shadow capability is code-free: ${path}`);
            }
        }
    }
    return 'supported';
}

export function integrationOwnersManifest(integrationRoot: string, integrationSha: string): string {
    return git(['show', `${integrationSha}:scripts/e2eSuiteOwners.json`], integrationRoot).toString('utf8');
}

const PLANNER_CONTROL_PATHS = [
    'scripts/e2eAffectedGraph.ts',
    'playwright.config.ts',
    'scripts/prValidationScope.ts',
    'scripts/vitestCollectionPatterns.ts',
    'scripts/e2eShardPartition.ts',
    'scripts/e2eSpecDurations.json',
] as const;

// The executing control recomputes the plan with its own selector, collector, and partition. A missing,
// nonregular, or dirty source is an integrity failure; only valid sources whose bytes differ from the
// integration's are an explained skip, since the control cannot reproduce the authoritative plan.
export function skipWhenIntegrationPlannerDiffersFromControl(input: {
    controlRoot: string;
    integrationRoot: string;
    base: string;
    integrationSha: string;
}): void {
    const { controlRoot, integrationRoot, base, integrationSha } = input;
    for (const path of PLANNER_CONTROL_PATHS) {
        const integrationEntry = treeEntry(integrationSha, path, integrationRoot);
        const controlEntry = treeEntry(base, path, controlRoot);
        if (integrationEntry?.mode !== '100644') {
            throw new Error(`Integration selector or planner is missing or nonregular: ${path}`);
        }
        if (controlEntry?.mode !== '100644') {
            throw new Error(`Control selector or planner is missing or nonregular: ${path}`);
        }
        const controlBytes = git(['show', `${base}:${path}`], controlRoot);
        if (hashInventoryFile(resolve(controlRoot, path)) !== sha256(controlBytes)) {
            throw new Error(`Control checkout differs from its immutable base: ${path}`);
        }
        if (!git(['show', `${integrationSha}:${path}`], integrationRoot).equals(controlBytes)) {
            throw new ShadowSkipError(
                'integration-selector-differs-from-control',
                `Integration selector or planner differs from control: ${path}`
            );
        }
    }
}

export function unsupportedShadowReport(input: {
    root: string;
    integrationRoot: string;
    scopePath: string;
    base: string;
    head: string;
    integrationSha: string;
}) {
    const { root, integrationRoot, scopePath, base, head, integrationSha } = input;
    const rawDiff = git(['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'], root);
    const integrationDiff = integrationDeltaDiff(integrationRoot, base, integrationSha);
    const changedPaths = unionChangedPaths(rawDiff.toString('utf8'), integrationDiff);
    const inventory = listIntegrationInventory(integrationRoot, integrationSha);
    const full = inventory.filter((row) => row.path !== SMOKE_SPEC).map((row) => row.path);
    if (full.length === 0) {
        throw new Error('Full browser inventory is empty');
    }
    skipWhenIntegrationPlannerDiffersFromControl({ controlRoot: root, integrationRoot, base, integrationSha });
    const durationText = git(['show', `${integrationSha}:scripts/e2eSpecDurations.json`], integrationRoot).toString(
        'utf8'
    );
    const scopeBytes = readFileSync(scopePath);
    const agreement = compareAuthoritativePlan(
        {
            rawDiff,
            integrationDiff,
            readOwnersManifest: () => integrationOwnersManifest(integrationRoot, integrationSha),
            livePlan: JSON.parse(scopeBytes.toString('utf8')),
        },
        {
            paths: changedPaths,
            inventory: inventory.map((row) => row.path),
            durations: parseSpecDurations(durationText),
        }
    );
    if (!agreement.agrees) {
        throw new Error(
            `Authoritative scope artifact disagrees with the control selector or inventory: ${agreement.detail}`
        );
    }
    const liveSelectedSpecs = agreement.liveSpecs;
    return {
        schemaVersion: 1 as const,
        shadowOnly: true as const,
        measurementStatus: 'unsupported' as const,
        unsupportedReason: 'candidate-shadow-capability-absent',
        base,
        head,
        integrationSha,
        controlSha: base,
        authoritativeScopeSha256: sha256(scopeBytes),
        authoritativeScopeSpecCount: liveSelectedSpecs.length,
        inventorySha256: sha256(canonical(inventory)),
        candidateSpecs: null,
        liveSelectedSpecs,
        excludedSpecs: 0,
        measuredReduction: 0,
        counts: { inventory: full.length, candidate: null, liveSelected: liveSelectedSpecs.length },
    };
}
