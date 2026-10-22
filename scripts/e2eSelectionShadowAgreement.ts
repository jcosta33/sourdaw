import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { changedSourceOwners, knownFeatureOwners, selectsBrowserAi, specsForOwners } from './e2eAffectedGraph.ts';
import { git, PLANNER_SOURCES } from './e2eSelectionShadowIntegration.ts';
import { canNarrow, parseChangedPaths, productPathsOf, selectValidationPlan } from './prValidationScope.ts';

import type { SpecDurations } from './e2eShardPartition.ts';
import type { ValidationPlan } from './prValidationScope.ts';

// The shadow is advisory. A condition it cannot measure honestly is a skip with a reason, never a
// failure: only a genuine disagreement with the authoritative scope fails it.
type ShadowSkipCode =
    | 'integration-selector-differs'
    | 'integration-duration-planner-differs'
    | 'integration-execution-policy-differs'
    | 'integration-selector-differs-from-control';

export class ShadowSkipError extends Error {
    readonly code: ShadowSkipCode;

    constructor(code: ShadowSkipCode, message: string) {
        super(message);
        this.name = 'ShadowSkipError';
        this.code = code;
    }
}

function skippedShadowReport(
    error: ShadowSkipError,
    ids: { base: string | null; head: string | null; integrationSha: string | null }
) {
    return {
        schemaVersion: 1 as const,
        shadowOnly: true as const,
        measurementStatus: 'skipped' as const,
        skipReason: error.code,
        skipDetail: error.message,
        base: ids.base,
        head: ids.head,
        integrationSha: ids.integrationSha,
        controlSha: ids.base,
    };
}

const AFFECTED_GRAPH_DIAGNOSTIC_PATH = 'affected graph';
const NARROW_REASON_PREFIX = 'affected feature owners: ';

// The scope job runs on the merge ref and adds everything main landed since the event's base.sha to
// the candidate diff; the pull_request event never advances that snapshot, so the shadow applies
// the same union from the immutable integration checkout.
export function integrationDeltaDiff(integrationRoot: string, base: string, integrationSha: string): string {
    return git(['diff', '--name-status', '-z', '--find-renames', base, integrationSha, '--'], integrationRoot).toString(
        'utf8'
    );
}

export function unionChangedPaths(candidateDiff: string, integrationDiff: string | undefined): string[] {
    const paths = new Set(parseChangedPaths(candidateDiff));
    if (integrationDiff) {
        for (const path of parseChangedPaths(integrationDiff)) {
            paths.add(path);
        }
    }
    return [...paths].sort();
}

type PlanAgreement = { agrees: true; liveSpecs: string[]; notes: string[] } | { agrees: false; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function planSpecs(plan: ValidationPlan): string[] {
    return plan.matrix.include.flatMap((group) => group.specs);
}

function isPlanShape(value: unknown): value is ValidationPlan {
    return (
        isRecord(value) &&
        Array.isArray(value.reasons) &&
        value.reasons.every((row) => isRecord(row) && typeof row.path === 'string' && typeof row.reason === 'string') &&
        isRecord(value.matrix) &&
        Array.isArray(value.matrix.include) &&
        value.matrix.include.every(
            (group) =>
                isRecord(group) && Array.isArray(group.specs) && group.specs.every((spec) => typeof spec === 'string')
        )
    );
}

function withoutAffectedGraphDiagnostic(live: ValidationPlan): { plan: ValidationPlan; notes: string[] } | null {
    const last = live.reasons.at(-1);
    if (last?.path !== AFFECTED_GRAPH_DIAGNOSTIC_PATH) {
        return { plan: live, notes: [] };
    }
    const rest = live.reasons.slice(0, -1);
    if (rest.some((row) => row.path === AFFECTED_GRAPH_DIAGNOSTIC_PATH)) {
        return null;
    }
    return { plan: { ...live, reasons: rest }, notes: [`affected-graph-diagnostic: ${last.reason}`] };
}

function isNarrowedRow(row: ValidationPlan['reasons'][number]): boolean {
    return row.reason.startsWith(NARROW_REASON_PREFIX);
}

// What the planner saw: the changed paths, the integration inventory, the duration table, both status
// diffs, and the owner manifest the affected-graph helper reads.
export type PlanContext = {
    paths: readonly string[];
    inventory: readonly string[];
    durations: SpecDurations;
    candidateDiff: string;
    integrationDiff: string;
    readOwnersManifest: () => string;
};

function claimedOwners(live: ValidationPlan): string[] | null {
    const reasons = new Set(live.reasons.filter(isNarrowedRow).map((row) => row.reason));
    const [reason] = [...reasons];
    if (reasons.size !== 1 || reason === undefined) {
        return null;
    }
    const owners = reason.slice(NARROW_REASON_PREFIX.length).split(', ');
    const sorted = [...new Set(owners)].sort();
    return owners.length === sorted.length && owners.every((owner, index) => owner === sorted[index]) ? owners : null;
}

// The graph helper is not installed here, so which owners a change reaches through consumers cannot be
// derived. Everything else is: the claimed owners must be registered and include every changed source's
// own owner, and the plan the control planner builds for them must equal the authoritative plan exactly.
function rebuiltNarrowedPlan(live: ValidationPlan, context: PlanContext): ValidationPlan | string {
    const productPaths = productPathsOf(context.paths, context.inventory, false);
    if (!canNarrow({ productPaths, candidateDiff: context.candidateDiff, integrationDiff: context.integrationDiff })) {
        return 'the planner does not narrow this change';
    }
    const owners = claimedOwners(live);
    if (!owners) {
        return 'narrowed owners are not one sorted, unique list';
    }
    const manifest: unknown = JSON.parse(context.readOwnersManifest());
    const known = knownFeatureOwners(manifest, context.inventory);
    if (!owners.every((owner) => known.has(owner))) {
        return 'narrowed owners include an unregistered owner';
    }
    const changedOwners = changedSourceOwners(productPaths, known);
    if (!changedOwners || !changedOwners.every((owner) => owners.includes(owner))) {
        return 'narrowed owners omit the owner of a changed source';
    }
    const specs = specsForOwners(new Set(owners), context.inventory, manifest);
    return selectValidationPlan(context.paths, context.inventory, context.durations, false, {
        kind: 'narrow',
        owners,
        specs,
        browserAi: selectsBrowserAi(specs),
    });
}

function narrowedAgreement(expected: ValidationPlan, live: ValidationPlan, context: PlanContext): PlanAgreement {
    let rebuilt: ValidationPlan | string;
    try {
        rebuilt = rebuiltNarrowedPlan(live, context);
    } catch (error) {
        return {
            agrees: false,
            detail: `narrowed authoritative plan cannot be rebuilt: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (typeof rebuilt === 'string') {
        return { agrees: false, detail: `narrowed authoritative plan is not planner-reachable: ${rebuilt}` };
    }
    if (!isDeepStrictEqual(rebuilt, live)) {
        return { agrees: false, detail: 'narrowed authoritative plan differs from the planner rebuilt for its owners' };
    }
    const owners = claimedOwners(live)?.join(', ') ?? '';
    return {
        agrees: true,
        liveSpecs: planSpecs(live).sort(),
        notes: [
            `affected-graph-owners-unverified: ${owners}; ${planSpecs(live).length} of ${planSpecs(expected).length} specs`,
        ],
    };
}

// Authority: the scope artifact. The shadow reproduces its inputs and requires the live plan to equal the
// planner's own output for them. The optional affected-graph helper is not installed here, so two of its
// outputs are admitted only in the form the planner can emit:
//  - the full-fallback diagnostic row, stripped only when the planner could have tried the helper, and
//  - a narrowed selection, rebuilt through the planner from its claimed owners.
export function comparePlans(expected: ValidationPlan, live: unknown, context: PlanContext): PlanAgreement {
    if (!isPlanShape(live)) {
        return { agrees: false, detail: 'authoritative plan is malformed' };
    }
    if (live.reasons.some(isNarrowedRow)) {
        return narrowedAgreement(expected, live, context);
    }
    const productPaths = productPathsOf(context.paths, context.inventory, false);
    const mayHaveTriedHelper = canNarrow({
        productPaths,
        candidateDiff: context.candidateDiff,
        integrationDiff: context.integrationDiff,
    });
    const stripped = mayHaveTriedHelper ? withoutAffectedGraphDiagnostic(live) : { plan: live, notes: [] as string[] };
    if (!stripped) {
        return { agrees: false, detail: 'authoritative plan repeats the affected-graph diagnostic' };
    }
    if (isDeepStrictEqual(expected, stripped.plan)) {
        return { agrees: true, liveSpecs: planSpecs(expected).sort(), notes: stripped.notes };
    }
    return { agrees: false, detail: 'authoritative plan differs from the recomputed plan' };
}

// The recomputation every caller performs: the control planner over the union of changed paths.
export function compareAuthoritativePlan(
    input: { rawDiff: Buffer; integrationDiff?: string; readOwnersManifest: () => string; livePlan: unknown },
    planned: { paths: readonly string[]; inventory: readonly string[]; durations: SpecDurations }
): PlanAgreement {
    const { paths, inventory, durations } = planned;
    return comparePlans(selectValidationPlan(paths, inventory, durations), input.livePlan, {
        ...planned,
        candidateDiff: input.rawDiff.toString('utf8'),
        integrationDiff: input.integrationDiff ?? '',
        readOwnersManifest: input.readOwnersManifest,
    });
}

export function skipWhenIntegrationSourcesDiffer(
    input: {
        sourceHashes: Readonly<Record<string, string>>;
        integrationSourceHashes: Readonly<Record<string, string>>;
    },
    code: 'integration-selector-differs' | 'integration-execution-policy-differs',
    label: string,
    paths: readonly string[]
): void {
    for (const path of paths) {
        if (input.integrationSourceHashes[path] !== input.sourceHashes[path] || !input.sourceHashes[path]) {
            throw new ShadowSkipError(code, `${label} differs from candidate head: ${path}`);
        }
    }
}

// A head or base that predates a main-side planner change cannot reproduce the authoritative plan,
// but a missing or nonregular head source is a real integrity failure, which parseBoundDurations keeps.
export function skipWhenIntegrationDurationPlannerDiffers(input: {
    sourceModes: Readonly<Record<string, string>>;
    sourceHashes: Readonly<Record<string, string>>;
    integrationSourceHashes: Readonly<Record<string, string>>;
}): void {
    for (const path of PLANNER_SOURCES) {
        const headIsBound =
            input.sourceModes[path] === '100644' && /^[0-9a-f]{64}$/.test(input.sourceHashes[path] ?? '');
        if (headIsBound && input.integrationSourceHashes[path] !== input.sourceHashes[path]) {
            throw new ShadowSkipError(
                'integration-duration-planner-differs',
                `Integration duration planner is missing, nonregular, or differs from candidate head: ${path}`
            );
        }
    }
}

export function reportShadowError(error: unknown): void {
    const ids = {
        base: process.env.BASE_SHA ?? null,
        head: process.env.HEAD_SHA ?? null,
        integrationSha: process.env.INTEGRATION_SHA ?? null,
    };
    if (error instanceof ShadowSkipError) {
        writeFileSync('e2e-selection-shadow.json', `${JSON.stringify(skippedShadowReport(error, ids), null, 2)}\n`);
        console.log(`E2E shadow measurement skipped (${error.code}): ${error.message}`);
        return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    writeFileSync(
        'e2e-selection-shadow.json',
        `${JSON.stringify(
            {
                schemaVersion: 1,
                shadowOnly: true,
                measurementStatus: 'failed',
                ...ids,
                controlSha: ids.base,
                failureReason: reason,
            },
            null,
            2
        )}\n`
    );
    console.error(`E2E shadow measurement failed: ${reason}`);
    process.exitCode = 1;
}
