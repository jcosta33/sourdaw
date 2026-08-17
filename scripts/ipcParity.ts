#!/usr/bin/env node

/**
 * IPC parity harness.
 *
 * The fixtures under `scripts/ipcFixtures/` are what the Tauri backend answers
 * today, recorded through the real invoke pipeline by
 * `src-tauri/tests/ipc_fixtures.rs`. The renderer is the same build under both
 * shells, so a replacement backend has to answer identically or the app breaks
 * at runtime with nothing failing to compile.
 *
 * This module is the comparison side of that: it loads the recorded answers and
 * says, for a live response, exactly where it differs. Run directly
 * (`pnpm ipc:parity`) it verifies the recorded set itself is well-formed and
 * prints the inventory — a fixture that silently stopped parsing would make
 * every later parity run pass by having nothing to check.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type IpcOutcome = 'ok' | 'error';

export type IpcFixture = {
    /** Tauri command name, as the renderer invokes it. */
    readonly command: string;
    /** Which recorded scenario of that command this is. */
    readonly case: string;
    /** The invoke arguments, camelCased exactly as they cross the boundary. */
    readonly args: Readonly<Record<string, unknown>>;
    /**
     * Which half of the `Result` came back. Recorded separately from the
     * payload because Tauri routes the two halves down different callbacks: a
     * comparison that only looked at payloads would call a command that started
     * failing "identical" whenever the error text happened to match.
     */
    readonly outcome: IpcOutcome;
    readonly payload: unknown;
};

export type IpcResponse = {
    readonly outcome: IpcOutcome;
    readonly payload: unknown;
};

export const FIXTURES_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), 'ipcFixtures');

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const parseFixture = (path: string, raw: unknown): IpcFixture => {
    if (!isRecord(raw)) {
        throw new Error(`${path}: fixture must be a JSON object`);
    }
    const { command, case: caseName, args, outcome, payload } = raw;
    if (typeof command !== 'string' || command === '') {
        throw new Error(`${path}: "command" must be a non-empty string`);
    }
    if (typeof caseName !== 'string' || caseName === '') {
        throw new Error(`${path}: "case" must be a non-empty string`);
    }
    if (!isRecord(args)) {
        throw new Error(`${path}: "args" must be a JSON object`);
    }
    if (outcome !== 'ok' && outcome !== 'error') {
        throw new Error(`${path}: "outcome" must be "ok" or "error"`);
    }
    return { command, case: caseName, args, outcome, payload };
};

export const loadIpcFixtures = (directory: string = FIXTURES_DIRECTORY): readonly IpcFixture[] => {
    const files = readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .sort();

    return files.map((name) => {
        const path = join(directory, name);
        let raw: unknown;
        try {
            raw = JSON.parse(readFileSync(path, 'utf8'));
        } catch (error) {
            throw new Error(`${path}: not valid JSON`, { cause: error });
        }
        return parseFixture(path, raw);
    });
};

/**
 * How far two numbers may differ and still count as the same answer.
 *
 * Not a softened comparison — a measured one. The recorded `parse_scl` table is
 * built with `powf`, and rebuilding the Rust workspace from unchanged sources
 * moved entries by one unit in the last place, because the call is folded at
 * compile time in some builds and left to libm in others. Pinned to exact bits,
 * a parity run would report a failure that no backend change caused.
 *
 * Roughly five ULP, relative. It cannot hide what parity is looking for: a
 * swapped field, a unit change or a renamed key moves a value by vastly more.
 * Structure, key sets, array lengths, strings, booleans and nulls stay exact.
 */
export const NUMERIC_TOLERANCE = 1e-15;

const numbersMatch = (expected: number, actual: number): boolean => {
    if (Object.is(expected, actual)) {
        return true;
    }
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
        return false;
    }
    return Math.abs(expected - actual) <= NUMERIC_TOLERANCE * Math.max(Math.abs(expected), Math.abs(actual));
};

/**
 * Describe every place `actual` differs from `expected`, by path.
 *
 * Structural rather than a stringified compare, because the useful output of a
 * failed parity run is which field moved — not two 128-element arrays printed
 * side by side. Object key order is irrelevant (JSON objects are unordered);
 * array order is not.
 */
export const diffJson = (expected: unknown, actual: unknown, path = '$'): readonly string[] => {
    if (typeof expected === 'number' && typeof actual === 'number') {
        return numbersMatch(expected, actual) ? [] : [`${path}: expected ${expected}, got ${actual}`];
    }

    if (Array.isArray(expected) || Array.isArray(actual)) {
        if (!Array.isArray(expected) || !Array.isArray(actual)) {
            return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
        }
        if (expected.length !== actual.length) {
            return [`${path}: expected ${expected.length} items, got ${actual.length}`];
        }
        return expected.flatMap((item, index) => diffJson(item, actual[index], `${path}[${index}]`));
    }

    if (isRecord(expected) || isRecord(actual)) {
        if (!isRecord(expected) || !isRecord(actual)) {
            return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
        }
        const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
        return keys.flatMap((key) => {
            const inExpected = Object.hasOwn(expected, key);
            const inActual = Object.hasOwn(actual, key);
            if (!inActual) {
                return [`${path}.${key}: missing from the live response`];
            }
            if (!inExpected) {
                return [`${path}.${key}: present in the live response but not recorded`];
            }
            return diffJson(expected[key], actual[key], `${path}.${key}`);
        });
    }

    if (!Object.is(expected, actual)) {
        return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
    }
    return [];
};

export type ParityResult = {
    readonly command: string;
    readonly case: string;
    readonly matches: boolean;
    readonly differences: readonly string[];
};

export const compareInvokeResponse = (fixture: IpcFixture, actual: IpcResponse): ParityResult => {
    const differences =
        fixture.outcome === actual.outcome
            ? diffJson(fixture.payload, actual.payload, '$.payload')
            : [`$.outcome: expected "${fixture.outcome}", got "${actual.outcome}"`];

    return {
        command: fixture.command,
        case: fixture.case,
        matches: differences.length === 0,
        differences,
    };
};

const main = (): void => {
    const fixtures = loadIpcFixtures();
    if (fixtures.length === 0) {
        console.error(`No IPC fixtures found in ${FIXTURES_DIRECTORY}`);
        process.exitCode = 1;
        return;
    }
    for (const fixture of fixtures) {
        console.log(`${fixture.command} · ${fixture.case} → ${fixture.outcome}`);
    }
    console.log(`${fixtures.length} IPC parity fixtures verified in ${FIXTURES_DIRECTORY}`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
