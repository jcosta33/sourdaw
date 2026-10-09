import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { parseDocument } from 'yaml';

import { git, hashInventoryFile, listIntegrationInventory, treeEntry } from './e2eSelectionShadowIntegration.ts';
import { parseSpecDurations } from './e2eShardPartition.ts';
import { parseChangedPaths, selectValidationPlan, SMOKE_SPEC } from './prValidationScope.ts';

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

export function candidateShadowCapability(root: string, head: string): 'supported' | 'unsupported' {
    const entries = SHADOW_CAPABILITY_PATHS.map((path) => ({ path, entry: treeEntry(head, path, root) }));
    if (entries.every(({ entry }) => entry === null)) {
        const history = git(['log', '-1', '--format=%H', head, '--', ...SHADOW_CAPABILITY_PATHS], root)
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
            const diagnostics =
                ts.transpileModule(source.toString('utf8'), {
                    fileName: path,
                    reportDiagnostics: true,
                    compilerOptions: { target: ts.ScriptTarget.Latest },
                }).diagnostics ?? [];
            if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
                throw new Error(`Declared shadow capability is malformed: ${path}`);
            }
        }
    }
    return 'supported';
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
    const changedPaths = parseChangedPaths(rawDiff.toString('utf8'));
    const inventory = listIntegrationInventory(integrationRoot, integrationSha);
    const full = inventory.filter((row) => row.path !== SMOKE_SPEC).map((row) => row.path);
    if (full.length === 0) {
        throw new Error('Full browser inventory is empty');
    }
    for (const path of [
        'scripts/prValidationScope.ts',
        'scripts/vitestCollectionPatterns.ts',
        'scripts/e2eShardPartition.ts',
        'scripts/e2eSpecDurations.json',
    ]) {
        const integrationEntry = treeEntry(integrationSha, path, integrationRoot);
        const controlEntry = treeEntry(base, path, root);
        const controlBytes = controlEntry?.mode === '100644' ? git(['show', `${base}:${path}`], root) : null;
        if (
            integrationEntry?.mode !== '100644' ||
            !controlBytes ||
            !git(['show', `${integrationSha}:${path}`], integrationRoot).equals(controlBytes) ||
            hashInventoryFile(resolve(root, path)) !== sha256(controlBytes)
        ) {
            throw new Error(`Integration selector or planner differs from control: ${path}`);
        }
    }
    const durationText = git(['show', `${integrationSha}:scripts/e2eSpecDurations.json`], integrationRoot).toString(
        'utf8'
    );
    const expectedPlan = selectValidationPlan(
        changedPaths,
        inventory.map((row) => row.path),
        parseSpecDurations(durationText)
    );
    const scopeBytes = readFileSync(scopePath);
    const livePlan: unknown = JSON.parse(scopeBytes.toString('utf8'));
    if (canonical(expectedPlan) !== canonical(livePlan)) {
        throw new Error('Authoritative scope artifact disagrees with the control selector or inventory');
    }
    const liveSelectedSpecs = expectedPlan.matrix.include.flatMap((group) => group.specs).sort();
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
