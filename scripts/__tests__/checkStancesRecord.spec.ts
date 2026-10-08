import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_STANCES_THRESHOLD,
    TYPESAFE_STANCES_MODEL,
    buildStancesCheckBody,
    buildStancesCheckQuestions,
    evaluateStancesCheck,
    parseStancesCheckThreshold,
    readStancesCheckAnswers,
    readStancesCheckRecord,
    renderStancesCheckOutcome,
} from '../checkStancesRecord.ts';
import { TYPESAFE_MODEL } from '../semanticReview/provider.ts';

import type { StanceAdmission, StancesCheckRecord } from '../checkStancesRecord.ts';

const STANCES_PATH = 'bundles/2999-head/stances.json';

function runOfflineCheck(raw: unknown) {
    const bundle = mkdtempSync(join(tmpdir(), 'sourdaw-stances-egress-'));
    const hookPath = join(bundle, 'offline-fetch.mjs');
    writeFileSync(join(bundle, 'stances.json'), JSON.stringify(raw));
    writeFileSync(
        hookPath,
        `globalThis.fetch = async (_url, options) => {
            console.log('OFFLINE_REQUEST ' + options.body);
            return new Response(JSON.stringify({
                model: ${JSON.stringify(TYPESAFE_STANCES_MODEL)},
                answers: { stance_0: { noul: 0.9 }, stance_1: { noul: 0.9 } }
            }));
        };`
    );
    try {
        return spawnSync(
            process.execPath,
            ['--import', hookPath, join(process.cwd(), 'scripts/checkStancesRecord.ts'), bundle],
            { encoding: 'utf8', env: { TYPESAFE_API_KEY: 'unused-offline-key' }, timeout: 5000 }
        );
    } finally {
        rmSync(bundle, { recursive: true, force: true });
    }
}

const GENUINE_ADMISSIONS: StanceAdmission[] = [
    { stance: 'correctness', admittedBy: 'a reordered queue drops a buffered voice frame' },
    { stance: 'test-validity', admittedBy: 'a weakened assertion reports a green round for a broken gate' },
];

function genuineRecord(): unknown {
    return {
        headSha: 'a'.repeat(40),
        stances: GENUINE_ADMISSIONS.map((admission) => ({
            stance: admission.stance,
            admittedBy: admission.admittedBy,
        })),
    };
}

function checkRecord(admissions: StanceAdmission[] = GENUINE_ADMISSIONS): StancesCheckRecord {
    return { admissions };
}

describe('readStancesCheckRecord', () => {
    it('keeps only admissions from a record containing private metadata and baseline prose', () => {
        const privateValue = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
        const raw = {
            headSha: 'a'.repeat(40),
            privateMetadata: privateValue,
            stances: GENUINE_ADMISSIONS.map((admission) => ({
                ...admission,
                baselineProbe: { observedResult: privateValue },
                privateMetadata: privateValue,
            })),
        };

        expect(readStancesCheckRecord(raw, STANCES_PATH)).toEqual({ admissions: GENUINE_ADMISSIONS });
    });

    it.each(['stance', 'admittedBy'] as const)('refuses sensitive %s text without echoing it', (field) => {
        const privateValue = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
        const raw = { stances: [{ ...GENUINE_ADMISSIONS[0], [field]: privateValue }] };
        let message = '';
        try {
            readStancesCheckRecord(raw, STANCES_PATH);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toContain(`refusing to call TypeSafe: stances[0].${field} contains`);
        expect(message).not.toContain(privateValue);
    });

    it('parses the record through the production parser and carries each admission', () => {
        const raw = genuineRecord();
        const record = readStancesCheckRecord(raw, STANCES_PATH);

        expect(record.admissions).toEqual(GENUINE_ADMISSIONS);
    });

    it('refuses an entry without an admittedBy string, naming the stance, before any request', () => {
        expect(() => readStancesCheckRecord({ stances: [{ stance: 'correctness' }] }, STANCES_PATH)).toThrow(
            /review stances record at bundles\/2999-head\/stances\.json stances\[0\] \(correctness\) must carry a non-empty admittedBy string/
        );
    });

    it('refuses a blank admittedBy string', () => {
        expect(() =>
            readStancesCheckRecord({ stances: [{ stance: 'correctness', admittedBy: '   ' }] }, STANCES_PATH)
        ).toThrow(/must carry a non-empty admittedBy string/);
    });

    it('refuses a malformed record with the production parser message', () => {
        expect(() =>
            readStancesCheckRecord({ stances: [{ stance: 'correctness' }, { admission: 'x' }] }, STANCES_PATH)
        ).toThrow(/review stances record at bundles\/2999-head\/stances\.json stances\[1\] must carry a stance string/);
    });
});

describe('buildStancesCheckQuestions', () => {
    it('builds one Noul question per stance, keyed by index', () => {
        const questions = buildStancesCheckQuestions(checkRecord());

        expect(Object.keys(questions)).toEqual(['stance_0', 'stance_1']);
        expect(questions.stance_0?.type).toBe('noul');
        expect(questions.stance_1?.type).toBe('noul');
    });

    it('references the state by backticked per-stance paths in each question', () => {
        const questions = buildStancesCheckQuestions(checkRecord());

        expect(questions.stance_0?.instructions).toContain('`stances[0].admittedBy`');
        expect(questions.stance_0?.instructions).toContain('`stances[0].stance`');
        expect(questions.stance_1?.instructions).toContain('`stances[1].admittedBy`');
        expect(questions.stance_1?.instructions).toContain('`stances[1].stance`');
    });

    it('attaches failure-mode criteria to every question', () => {
        const questions = buildStancesCheckQuestions(checkRecord());

        for (const question of Object.values(questions)) {
            expect(question.criteria.true).toContain(
                'the specific input, state, or scenario that breaks for this stance'
            );
            expect(question.criteria.true).toContain(
                'generic consequence vocabulary without a stance-specific trigger does not qualify'
            );
            expect(question.criteria.false).toContain('touched files, paths, hunks, or module areas');
            expect(question.criteria.false).toContain('states an outcome with no named trigger');
            expect(question.criteria.false).toContain('hedges a maybe-consequence with no concrete break');
            expect(question.criteria.false).toContain(
                "restates this criterion's or the question's own vocabulary without stance-specific substance"
            );
        }
    });
});

describe('buildStancesCheckBody', () => {
    it('projects only the admission fields even from a manually constructed record', () => {
        const privateValue = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
        const record = {
            state: { privateMetadata: privateValue },
            admissions: GENUINE_ADMISSIONS.map((admission) => ({
                ...admission,
                baselineProbe: { observedResult: privateValue },
                privateMetadata: privateValue,
            })),
        };
        const body = buildStancesCheckBody(record);

        expect(body.state).toEqual({ stances: GENUINE_ADMISSIONS });
        expect(JSON.stringify(body)).not.toContain(privateValue);
        expect(Object.keys(body.questions)).toEqual(['stance_0', 'stance_1']);
    });

    it.each(['stance', 'admittedBy'] as const)('screens manually constructed %s text at the body boundary', (field) => {
        const privateValue = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
        const record = checkRecord([
            { stance: 'queue-loss', admittedBy: 'a reordered queue drops a frame', [field]: privateValue },
        ]);

        expect(() => buildStancesCheckBody(record)).toThrow(`refusing to call TypeSafe: stances[0].${field} contains`);
    });

    it('builds one request body carrying the admission state, the Jev model, and all questions', () => {
        const record = checkRecord();
        const body = buildStancesCheckBody(record);

        expect(body.state).toEqual({ stances: record.admissions });
        expect(body.model).toBe(TYPESAFE_STANCES_MODEL);
        expect(body.questions).toEqual(buildStancesCheckQuestions(record));
    });
});

describe('offline CLI request boundary', () => {
    it('sends only admissions while retaining the indexed questions and verdicts', () => {
        const privateValue = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
        const result = runOfflineCheck({
            privateMetadata: privateValue,
            stances: GENUINE_ADMISSIONS.map((admission) => ({
                ...admission,
                baselineProbe: privateValue,
            })),
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('OFFLINE_REQUEST ');
        expect(result.stdout).not.toContain(privateValue);
        expect(result.stdout).toContain('stance_0');
        expect(result.stdout).toContain('stance_1');
        expect(result.stdout).toContain('all 2 admission line(s) at or above threshold');
    });

    it.each(['stance', 'admittedBy'] as const)('refuses unsafe %s before fetch with a safe diagnostic', (field) => {
        const privateValue = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
        const result = runOfflineCheck({ stances: [{ ...GENUINE_ADMISSIONS[0], [field]: privateValue }] });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stdout).not.toContain('OFFLINE_REQUEST');
        expect(result.stderr).toContain(`refusing to call TypeSafe: stances[0].${field} contains`);
        expect(result.stdout + result.stderr).not.toContain(privateValue);
    });
});

describe('readStancesCheckAnswers', () => {
    it('lifts the answers member and the answering model out of the response envelope', () => {
        const answers = { stance_0: { type: 'noul', noul: 0.03 } };

        expect(readStancesCheckAnswers({ model: TYPESAFE_STANCES_MODEL, answers, usage: { input_tokens: 1 } })).toEqual(
            { model: TYPESAFE_STANCES_MODEL, answers }
        );
    });

    it('refuses a payload without an answers object', () => {
        expect(() => readStancesCheckAnswers({ model: TYPESAFE_STANCES_MODEL })).toThrow(
            /TypeSafe response must carry an answers object/
        );
        expect(() => readStancesCheckAnswers(undefined)).toThrow(/TypeSafe response must carry an answers object/);
    });

    it('refuses a response whose model is not the pinned version', () => {
        const answers = { stance_0: { type: 'noul', noul: 0.03 } };

        expect(() => readStancesCheckAnswers({ model: 'jev-latest', answers })).toThrow(
            `TypeSafe response model must be ${TYPESAFE_STANCES_MODEL}, found "jev-latest"`
        );
        expect(() => readStancesCheckAnswers({ model: undefined, answers })).toThrow(/TypeSafe response model must be/);
    });

    it('refuses a superseded pin rather than accepting the family, naming both models', () => {
        const answers = { stance_0: { type: 'noul', noul: 0.03 } };

        expect(() => readStancesCheckAnswers({ model: 'jev-1.12.0', answers })).toThrow(
            `TypeSafe response model must be ${TYPESAFE_STANCES_MODEL}, found "jev-1.12.0"`
        );
    });
});

/**
 * The production composition, end to end over its exported seams: validate the response against the
 * pinned model, judge the admissions with the model that answered, then render the outcome. Every
 * case here observes the chain rather than one link of it, so bypassing the pin read inside the
 * validation cannot leave the rendered outcome green.
 */
function runStancesCheckOutcome(payload: unknown, threshold: number = DEFAULT_STANCES_THRESHOLD) {
    const response = readStancesCheckAnswers(payload);
    const evaluation = evaluateStancesCheck(response.answers, threshold, GENUINE_ADMISSIONS, response.model);
    return renderStancesCheckOutcome(evaluation, threshold);
}

const PASSING_ANSWERS = { stance_0: { noul: 0.9 }, stance_1: { noul: 0.6 } };

describe('renderStancesCheckOutcome', () => {
    it('names the pinned model in the all-pass summary line, keeping the threshold text', () => {
        const evaluation = evaluateStancesCheck(
            PASSING_ANSWERS,
            DEFAULT_STANCES_THRESHOLD,
            GENUINE_ADMISSIONS,
            TYPESAFE_STANCES_MODEL
        );
        const outcome = renderStancesCheckOutcome(evaluation, DEFAULT_STANCES_THRESHOLD);

        expect(outcome.passed).toBe(true);
        expect(outcome.stderr).toEqual([]);
        expect(outcome.stdout).toHaveLength(3);
        expect(outcome.stdout[0]).toContain('correctness');
        expect(outcome.stdout[0]).toContain('PASS');
        expect(outcome.stdout[2]).toBe(
            `stances:check: all 2 admission line(s) at or above threshold 0.5 (model ${TYPESAFE_STANCES_MODEL})`
        );
    });

    it('names the pinned model in the below-threshold failure line, keeping the threshold text', () => {
        const evaluation = evaluateStancesCheck(
            { stance_0: { noul: 0.93 }, stance_1: { noul: 0.41 } },
            DEFAULT_STANCES_THRESHOLD,
            GENUINE_ADMISSIONS,
            TYPESAFE_STANCES_MODEL
        );
        const outcome = renderStancesCheckOutcome(evaluation, DEFAULT_STANCES_THRESHOLD);

        expect(outcome.passed).toBe(false);
        expect(outcome.stdout).toHaveLength(2);
        expect(outcome.stderr).toEqual([
            `stances:check: 1 of 2 admission line(s) fall below threshold 0.5 (model ${TYPESAFE_STANCES_MODEL}): test-validity (0.410)`,
        ]);
        expect(outcome.stderr[0]).toContain(TYPESAFE_STANCES_MODEL);
    });

    it('names the model the evaluation carries rather than the pinned request constant', () => {
        const evaluation = evaluateStancesCheck(
            PASSING_ANSWERS,
            DEFAULT_STANCES_THRESHOLD,
            GENUINE_ADMISSIONS,
            'jev-1.12.0'
        );
        const outcome = renderStancesCheckOutcome(evaluation, DEFAULT_STANCES_THRESHOLD);

        expect(outcome.stdout.at(-1)).toBe(
            'stances:check: all 2 admission line(s) at or above threshold 0.5 (model jev-1.12.0)'
        );
        expect(outcome.stdout.at(-1)).not.toContain(TYPESAFE_STANCES_MODEL);
    });

    it('names the model the evaluation carries in the below-threshold failure line too', () => {
        const evaluation = evaluateStancesCheck(
            { stance_0: { noul: 0.93 }, stance_1: { noul: 0.41 } },
            DEFAULT_STANCES_THRESHOLD,
            GENUINE_ADMISSIONS,
            'jev-1.12.0'
        );
        const outcome = renderStancesCheckOutcome(evaluation, DEFAULT_STANCES_THRESHOLD);

        expect(outcome.stderr).toEqual([
            'stances:check: 1 of 2 admission line(s) fall below threshold 0.5 (model jev-1.12.0): test-validity (0.410)',
        ]);
        expect(outcome.stderr[0]).not.toContain(TYPESAFE_STANCES_MODEL);
    });

    it('renders no summary line for a record with no admissions', () => {
        const evaluation = evaluateStancesCheck({}, DEFAULT_STANCES_THRESHOLD, [], TYPESAFE_STANCES_MODEL);
        const outcome = renderStancesCheckOutcome(evaluation, DEFAULT_STANCES_THRESHOLD);

        expect(outcome.passed).toBe(true);
        expect(outcome.stdout).toEqual([
            `stances:check: all 0 admission line(s) at or above threshold 0.5 (model ${TYPESAFE_STANCES_MODEL})`,
        ]);
    });
});

describe('stance check outcome composition', () => {
    it('chains the pin read, the evaluation and the render, naming the answering model', () => {
        const outcome = runStancesCheckOutcome({ model: TYPESAFE_STANCES_MODEL, answers: PASSING_ANSWERS });

        expect(outcome.passed).toBe(true);
        expect(outcome.stdout.at(-1)).toBe(
            `stances:check: all 2 admission line(s) at or above threshold 0.5 (model ${TYPESAFE_STANCES_MODEL})`
        );
    });

    it('refuses a mismatched-model payload before any outcome can be rendered, never a PASS naming the pin', () => {
        expect(() => runStancesCheckOutcome({ model: 'jev-latest', answers: PASSING_ANSWERS })).toThrow(
            `TypeSafe response model must be ${TYPESAFE_STANCES_MODEL}, found "jev-latest"`
        );
        // The same chain over a superseded pin: the refusal is what stops the render, not the renderer.
        expect(() => runStancesCheckOutcome({ model: 'jev-1.12.0', answers: PASSING_ANSWERS })).toThrow(
            `TypeSafe response model must be ${TYPESAFE_STANCES_MODEL}, found "jev-1.12.0"`
        );
    });

    it('still renders the below-threshold failure through the chain, naming the answering model', () => {
        const outcome = runStancesCheckOutcome({
            model: TYPESAFE_STANCES_MODEL,
            answers: { stance_0: { noul: 0.93 }, stance_1: { noul: 0.41 } },
        });

        expect(outcome.passed).toBe(false);
        expect(outcome.stderr[0]).toContain(`(model ${TYPESAFE_STANCES_MODEL})`);
        expect(outcome.stderr[0]).toContain('test-validity (0.410)');
    });
});

describe('model pin', () => {
    it('pins the same versioned model as the scan provider', () => {
        expect(TYPESAFE_STANCES_MODEL).toBe(TYPESAFE_MODEL);
    });
});

describe('evaluateStancesCheck', () => {
    const ANSWERS = { stance_0: { noul: 0.93 }, stance_1: { noul: 0.41 } };

    it('passes a probability at the threshold and fails one below it', () => {
        const evaluation = evaluateStancesCheck(
            { stance_0: { noul: 0.5 }, stance_1: { noul: 0.4999 } },
            0.5,
            GENUINE_ADMISSIONS,
            TYPESAFE_STANCES_MODEL
        );

        expect(evaluation.verdicts[0]?.passes).toBe(true);
        expect(evaluation.verdicts[1]?.passes).toBe(false);
    });

    it('carries the model that answered into the evaluation', () => {
        const evaluation = evaluateStancesCheck(ANSWERS, DEFAULT_STANCES_THRESHOLD, GENUINE_ADMISSIONS, 'jev-1.12.0');

        expect(evaluation.model).toBe('jev-1.12.0');
    });

    it('names every failing stance with its probability', () => {
        const evaluation = evaluateStancesCheck(
            ANSWERS,
            DEFAULT_STANCES_THRESHOLD,
            GENUINE_ADMISSIONS,
            TYPESAFE_STANCES_MODEL
        );

        expect(evaluation.failures).toEqual([
            {
                key: 'stance_1',
                stance: 'test-validity',
                admittedBy: GENUINE_ADMISSIONS[1]?.admittedBy,
                probability: 0.41,
                passes: false,
            },
        ]);
    });

    it('reports no failures when every stance meets the threshold', () => {
        const evaluation = evaluateStancesCheck(
            { stance_0: { noul: 0.9 }, stance_1: { noul: 0.6 } },
            DEFAULT_STANCES_THRESHOLD,
            GENUINE_ADMISSIONS,
            TYPESAFE_STANCES_MODEL
        );

        expect(evaluation.failures).toEqual([]);
        expect(evaluation.verdicts).toHaveLength(2);
    });

    it('stops on a missing answer key', () => {
        expect(() =>
            evaluateStancesCheck({}, DEFAULT_STANCES_THRESHOLD, GENUINE_ADMISSIONS, TYPESAFE_STANCES_MODEL)
        ).toThrow(/answers\[stance_0\]\.noul must be a number in \[0, 1\], found undefined/);
    });

    it('stops on a non-numeric noul', () => {
        expect(() =>
            evaluateStancesCheck(
                { stance_0: { noul: 'high' } },
                DEFAULT_STANCES_THRESHOLD,
                GENUINE_ADMISSIONS,
                TYPESAFE_STANCES_MODEL
            )
        ).toThrow(/answers\[stance_0\]\.noul must be a number in \[0, 1\], found "high"/);
    });

    it('stops on a noul outside [0, 1]', () => {
        expect(() =>
            evaluateStancesCheck(
                { stance_0: { noul: 1.5 } },
                DEFAULT_STANCES_THRESHOLD,
                GENUINE_ADMISSIONS,
                TYPESAFE_STANCES_MODEL
            )
        ).toThrow(/answers\[stance_0\]\.noul must be a number in \[0, 1\]/);
    });
});

describe('parseStancesCheckThreshold', () => {
    it('falls back to the default threshold', () => {
        expect(parseStancesCheckThreshold(undefined)).toBe(0.5);
    });

    it('accepts values in (0, 1]', () => {
        expect(parseStancesCheckThreshold('1')).toBe(1);
        expect(parseStancesCheckThreshold('0.75')).toBe(0.75);
    });

    it.each(['0', '-1', '1.5', 'abc'])('refuses %s', (raw) => {
        expect(() => parseStancesCheckThreshold(raw)).toThrow(/threshold must be a number in \(0, 1\]/);
    });
});
