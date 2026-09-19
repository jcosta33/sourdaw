/**
 * Risk policy half of the versioned review-dossier contract (#2999, spec #2995 AC-011).
 *
 * `planReviewRisk` derives, from a change's changed paths alone, which review stances that change
 * proportionally requires. `parseReviewRiskPlan` re-validates the `risk-plan.json` that
 * `review:prepare` writes, recomputing the stance union from `riskClasses` so a hand-edited plan can
 * neither widen nor narrow its own review.
 */

import { fail } from './prContract.ts';

import type { ReviewChangedPath } from './reviewDiffSummary.ts';

export const REVIEW_RISK_PLAN_FORMAT = 'risk-plan-v1';
export const REVIEW_SMALL_CHANGE_LINE_BUDGET = 200;

const REVIEW_RISK_CLASSES = [
    'small',
    'ordinary',
    'test-only',
    'cross-domain',
    'realtime-audio',
    'native-security',
    'undo',
] as const;

export type ReviewRiskClass = (typeof REVIEW_RISK_CLASSES)[number];

const REVIEW_STANCE_IDS = [
    'correctness',
    'module-boundaries',
    'realtime-audio',
    'project-integrity-undo',
    'security-platform',
    'code-craft',
    'test-validity',
] as const;

export type ReviewStanceId = (typeof REVIEW_STANCE_IDS)[number];

export type ReviewRiskPlan = {
    format: typeof REVIEW_RISK_PLAN_FORMAT;
    pr: number;
    headSha: string;
    baseSha: string;
    riskClasses: ReviewRiskClass[];
    requiredStances: ReviewStanceId[];
    triggers: string[];
};

/**
 * The stances each class earns. `code-craft` is earned by exactly one class, `ordinary`; no class
 * contributes a stance outside its own entry, which is the omission rule AC-011 tests.
 */
const REQUIRED_STANCES: Record<ReviewRiskClass, readonly ReviewStanceId[]> = {
    small: ['correctness', 'test-validity'],
    'test-only': ['test-validity'],
    ordinary: ['correctness', 'code-craft', 'module-boundaries', 'test-validity'],
    'cross-domain': ['correctness', 'module-boundaries', 'test-validity'],
    'realtime-audio': ['correctness', 'realtime-audio', 'test-validity'],
    'native-security': ['correctness', 'security-platform', 'test-validity'],
    undo: ['correctness', 'project-integrity-undo', 'test-validity'],
};

const REALTIME_AUDIO_PREFIXES = ['crates/daw-dsp/', 'src/modules/AudioEngine/', 'public/wasm/'] as const;
const NATIVE_SECURITY_PREFIXES = ['electron/', 'crates/', '.github/workflows/'] as const;
const NATIVE_SECURITY_PATHS = ['src/utils/desktopBridge.ts', 'scripts/githubAppIdentity.ts'] as const;
const CROSS_CUTTING_PREFIXES = ['src/app/', 'src/infra/', 'src/helpers/', 'src/utils/'] as const;
const MODULES_PREFIX = 'src/modules/';

const REVIEW_RISK_CLASS_SET: ReadonlySet<string> = new Set(REVIEW_RISK_CLASSES);
const REVIEW_STANCE_ID_SET: ReadonlySet<string> = new Set(REVIEW_STANCE_IDS);

type RiskFinding = { riskClass: ReviewRiskClass; triggers: string[] };

function isReviewRiskClass(value: string): value is ReviewRiskClass {
    return REVIEW_RISK_CLASS_SET.has(value);
}

function isReviewStanceId(value: string): value is ReviewStanceId {
    return REVIEW_STANCE_ID_SET.has(value);
}

function earnedStances(riskClasses: readonly ReviewRiskClass[]): ReviewStanceId[] {
    const stances = new Set<ReviewStanceId>();
    for (const riskClass of riskClasses) {
        for (const stance of REQUIRED_STANCES[riskClass]) {
            stances.add(stance);
        }
    }
    return [...stances].sort();
}

function prefixTriggers(rule: string, prefixes: readonly string[], paths: readonly ReviewChangedPath[]): string[] {
    return prefixes
        .filter((prefix) => paths.some((entry) => entry.path.startsWith(prefix)))
        .map((prefix) => `${rule}:${prefix}`);
}

function exactTriggers(rule: string, exactPaths: readonly string[], paths: readonly ReviewChangedPath[]): string[] {
    return exactPaths.filter((exact) => paths.some((entry) => entry.path === exact)).map((exact) => `${rule}:${exact}`);
}

function realtimeAudioFindings(paths: readonly ReviewChangedPath[]): RiskFinding[] {
    const triggers = prefixTriggers('realtime-audio', REALTIME_AUDIO_PREFIXES, paths);
    return triggers.length === 0 ? [] : [{ riskClass: 'realtime-audio', triggers }];
}

function nativeSecurityFindings(paths: readonly ReviewChangedPath[]): RiskFinding[] {
    const triggers = [
        ...prefixTriggers('native-security', NATIVE_SECURITY_PREFIXES, paths),
        ...exactTriggers('native-security', NATIVE_SECURITY_PATHS, paths),
    ];
    return triggers.length === 0 ? [] : [{ riskClass: 'native-security', triggers }];
}

function isUndoPath(path: string): boolean {
    const lower = path.toLowerCase();
    return (
        lower.includes('undo') ||
        lower.includes('crdtdocument') ||
        lower.endsWith('.sdaw') ||
        (lower.startsWith('src/app/') && lower.includes('bootstrap'))
    );
}

function undoFindings(paths: readonly ReviewChangedPath[]): RiskFinding[] {
    const triggers = paths.filter((entry) => isUndoPath(entry.path)).map((entry) => `undo:${entry.path}`);
    return triggers.length === 0 ? [] : [{ riskClass: 'undo', triggers }];
}

function moduleDomain(path: string): string | undefined {
    if (!path.startsWith(MODULES_PREFIX)) {
        return undefined;
    }
    const domain = path.slice(MODULES_PREFIX.length).split('/')[0];
    return domain === undefined || domain === '' ? undefined : domain;
}

function spansMultipleSurfaces(paths: readonly ReviewChangedPath[]): boolean {
    const domains = new Set<string>();
    let hasCrossCuttingPath = false;
    for (const entry of paths) {
        const domain = moduleDomain(entry.path);
        if (domain !== undefined) {
            domains.add(domain);
        }
        if (CROSS_CUTTING_PREFIXES.some((prefix) => entry.path.startsWith(prefix))) {
            hasCrossCuttingPath = true;
        }
    }
    return domains.size > 1 || (domains.size > 0 && hasCrossCuttingPath);
}

function crossDomainFindings(paths: readonly ReviewChangedPath[]): RiskFinding[] {
    if (!spansMultipleSurfaces(paths)) {
        return [];
    }
    return [{ riskClass: 'cross-domain', triggers: ['cross-domain:multiple-surfaces'] }];
}

function sizeFinding(paths: readonly ReviewChangedPath[]): RiskFinding {
    const lines = paths.reduce((total, entry) => total + entry.added + entry.deleted, 0);
    if (lines <= REVIEW_SMALL_CHANGE_LINE_BUDGET) {
        return { riskClass: 'small', triggers: [`small:handwritten-lines<=${REVIEW_SMALL_CHANGE_LINE_BUDGET}`] };
    }
    return { riskClass: 'ordinary', triggers: [`ordinary:handwritten-lines>${REVIEW_SMALL_CHANGE_LINE_BUDGET}`] };
}

function specialistFindings(paths: readonly ReviewChangedPath[]): RiskFinding[] {
    return [
        ...realtimeAudioFindings(paths),
        ...nativeSecurityFindings(paths),
        ...undoFindings(paths),
        ...crossDomainFindings(paths),
    ];
}

function decideFindings(paths: readonly ReviewChangedPath[]): RiskFinding[] {
    const handwritten = paths.filter((entry) => entry.group === 'handwritten');
    const findings = specialistFindings(handwritten);
    return findings.length === 0 ? [sizeFinding(handwritten)] : findings;
}

function testOnlyFindings(): RiskFinding[] {
    return [{ riskClass: 'test-only', triggers: ['test-only:all-paths-are-tests'] }];
}

function isTestOnly(paths: readonly ReviewChangedPath[]): boolean {
    return paths.length > 0 && paths.every((entry) => entry.group === 'tests');
}

export function planReviewRisk(input: {
    pr: number;
    headSha: string;
    baseSha: string;
    paths: readonly ReviewChangedPath[];
}): ReviewRiskPlan {
    const findings = isTestOnly(input.paths) ? testOnlyFindings() : decideFindings(input.paths);
    const riskClasses = findings.map((finding) => finding.riskClass).sort();
    return {
        format: REVIEW_RISK_PLAN_FORMAT,
        pr: input.pr,
        headSha: input.headSha,
        baseSha: input.baseSha,
        riskClasses,
        requiredStances: earnedStances(riskClasses),
        triggers: [...new Set(findings.flatMap((finding) => finding.triggers))].sort(),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEntries(record: Record<string, unknown>, field: string): readonly unknown[] {
    const value = record[field];
    if (!Array.isArray(value)) {
        fail(`review risk plan ${field} must be an array`);
    }
    if (value.length === 0) {
        fail(`review risk plan ${field} must not be empty`);
    }
    return value;
}

function assertSortedUnique(field: string, values: readonly string[]): void {
    let previous: string | undefined;
    for (const value of values) {
        if (value === previous) {
            fail(`review risk plan ${field} must not contain duplicates`);
        }
        if (previous !== undefined && value < previous) {
            fail(`review risk plan ${field} must be sorted`);
        }
        previous = value;
    }
}

function readStrings(record: Record<string, unknown>, field: string): string[] {
    const values: string[] = [];
    for (const entry of readEntries(record, field)) {
        if (typeof entry !== 'string' || entry.trim() === '') {
            fail(`review risk plan ${field} must contain only non-empty strings`);
        }
        values.push(entry);
    }
    assertSortedUnique(field, values);
    return values;
}

function readIdentity(record: Record<string, unknown>, field: string): string {
    const value = record[field];
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`review risk plan ${field} must be a non-empty string`);
    }
    return value;
}

function readRiskClasses(record: Record<string, unknown>): ReviewRiskClass[] {
    const riskClasses: ReviewRiskClass[] = [];
    for (const value of readStrings(record, 'riskClasses')) {
        if (!isReviewRiskClass(value)) {
            fail(`review risk plan riskClasses contains an unknown class: ${value}`);
        }
        riskClasses.push(value);
    }
    return riskClasses;
}

function readStanceIds(record: Record<string, unknown>): ReviewStanceId[] {
    const stances: ReviewStanceId[] = [];
    for (const value of readStrings(record, 'requiredStances')) {
        if (!isReviewStanceId(value)) {
            fail(`review risk plan requiredStances contains an unknown stance: ${value}`);
        }
        stances.push(value);
    }
    return stances;
}

export function parseReviewRiskPlan(value: unknown): ReviewRiskPlan {
    if (!isRecord(value)) {
        fail('review risk plan must be an object');
    }
    if (value.format !== REVIEW_RISK_PLAN_FORMAT) {
        fail(`review risk plan format must be ${REVIEW_RISK_PLAN_FORMAT}`);
    }
    const pr = value.pr;
    if (typeof pr !== 'number' || !Number.isSafeInteger(pr) || pr <= 0) {
        fail('review risk plan pr must be a positive integer');
    }
    const headSha = readIdentity(value, 'headSha');
    const baseSha = readIdentity(value, 'baseSha');
    const riskClasses = readRiskClasses(value);
    const requiredStances = readStanceIds(value);
    const earned = new Set(earnedStances(riskClasses));
    const provided = new Set(requiredStances);
    if (earned.size !== provided.size || [...provided].some((stance) => !earned.has(stance))) {
        fail('review risk plan requiredStances must equal the stances its riskClasses earn');
    }
    return {
        format: REVIEW_RISK_PLAN_FORMAT,
        pr,
        headSha,
        baseSha,
        riskClasses,
        requiredStances,
        triggers: readStrings(value, 'triggers'),
    };
}
