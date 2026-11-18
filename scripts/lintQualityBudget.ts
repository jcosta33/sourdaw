import { readFileSync } from 'node:fs';
import { matchesGlob, relative, resolve } from 'node:path';

export const QUALITY_CONFIG = '.oxlint-quality.json';
export const QUALITY_BUDGET = 'oxlint-quality-baseline.json';

export const qualityRuleIds = [
    'eslint/complexity',
    'eslint/max-depth',
    'eslint/max-lines-per-function',
    'eslint/max-params',
    'eslint/no-else-return',
    'sourdaw-craft/no-complex-ternary-branch',
    'sourdaw-craft/no-conditional-empty-spread',
    'sourdaw-craft/no-conditional-playwright-admission',
    'sourdaw-craft/no-control-flow-ternary',
    'sourdaw-craft/no-external-data-assertion',
    'sourdaw-craft/no-failed-operation-success',
    'sourdaw-craft/no-fixed-test-sleep',
    'sourdaw-craft/no-invalid-vitest-expect',
    'sourdaw-craft/no-json-parse-stringify',
    'sourdaw-craft/no-long-array-chain',
    'sourdaw-craft/no-positional-boolean-flags',
    'sourdaw-craft/no-silent-catch',
    'sourdaw-craft/no-spread-clone-array-method',
    'sourdaw-craft/no-useless-clone-spread',
    'typescript/no-non-null-assertion',
    'typescript/no-unnecessary-type-parameters',
    'typescript/no-unsafe-type-assertion',
    'typescript/switch-exhaustiveness-check',
    'vitest/expect-expect',
    'vitest/no-conditional-expect',
] as const;

const qualityRules: ReadonlySet<string> = new Set(qualityRuleIds);
type RuleCounts = Map<string, number>;
type Budget = Map<string, RuleCounts>;

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string, label: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
}

export function canonicalQualityRule(name: string): string {
    return name.includes('/') ? name : `eslint/${name}`;
}

export function parseConfiguredQualityRules(text: string, label: string) {
    const config = parseJson(text, label);
    if (
        !record(config) ||
        'extends' in config ||
        (config.overrides !== undefined && !Array.isArray(config.overrides))
    ) {
        throw new Error(`${label} must declare its rules directly in the quality configuration.`);
    }
    const present = new Set<string>();
    const errors = new Set<string>();
    const overrides: unknown[] = config.overrides ?? [];
    const layers = [config, ...overrides];
    for (const layer of layers) {
        if (!record(layer) || (layer.rules !== undefined && !record(layer.rules))) {
            throw new Error(`${label} must declare quality rules by name.`);
        }
        for (const [name, value] of Object.entries(layer.rules ?? {})) {
            const rule = canonicalQualityRule(name);
            const severity: unknown = Array.isArray(value) ? value[0] : value;
            present.add(rule);
            if (severity === 'error' || severity === 'deny' || severity === 2) {
                errors.add(rule);
            }
        }
    }
    return { present, errors };
}

export function parseQualityBudget(text: string, label: string = QUALITY_BUDGET): Budget {
    const value = parseJson(text, label);
    if (!record(value)) {
        throw new Error(`${label} must contain counts by repository-relative path and rule`);
    }
    const budget: Budget = new Map();
    for (const [file, rules] of Object.entries(value)) {
        if (file.includes('\\') || /(^|\/)\.{0,2}(\/|$)/.test(file) || /^[A-Za-z]:/.test(file)) {
            throw new Error(`${label} contains a non-canonical path: ${file}`);
        }
        if (!record(rules) || Object.keys(rules).length === 0) {
            throw new Error(`${label} contains a path with no rule counts: ${file}`);
        }
        const counts: RuleCounts = new Map();
        for (const [rule, entry] of Object.entries(rules)) {
            const count = record(entry) ? entry.count : undefined;
            if (
                !qualityRules.has(rule) ||
                !record(entry) ||
                Object.keys(entry).length !== 1 ||
                typeof count !== 'number' ||
                !Number.isSafeInteger(count) ||
                count <= 0
            ) {
                throw new Error(`${label} contains an invalid count for ${file} (${rule})`);
            }
            counts.set(rule, count);
        }
        budget.set(file, counts);
    }
    return budget;
}

export function readQualityBudget(root: string): Budget {
    return parseQualityBudget(readFileSync(resolve(root, QUALITY_BUDGET), 'utf8'));
}

type QualityDiagnostic = {
    file: string;
    rule: string | undefined;
    severity: string;
    message: string;
    line: number | undefined;
    column: number | undefined;
};

export type QualityReport = { fileCount: number; diagnostics: QualityDiagnostic[] };

function pathFrom(root: string, file: string): string {
    return relative(root, resolve(root, file)).split('\\').join('/');
}

export function parseQualityReport(text: string, root: string): QualityReport {
    const value = parseJson(text, 'Oxlint quality report');
    if (
        !record(value) ||
        typeof value.number_of_files !== 'number' ||
        !Number.isSafeInteger(value.number_of_files) ||
        value.number_of_files < 0 ||
        !Array.isArray(value.diagnostics)
    ) {
        throw new Error('Oxlint quality report is missing its file count or diagnostics');
    }
    const diagnostics = value.diagnostics.map((entry: unknown) => {
        if (
            !record(entry) ||
            typeof entry.message !== 'string' ||
            typeof entry.severity !== 'string' ||
            !['error', 'warning', 'advice'].includes(entry.severity)
        ) {
            throw new Error('Oxlint quality report contains an invalid diagnostic');
        }
        const rule = typeof entry.code === 'string' ? entry.code.replace(/\(([^)]+)\)$/, '/$1') : undefined;
        if (rule !== undefined && qualityRules.has(rule) && entry.severity !== 'error') {
            throw new Error(`Oxlint quality rule ${rule} reported unexpected severity ${entry.severity}`);
        }
        const filename = typeof entry.filename === 'string' ? entry.filename : '';
        const label: unknown = Array.isArray(entry.labels) ? entry.labels[0] : undefined;
        const span = record(label) && record(label.span) ? label.span : undefined;
        return {
            file: filename === '' ? '' : pathFrom(root, filename),
            rule,
            severity: entry.severity,
            message: entry.message,
            line: typeof span?.line === 'number' ? span.line : undefined,
            column: typeof span?.column === 'number' ? span.column : undefined,
        };
    });
    return { fileCount: value.number_of_files, diagnostics };
}

function managedRule(diagnostic: QualityDiagnostic): string | undefined {
    const { file, rule, severity } = diagnostic;
    if (file !== '' && rule !== undefined && severity === 'error' && qualityRules.has(rule)) {
        return rule;
    }
    return undefined;
}

function countDiagnostics(diagnostics: readonly QualityDiagnostic[]): Budget {
    const observed: Budget = new Map();
    for (const diagnostic of diagnostics) {
        const rule = managedRule(diagnostic);
        if (rule === undefined) {
            continue;
        }
        const counts = observed.get(diagnostic.file) ?? new Map();
        counts.set(rule, (counts.get(rule) ?? 0) + 1);
        observed.set(diagnostic.file, counts);
    }
    return observed;
}

function diagnosticLocation(diagnostic: QualityDiagnostic): string {
    if (!diagnostic.file) {
        return '';
    }
    const position = diagnostic.line === undefined ? '' : `:${diagnostic.line}:${diagnostic.column ?? 1}`;
    return `${diagnostic.file}${position}: `;
}

export function reconcileQualityBudget(
    report: QualityReport,
    budget: Budget,
    selectedPaths: readonly string[] | undefined,
    root: string
): { diagnostics: string[]; failed: boolean; hadErrors: boolean } {
    const observed = countDiagnostics(report.diagnostics);
    const targets = selectedPaths?.map((path) => pathFrom(root, path));
    const diagnostics: string[] = [];
    let hadErrors = false;
    let failed = false;
    for (const diagnostic of report.diagnostics) {
        hadErrors ||= diagnostic.severity === 'error';
        const rule = managedRule(diagnostic);
        if (rule !== undefined) {
            const allowed = budget.get(diagnostic.file)?.get(rule) ?? 0;
            const count = observed.get(diagnostic.file)?.get(rule) ?? 0;
            if (count <= allowed) {
                continue;
            }
        }
        failed ||= diagnostic.severity === 'error';
        const tag = diagnostic.rule === undefined ? '' : ` (${diagnostic.rule})`;
        diagnostics.push(`${diagnosticLocation(diagnostic)}${diagnostic.severity}${tag}: ${diagnostic.message}`);
    }
    for (const [file, counts] of budget) {
        if (
            targets !== undefined &&
            !targets.some(
                (target) =>
                    target === '' || file === target || file.startsWith(`${target}/`) || matchesGlob(file, target)
            )
        ) {
            continue;
        }
        for (const [rule, allowed] of counts) {
            const actual = observed.get(file)?.get(rule) ?? 0;
            if (actual < allowed) {
                failed = true;
                diagnostics.push(
                    `${file}: stale ${rule} budget in ${QUALITY_BUDGET} (${allowed} recorded, ${actual} observed). Shrink or remove the count.`
                );
            }
        }
    }
    return { diagnostics, failed, hadErrors };
}

export function findQualityBudgetGrowth(
    base: Budget,
    head: Budget,
    seed?: { rules: ReadonlySet<string>; files: ReadonlySet<string> }
): string[] {
    const findings: string[] = [];
    for (const [file, counts] of head) {
        for (const [rule, count] of counts) {
            const allowed = base.get(file)?.get(rule) ?? 0;
            const canSeed = allowed === 0 && seed?.rules.has(rule) && seed.files.has(file);
            if (count > allowed && !canSeed) {
                findings.push(`${file}: ${rule} budget increased from ${allowed} to ${count} in ${QUALITY_BUDGET}.`);
            }
        }
    }
    return findings;
}
