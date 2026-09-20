#!/usr/bin/env node
/**
 * `pnpm stances:check <bundle>` — advisory orchestrator probe for a review bundle's pre-dispatch
 * `stances.json` admission lines.
 *
 * The Review contract requires each stance's admission line to name "the failure mode that admits
 * it — the input or state that breaks — never the path the diff touches", and the orchestrator
 * confirms substance before acceptance. Nothing mechanical checked that wording, so a vacuous
 * admission ("the diff touches src/foo.ts and src/bar.ts") read as substance until a reviewer
 * happened to notice. This script asks TypeSafe's Jev model one typed yes/no question per stance —
 * does `stances[i].admittedBy` name a concrete failure mode for `stances[i].stance`? — and fails
 * every line whose judgment lands below the threshold.
 *
 * Boundaries. This is an orchestrator-side advisory probe, not a trusted delivery script: it
 * writes nothing, reads only the bundle it is given, and its verdict only names lines for repair —
 * the acceptance duty itself stays with the orchestrator. The API key is read from the environment
 * only and is never printed or written. The stop causes form one regime with the contract: the
 * third-party classes — a missing key, an unavailable or degraded service, or a malformed response
 * — exit 1 without a verdict and are a disclosed limitation for delivery, never a pass: an
 * unjudged admission is not a clean one. The caller-side classes remain stops: an out-of-range
 * threshold or a malformed record exits 1.
 *
 * How it can fail:
 *
 *  1. **Vacuous admission.** A line that only names touched files, paths, hunks, or module areas
 *     scores low and is reported FAIL with its probability.
 *  2. **Triggerless admission.** A line that states a bare outcome, hedges a maybe-consequence, or
 *     echoes generic failure-mode vocabulary without naming the stance-specific trigger scores low
 *     and is reported FAIL with its probability.
 *  3. **Genuine admission.** A line naming the concrete trigger and the consequence that follows
 *     from it — a reordered send queue drops a buffered frame — scores at or above the threshold
 *     and passes.
 *  4. **Missing admission.** An entry without a non-empty `admittedBy` string is refused before
 *     any request: the contract requires the line, so its absence is not a judgment call.
 *  5. **Malformed shape.** The base record shape is parsed by the production parser
 *     (`parseReviewStancesRecord`), so a record the publication gate would refuse is refused here
 *     with the same message.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail } from './prContract.ts';
import { parseReviewStancesRecord } from './reviewDossierPublication.ts';

export const TYPESAFE_STANCES_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_STANCES_MODEL = 'jev-latest';
export const TYPESAFE_API_KEY_ENV = 'TYPESAFE_API_KEY';
export const DEFAULT_STANCES_THRESHOLD = 0.5;

const STANCES_FILE_NAME = 'stances.json';
const ADMISSION_DISPLAY_LIMIT = 80;

export type StanceAdmission = {
    stance: string;
    admittedBy: string;
};

/**
 * What the checker consumes from one bundle: the raw parsed `stances.json` object, which travels
 * to the model verbatim as the request `state`, plus the per-stance admission lines lifted out of
 * it. The production parser owns the base shape; this type only names what this checker reads.
 */
export type StancesCheckRecord = {
    state: unknown;
    admissions: StanceAdmission[];
};

export type StancesQuestion = {
    type: 'noul';
    instructions: string;
    criteria: { true: string; false: string };
};

export type StancesCheckQuestions = Record<string, StancesQuestion>;

export type StancesCheckBody = {
    state: unknown;
    model: typeof TYPESAFE_STANCES_MODEL;
    questions: StancesCheckQuestions;
};

export type StanceVerdict = {
    key: string;
    stance: string;
    admittedBy: string;
    probability: number;
    passes: boolean;
};

export type StancesCheckEvaluation = {
    verdicts: StanceVerdict[];
    failures: StanceVerdict[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function stanceKey(index: number): string {
    return `stance_${String(index)}`;
}

/**
 * Parses the bundle's `stances.json` through the production parser and lifts each entry's
 * admission line. A missing or blank `admittedBy` is refused here, before any request: the
 * contract requires the line to exist, so its absence is a caller defect, not a judgment call.
 */
export function readStancesCheckRecord(raw: unknown, path: string): StancesCheckRecord {
    const record = parseReviewStancesRecord(raw, path);
    // The parser guarantees raw is a record whose stances entries align 1:1 with record.stances;
    // the fallbacks below only satisfy the unknown typing and are unreachable after the parse.
    const entries: readonly unknown[] = isRecord(raw) && Array.isArray(raw.stances) ? raw.stances : [];
    const admissions = record.stances.map((entry, index) => {
        const rawEntry = entries[index];
        const admittedBy =
            isRecord(rawEntry) && typeof rawEntry.admittedBy === 'string' ? rawEntry.admittedBy : undefined;
        if (admittedBy === undefined || admittedBy.trim() === '') {
            fail(
                `review stances record at ${path} stances[${String(index)}] (${entry.stance}) must carry a non-empty admittedBy string naming the failure mode that admits it`
            );
        }
        return { stance: entry.stance, admittedBy };
    });
    return { state: raw, admissions };
}

const CRITERIA_TRUE =
    'The admission names the specific input, state, or scenario that breaks for this stance — one concrete ' +
    'causal chain whose stance-specific trigger (the actual mechanism, component, or behavior involved, not ' +
    'a generic actor like "a bad input" or "a rule") produces the stated consequence; generic consequence ' +
    'vocabulary without a stance-specific trigger does not qualify, even when it reads like a failure list';
const CRITERIA_FALSE =
    'The admission only names touched files, paths, hunks, or module areas; or states an outcome with no ' +
    'named trigger; or hedges a maybe-consequence with no concrete break; or merely restates this ' +
    "criterion's or the question's own vocabulary without stance-specific substance; or describes the check " +
    'itself in the abstract instead of naming a concrete break; or lists generic outcomes ("a bad input ' +
    'publishes", "a rule is contradicted") that name no concrete mechanism of this change';

function buildAdmissionQuestion(index: number): StancesQuestion {
    return {
        type: 'noul',
        instructions:
            `Does \`stances[${String(index)}].admittedBy\` name a concrete failure mode for the stance ` +
            `\`stances[${String(index)}].stance\` — an input, state, or scenario that would break, whose ` +
            'consequence follows from it — rather than only naming files or paths, or stating generic ' +
            'consequence language without a stance-specific trigger?',
        criteria: { true: CRITERIA_TRUE, false: CRITERIA_FALSE },
    };
}

/** One typed Noul question per stance, keyed by index, over the record sent as the request state. */
export function buildStancesCheckQuestions(record: StancesCheckRecord): StancesCheckQuestions {
    const questions: StancesCheckQuestions = {};
    for (const [index] of record.admissions.entries()) {
        questions[stanceKey(index)] = buildAdmissionQuestion(index);
    }
    return questions;
}

/** The single TypeSafe request body: the parsed record as state, the Jev model, one question per stance. */
export function buildStancesCheckBody(record: StancesCheckRecord): StancesCheckBody {
    return {
        state: record.state,
        model: TYPESAFE_STANCES_MODEL,
        questions: buildStancesCheckQuestions(record),
    };
}

/**
 * Judges every admission against its answer. A malformed answer is a stop, never a pass: a
 * judgment the service did not numerically deliver cannot stand in for one.
 */
export function evaluateStancesCheck(
    answers: unknown,
    threshold: number,
    admissions: readonly StanceAdmission[]
): StancesCheckEvaluation {
    if (!isRecord(answers)) {
        fail(`TypeSafe response answers must be an object, found ${describeValue(answers)}`);
    }
    const verdicts = admissions.map((admission, index) => {
        const key = stanceKey(index);
        const answer = answers[key];
        const noul = isRecord(answer) ? answer.noul : undefined;
        if (typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) {
            fail(`TypeSafe response answers[${key}].noul must be a number in [0, 1], found ${describeValue(noul)}`);
        }
        return {
            key,
            stance: admission.stance,
            admittedBy: admission.admittedBy,
            probability: noul,
            passes: noul >= threshold,
        };
    });
    return { verdicts, failures: verdicts.filter((verdict) => !verdict.passes) };
}

export function parseStancesCheckThreshold(raw: string | undefined): number {
    const text = raw ?? String(DEFAULT_STANCES_THRESHOLD);
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
        fail(`threshold must be a number in (0, 1], found ${describeValue(text)}`);
    }
    return value;
}

function truncateAdmission(text: string): string {
    return text.length <= ADMISSION_DISPLAY_LIMIT ? text : `${text.slice(0, ADMISSION_DISPLAY_LIMIT)}…`;
}

const USAGE = [
    'Usage: node scripts/checkStancesRecord.ts <bundle-path> [--threshold <t>]',
    '',
    "Checks a review bundle's stances.json admission lines with a TypeSafe Jev judgment: each",
    "stance's admittedBy line must name a concrete failure mode — an input, state, or scenario",
    'that would break, whose consequence follows from it — rather than only the files or paths the',
    'diff touches, a bare outcome, or generic consequence vocabulary.',
    '',
    '  <bundle-path>    Review bundle directory holding stances.json.',
    '  --threshold <t>  Pass mark for each judgment, in (0, 1]. Default 0.5.',
    '',
    `Requires ${TYPESAFE_API_KEY_ENV} in the environment. Exit 0 when every stance passes; exit 1`,
    'naming each failing stance, or on any refusal or service failure.',
].join('\n');

function parseCheckArguments(argv: readonly string[]): { bundlePath: string; thresholdRaw: string | undefined } {
    let bundlePath: string | undefined;
    let thresholdRaw: string | undefined;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === undefined) {
            break;
        }
        if (argument === '--threshold') {
            const value = argv[index + 1];
            if (value === undefined) {
                fail('--threshold requires a value in (0, 1]');
            }
            thresholdRaw = value;
            index += 1;
            continue;
        }
        if (argument.startsWith('--threshold=')) {
            thresholdRaw = argument.slice('--threshold='.length);
            continue;
        }
        if (argument.startsWith('--')) {
            fail(`unknown option ${argument}\n\n${USAGE}`);
        }
        if (bundlePath !== undefined) {
            fail(`exactly one bundle path is required, found both ${bundlePath} and ${argument}`);
        }
        bundlePath = argument;
    }
    if (bundlePath === undefined) {
        fail(USAGE);
    }
    return { bundlePath, thresholdRaw };
}

function readApiKey(env: Record<string, string | undefined>): string {
    const key = env[TYPESAFE_API_KEY_ENV];
    if (key === undefined || key.trim() === '') {
        fail(`refusing to call TypeSafe: ${TYPESAFE_API_KEY_ENV} is not set`);
    }
    return key;
}

function readStancesJson(path: string): unknown {
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        fail(`no readable stances record at ${path} — pass the review bundle directory holding stances.json`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch (error) {
        fail(`stances record at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return parsed;
}

async function requestStancesVerdicts(body: StancesCheckBody, apiKey: string): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(TYPESAFE_STANCES_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        fail(
            `TypeSafe request to ${TYPESAFE_STANCES_ENDPOINT} failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    let text: string;
    try {
        text = await response.text();
    } catch (error) {
        fail(`TypeSafe response body could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
        fail(`TypeSafe request returned HTTP ${String(response.status)}: ${truncateAdmission(text.trim())}`);
    }
    let payload: unknown;
    try {
        payload = JSON.parse(text) as unknown;
    } catch {
        fail('TypeSafe response is not valid JSON');
    }
    return payload;
}

/**
 * The response's `answers` member — the per-question judgments keyed by index — lifted out of the
 * response envelope (`model`, `answers`, `usage`). A payload without that member is a malformed
 * response and a stop: no member can stand in for a judgment that was never delivered.
 */
export function readStancesCheckAnswers(payload: unknown): unknown {
    if (!isRecord(payload) || !isRecord(payload.answers)) {
        fail(`TypeSafe response must carry an answers object, found ${describeValue(payload)}`);
    }
    return payload.answers;
}

async function runCheck(argv: readonly string[]): Promise<number> {
    const { bundlePath, thresholdRaw } = parseCheckArguments(argv);
    const threshold = parseStancesCheckThreshold(thresholdRaw);
    const apiKey = readApiKey(process.env);
    const stancesPath = join(bundlePath, STANCES_FILE_NAME);
    const record = readStancesCheckRecord(readStancesJson(stancesPath), stancesPath);
    const payload = await requestStancesVerdicts(buildStancesCheckBody(record), apiKey);
    const evaluation = evaluateStancesCheck(readStancesCheckAnswers(payload), threshold, record.admissions);
    for (const verdict of evaluation.verdicts) {
        console.log(
            `${verdict.stance} — "${truncateAdmission(verdict.admittedBy)}" — ${verdict.probability.toFixed(3)} ${verdict.passes ? 'PASS' : 'FAIL'}`
        );
    }
    if (evaluation.failures.length > 0) {
        const named = evaluation.failures
            .map((failure) => `${failure.stance} (${failure.probability.toFixed(3)})`)
            .join(', ');
        console.error(
            `stances:check: ${String(evaluation.failures.length)} of ${String(evaluation.verdicts.length)} admission line(s) fall below threshold ${String(threshold)}: ${named}`
        );
        return 1;
    }
    console.log(
        `stances:check: all ${String(evaluation.verdicts.length)} admission line(s) at or above threshold ${String(threshold)}`
    );
    return 0;
}

async function main(): Promise<number> {
    try {
        return await runCheck(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}
