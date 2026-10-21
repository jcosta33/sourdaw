import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { git, PLANNER_SOURCES } from './e2eSelectionShadowIntegration.ts';
import { parseChangedPaths } from './prValidationScope.ts';

import type { ValidationPlan } from './prValidationScope.ts';

// The shadow is advisory. A condition it cannot measure honestly is a skip with a reason, never a
// failure: only a genuine disagreement with the authoritative scope fails it.
type ShadowSkipCode =
    | 'integration-selector-differs'
    | 'integration-duration-planner-differs'
    | 'integration-execution-policy-differs'
    | 'integration-selector-differs-from-control'
    | 'affected-graph-narrowing-unverified';

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

const FULL_COVERAGE_REASON_SUFFIX = 'full browser coverage';

function isNarrowedRow(row: ValidationPlan['reasons'][number]): boolean {
    return row.reason.startsWith(NARROW_REASON_PREFIX);
}

function narrowedOwners(live: ValidationPlan): string[] {
    const owners = new Set<string>();
    for (const row of live.reasons.filter(isNarrowedRow)) {
        for (const owner of row.reason.slice(NARROW_REASON_PREFIX.length).split(', ')) {
            owners.add(owner);
        }
    }
    return [...owners].sort();
}

// The affected-graph helper picks the owners and specs of a narrowed selection, and this job does not
// install it, so those fields cannot be checked. Everything else about a narrowed plan is a function
// of the changed paths and the inventory, and must equal the recomputation: the scalar fields, the
// path order, every row that is not an owners row, and that every full-coverage row is an owners row
// on a src/modules path (any other full-coverage row would have forced the planner to the full suite).
function narrowedPlanIsBounded(
    expected: ValidationPlan,
    live: ValidationPlan,
    inventory: ReadonlySet<string>,
    diagnosticWasStripped: boolean
): boolean {
    const specs = planSpecs(live);
    return (
        !diagnosticWasStripped &&
        live.version === expected.version &&
        live.profile === expected.profile &&
        live.browser === expected.browser &&
        live.codeql === expected.codeql &&
        specs.length > 0 &&
        specs.every((spec) => inventory.has(spec)) &&
        live.reasons.length === expected.reasons.length &&
        live.reasons.every((row, index) => {
            const counterpart = expected.reasons[index];
            if (counterpart?.path !== row.path) {
                return false;
            }
            const fullCoverage = counterpart.reason.endsWith(FULL_COVERAGE_REASON_SUFFIX);
            if (!isNarrowedRow(row)) {
                return row.reason === counterpart.reason && !fullCoverage;
            }
            return row.path.startsWith('src/modules/') && fullCoverage;
        })
    );
}

// Authority: the scope artifact. The shadow reproduces its inputs and requires the live plan to equal
// the recomputed one, admitting only the output of the optional affected-graph helper it does not run:
//  - the diagnostic row the planner appends after a full-coverage fallback, which is stripped, and
//  - a narrowed selection, whose bounded form is skipped with a reason and any other form is a disagreement.
export function comparePlans(expected: ValidationPlan, live: unknown, inventory: readonly string[]): PlanAgreement {
    if (!isPlanShape(live)) {
        return { agrees: false, detail: 'authoritative plan is malformed' };
    }
    const stripped = withoutAffectedGraphDiagnostic(live);
    if (!stripped) {
        return { agrees: false, detail: 'authoritative plan repeats the affected-graph diagnostic' };
    }
    const owners = narrowedOwners(stripped.plan);
    if (owners.length > 0) {
        if (!narrowedPlanIsBounded(expected, stripped.plan, new Set(inventory), stripped.notes.length > 0)) {
            return {
                agrees: false,
                detail: 'narrowed authoritative plan differs beyond its unverified owners and specs',
            };
        }
        throw new ShadowSkipError(
            'affected-graph-narrowing-unverified',
            `Authoritative scope narrowed the selection to feature owners (${owners.join(', ')}); the shadow does not run the affected-graph helper and cannot verify it`
        );
    }
    if (isDeepStrictEqual(expected, stripped.plan)) {
        return { agrees: true, liveSpecs: planSpecs(expected).sort(), notes: stripped.notes };
    }
    return { agrees: false, detail: 'authoritative plan differs from the recomputed plan' };
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
