/**
 * Per-file line ceilings for the size-ceiling burn-down baseline (docs/07-conventions.md — Lint-aligned
 * conventions). eslint.config.mjs holds every file in eslint.size-baseline.mjs to `warn` instead of
 * `error`, so nothing in lint stops a baselined file from growing. scripts/lintSizeCeilings.json records
 * one line ceiling per baselined file; a file may not exceed it, and a ceiling left far above a file that
 * shrank must be lowered, so the recorded figures only move down.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The `max-lines` limit; no ceiling sits below it and a ceiling at it is never stale. */
export const SIZE_CEILING_FLOOR = 600;
/** How far a ceiling may sit above a file before it must be lowered. */
export const SIZE_CEILING_SLACK = 100;

export const SIZE_CEILINGS_PATH = 'scripts/lintSizeCeilings.json';

export type SizeCeilingViolation =
    | { kind: 'missing-ceiling'; path: string; lines: number }
    | { kind: 'unlisted-ceiling'; path: string }
    | { kind: 'over-ceiling'; path: string; lines: number; ceiling: number }
    | { kind: 'stale-ceiling'; path: string; lines: number; ceiling: number }
    | { kind: 'below-floor'; path: string; ceiling: number };

export type SizeCeilingInputs = {
    baselineFiles: readonly string[];
    ceilings: Readonly<Record<string, number>>;
    lineCount: (path: string) => number;
};

/** The ceiling a file of `lines` lines should carry: its length, never below the floor. */
export function expectedSizeCeiling(lines: number): number {
    return Math.max(lines, SIZE_CEILING_FLOOR);
}

function isValidCeiling(ceiling: number): boolean {
    return Number.isSafeInteger(ceiling) && ceiling >= SIZE_CEILING_FLOOR;
}

function checkBaselineFile(path: string, inputs: SizeCeilingInputs): SizeCeilingViolation | undefined {
    const ceiling = Object.hasOwn(inputs.ceilings, path) ? inputs.ceilings[path] : undefined;
    if (ceiling === undefined) {
        return { kind: 'missing-ceiling', path, lines: inputs.lineCount(path) };
    }
    if (!isValidCeiling(ceiling)) {
        return { kind: 'below-floor', path, ceiling };
    }
    const lines = inputs.lineCount(path);
    if (lines > ceiling) {
        return { kind: 'over-ceiling', path, lines, ceiling };
    }
    if (ceiling > SIZE_CEILING_FLOOR && ceiling - expectedSizeCeiling(lines) > SIZE_CEILING_SLACK) {
        return { kind: 'stale-ceiling', path, lines, ceiling };
    }
    return undefined;
}

/** Every way the recorded ceilings disagree with the baseline and the files' current lengths. */
export function findSizeCeilingViolations(inputs: SizeCeilingInputs): SizeCeilingViolation[] {
    const baseline = new Set(inputs.baselineFiles);
    const fileViolations = inputs.baselineFiles.flatMap((path) => checkBaselineFile(path, inputs) ?? []);
    const unlisted = Object.keys(inputs.ceilings)
        .filter((path) => !baseline.has(path))
        .map((path): SizeCeilingViolation => ({ kind: 'unlisted-ceiling', path }));
    return [...fileViolations, ...unlisted];
}

/** The instruction a future author reads when the ceilings check fails. */
export function describeSizeCeilingViolation(violation: SizeCeilingViolation): string {
    switch (violation.kind) {
        case 'missing-ceiling':
            return `${violation.path}: baselined with no ceiling in ${SIZE_CEILINGS_PATH}; record ${expectedSizeCeiling(violation.lines)} (it has ${violation.lines} lines).`;
        case 'unlisted-ceiling':
            return `${violation.path}: has a ceiling in ${SIZE_CEILINGS_PATH} but is not in eslint.size-baseline.mjs; remove the entry.`;
        case 'over-ceiling':
            return `${violation.path}: ${violation.lines} lines exceeds its ceiling of ${violation.ceiling}; extract code into another file until it fits. Never raise the ceiling.`;
        case 'stale-ceiling':
            return `${violation.path}: ceiling ${violation.ceiling} sits more than ${SIZE_CEILING_SLACK} above its ${violation.lines} lines; lower it to ${expectedSizeCeiling(violation.lines)} in ${SIZE_CEILINGS_PATH}.`;
        case 'below-floor':
            return `${violation.path}: ceiling ${violation.ceiling} is not a whole number of at least ${SIZE_CEILING_FLOOR}; record the file's line count, or ${SIZE_CEILING_FLOOR} if it is shorter.`;
    }
}

function isCeilingRecord(value: unknown): value is Record<string, number> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return Object.values(value).every((entry) => typeof entry === 'number');
}

/** Reads the recorded ceilings from the tree rooted at `repoRoot`. */
export function readSizeCeilings(repoRoot: string): Record<string, number> {
    const parsed: unknown = JSON.parse(readFileSync(resolve(repoRoot, SIZE_CEILINGS_PATH), 'utf8'));
    if (!isCeilingRecord(parsed)) {
        throw new Error(`${SIZE_CEILINGS_PATH} must be one flat object mapping each path to a number.`);
    }
    return parsed;
}

/** Counts newline characters, as `wc -l` does, in the file at `path` relative to `repoRoot`. */
export function countFileLines(repoRoot: string, path: string): number {
    return readFileSync(resolve(repoRoot, path), 'utf8').split('\n').length - 1;
}
