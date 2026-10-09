// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    requestStancesVerdicts,
} from '../checkStancesRecord.ts';
import { TYPESAFE_MODEL } from '../semanticReview/provider.ts';

import type { StanceAdmission, StancesCheckRecord } from '../checkStancesRecord.ts';

const STANCES_PATH = 'bundles/2999-head/stances.json';

afterEach(() => vi.restoreAllMocks());

describe('stance prepared transport', () => {
    it('sends the projected body through the SDK unchanged and uses one attempt', async () => {
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const body = buildStancesCheckBody(checkRecord());
        const expected = JSON.stringify(body);
        const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            expect(init?.body).toBe(expected);
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            return new Response(JSON.stringify({ model: TYPESAFE_STANCES_MODEL, answers: {} }));
        });
        await expect(
            requestStancesVerdicts(body, 'unused-offline-key', { signal: new AbortController().signal, fetch })
        ).resolves.toMatchObject({ model: TYPESAFE_STANCES_MODEL });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(timeout).toHaveBeenCalledWith(expect.any(Function), 20_000);
    });

    it('admits the exact stance state/question cap and refuses one extra byte', async () => {
        const body = buildStancesCheckBody(checkRecord());
        body.state.stances[0]!.admittedBy = '';
        const emptyBytes = Buffer.byteLength(JSON.stringify({ state: body.state, questions: body.questions }), 'utf8');
        body.state.stances[0]!.admittedBy = 'x'.repeat(96 * 1024 - emptyBytes);
        const fetch = vi.fn(async () => new Response(JSON.stringify({ model: TYPESAFE_STANCES_MODEL, answers: {} })));
        const options = { signal: new AbortController().signal, fetch };
        await expect(requestStancesVerdicts(body, 'unused-offline-key', options)).resolves.toMatchObject({
            model: TYPESAFE_STANCES_MODEL,
        });
        body.state.stances[0]!.admittedBy += 'x';
        await expect(requestStancesVerdicts(body, 'unused-offline-key', options)).rejects.toMatchObject({
            code: 'request_too_large',
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('refuses a stance request above its new state/question cap before fetch', async () => {
        const body = buildStancesCheckBody(checkRecord());
        body.state.stances[0]!.admittedBy = 'x'.repeat(96 * 1024);
        const fetch = vi.fn(async () => new Response('{}'));
        await expect(
            requestStancesVerdicts(body, 'unused-offline-key', { signal: new AbortController().signal, fetch })
        ).rejects.toMatchObject({ code: 'request_too_large' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('pre-abort reaches no SDK fetch', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetch = vi.fn(async () => new Response('{}'));
        await expect(
            requestStancesVerdicts(buildStancesCheckBody(checkRecord()), 'unused-offline-key', {
                signal: controller.signal,
                fetch,
            })
        ).rejects.toMatchObject({ code: 'cancelled' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not retry a transient HTTP response', async () => {
        const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
        await expect(
            requestStancesVerdicts(buildStancesCheckBody(checkRecord()), 'unused-offline-key', {
                signal: new AbortController().signal,
                fetch,
            })
        ).rejects.toMatchObject({ status: 503 });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

function runOfflineCheck(raw: unknown, cancel = false) {
    const bundle = mkdtempSync(join(tmpdir(), 'sourdaw-stances-egress-'));
    const hookPath = join(bundle, 'offline-fetch.mjs');
    writeFileSync(join(bundle, 'stances.json'), JSON.stringify(raw));
    writeFileSync(
        hookPath,
        `globalThis.fetch = async (_url, options) => {
            console.log('OFFLINE_REQUEST ' + options.body);
            if (${String(cancel)}) {
                queueMicrotask(() => process.kill(process.pid, 'SIGTERM'));
                return new Response(new ReadableStream({ start() {} }));
            }
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
    it('turns process cancellation during body delivery into a failed check', () => {
        const result = runOfflineCheck(genuineRecord(), true);
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(result.stdout.match(/OFFLINE_REQUEST/gu)).toHaveLength(1);
        expect(result.stderr).toMatch(/abort|cancel/iu);
    });
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

describe('opaque bearer stance admission', () => {
    const opaque = ['A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2', 'M3n4O5p6', 'Q7r8S9t0'].join('');
    const header = ['Authorization:', 'Bearer', opaque].join(' ');
    const fields = ['stance', 'admittedBy'] as const;
    function explicitHeaderForms(value: string, padding = '', separator = ' ') {
        const scheme = `${padding}${['Bearer', value].join(separator)}${padding}`;
        return [
            { shape: 'template-bracket', value: `headers[\`Authorization\`] = \`${scheme}\`;` },
            { shape: 'bracket-assignment', value: `headers['Authorization'] = '${scheme}';` },
            { shape: 'computed-key', value: `const headers = { ['Authorization']: '${scheme}' };` },
            { shape: 'quoted-object', value: JSON.stringify({ Authorization: scheme }) },
            { shape: 'assignment', value: `headers.Authorization = '${scheme}';` },
            { shape: 'setter', value: `headers.set('Authorization', '${scheme}');` },
            { shape: 'append', value: `headers.append("Authorization", "${scheme}");` },
            { shape: 'tuple', value: JSON.stringify(['Authorization', scheme]) },
            { shape: 'escaped-tuple', value: JSON.stringify(JSON.stringify(['Authorization', scheme])) },
            { shape: 'escaped-setter', value: JSON.stringify(`headers.set("Authorization", "${scheme}");`) },
            { shape: 'template-assignment', value: `headers.Authorization = \`${scheme}\`;` },
        ];
    }
    function additionalHeaderForms(value: string) {
        const scheme = ['Bearer', value].join(' ');
        const comments = [
            { kind: 'block', gap: '/* retained */' },
            { kind: 'line', gap: '// retained\n' },
        ];
        const setters = comments.flatMap(({ kind, gap }) =>
            [
                { quote: "'", before: '', after: gap },
                { quote: '"', before: gap, after: '' },
                { quote: '`', before: gap, after: gap },
            ].map(({ quote, before, after }, index) => ({
                shape: `commented-setter-${kind}-${String(index)}`,
                value: `headers.set(${quote}Authorization${quote} ${before}, ${after} ${quote}${scheme}${quote});`,
            }))
        );
        const arrays = [[scheme], ['Bearer <token>', scheme], [scheme, 'Bearer <token>']].flatMap((values, index) => [
            { shape: `array-record-${String(index)}`, value: JSON.stringify({ Authorization: values }) },
            { shape: `array-tuple-${String(index)}`, value: JSON.stringify([['Authorization', values]]) },
        ]);
        return [...setters, ...arrays].flatMap((form) => [
            { ...form, shape: `${form.shape}-raw` },
            { shape: `${form.shape}-serialized`, value: JSON.stringify(form.value) },
        ]);
    }
    function whitespaceHeaderForms(value: string) {
        return [
            { whitespace: 'space', padding: ' ', separator: ' ' },
            { whitespace: 'tab', padding: String.fromCharCode(9), separator: ' ' },
            { whitespace: 'mixed', padding: ` ${String.fromCharCode(9)}`, separator: ' ' },
            { whitespace: 'scheme-tab', padding: '', separator: String.fromCharCode(9) },
        ].flatMap(({ whitespace, padding, separator }) =>
            explicitHeaderForms(value, padding, separator).flatMap((form) => [
                { ...form, shape: `${form.shape}-${whitespace}-raw` },
                { shape: `${form.shape}-${whitespace}-escaped`, value: JSON.stringify(form.value) },
            ])
        );
    }
    const literals = [
        ...[String.fromCharCode(81), ['Q1w2E3', 'r4T5y6', 'U7i'].join('')].flatMap((value, index) =>
            additionalHeaderForms(value).map((form) => ({ ...form, shape: `${form.shape}-short-${String(index)}` }))
        ),
        ...[String.fromCharCode(81), ['Q1w2E3', 'r4T5y6', 'U7i'].join('')].flatMap((value, index) =>
            whitespaceHeaderForms(value).map((form) => ({ ...form, shape: `${form.shape}-short-${String(index)}` }))
        ),
        ...[
            { shape: 'one-character', value: String.fromCharCode(81) },
            { shape: 'fifteen-character', value: ['Q1w2E3', 'r4T5y6', 'U7i'].join('') },
            { shape: 'sixteen-character', value: ['Q1w2E3', 'r4T5y6', 'U7iO'].join('') },
            { shape: 'rfc-example', value: ['mF_9', 'B5f-4', '1JqM'].join('.') },
        ].flatMap(({ shape, value }) => [
            { shape: `explicit-header-${shape}`, value: ['Authorization:', 'Bearer', value].join(' ') },
            ...explicitHeaderForms(value).map((form) => ({ ...form, shape: `${form.shape}-${shape}` })),
        ]),
        {
            shape: 'quoted-header',
            value: JSON.stringify({ Authorization: ['Bearer', String.fromCharCode(81)].join(' ') }),
        },
        {
            shape: 'escaped-header',
            value: JSON.stringify(JSON.stringify({ Authorization: ['Bearer', String.fromCharCode(81)].join(' ') })),
        },
        { shape: 'alphanumeric', value: header },
        { shape: 'dotted', value: ['Bearer', ['abcde', 'fghij', 'klmnop'].join('.')].join(' ') },
        { shape: 'alphabetic', value: ['Bearer', ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join('')].join(' ') },
        { shape: 'header-tail', value: `${header} expired` },
        {
            shape: 'hyphenated-prose',
            value: ['Reviewer saw Bearer', ['qzxvpmrt', 'ncbwksjg'].join('-'), 'expire'].join(' '),
        },
        {
            shape: 'dotted-tail',
            value: ['finding: Bearer', ['abcde', 'fghij', 'klmnop'].join('.'), 'was logged'].join(' '),
        },
        {
            shape: 'alphabetic-tail',
            value: ['finding: Bearer', ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join(''), 'was logged'].join(' '),
        },
    ];
    const cases = fields.flatMap((field) => literals.map((literal) => ({ field, ...literal })));

    it.each(cases)('opaque bearer $shape $field refuses parser and manual builder safely', ({ field, value }) => {
        const admission = { ...GENUINE_ADMISSIONS[0]!, [field]: value };
        for (const operation of [
            () => readStancesCheckRecord({ stances: [admission] }, STANCES_PATH),
            () => buildStancesCheckBody(checkRecord([admission])),
        ]) {
            let failure: unknown;
            try {
                operation();
            } catch (error) {
                failure = error;
            }
            expect(failure).toBeInstanceOf(Error);
            expect(String(failure)).toContain(`stances[0].${field} contains`);
            expect(String(failure)).not.toContain(opaque);
        }
    });

    it.each(cases)(
        'opaque bearer $shape $field refuses a direct request bypassing the builder',
        async ({ field, value }) => {
            const body = buildStancesCheckBody(checkRecord());
            body.state.stances[0]![field] = value;
            const fetch = vi.fn(async () => new Response('{}'));
            let failure: unknown;
            try {
                await requestStancesVerdicts(body, 'unused-offline-key', {
                    signal: new AbortController().signal,
                    fetch,
                });
            } catch (error) {
                failure = error;
            }
            expect(fetch).not.toHaveBeenCalled();
            expect(failure).toMatchObject({ code: 'sensitive_content_excluded' });
            expect(String(failure)).not.toContain(opaque);
        }
    );

    it.each(cases)('opaque bearer $shape $field refuses actual offline CLI admission', ({ field, value }) => {
        const result = runOfflineCheck({ stances: [{ ...GENUINE_ADMISSIONS[0]!, [field]: value }] });
        expect(result.error).toBeUndefined();
        expect(result.stdout).not.toContain('OFFLINE_REQUEST');
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`stances[0].${field} contains`);
        expect(result.stderr).not.toContain(opaque);
    });

    it.each(
        fields.flatMap((field) =>
            [
                ...explicitHeaderForms('<token>'),
                ...['<token>', '${runtimeCredentialReference}', 'RUNTIME_CREDENTIAL_REFERENCE_PLACEHOLDER'].flatMap(
                    additionalHeaderForms
                ),
                ...['<token>', '${runtimeCredentialReference}', 'RUNTIME_CREDENTIAL_REFERENCE_PLACEHOLDER'].flatMap(
                    whitespaceHeaderForms
                ),
            ].map((form) => ({ field, ...form }))
        )
    )(
        'opaque bearer $shape $field placeholder reaches one installed SDK delegate unchanged',
        async ({ field, value }) => {
            const admission = { ...GENUINE_ADMISSIONS[0]!, [field]: value };
            const record = readStancesCheckRecord({ stances: [admission] }, STANCES_PATH);
            const body = buildStancesCheckBody(record);
            const expected = JSON.stringify(body);
            const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
                expect(init?.body).toBe(expected);
                return new Response(JSON.stringify({ model: TYPESAFE_STANCES_MODEL, answers: {} }));
            });
            await expect(
                requestStancesVerdicts(body, 'unused-offline-key', {
                    signal: new AbortController().signal,
                    fetch,
                })
            ).resolves.toMatchObject({ model: TYPESAFE_STANCES_MODEL });
            expect(fetch).toHaveBeenCalledTimes(1);
        }
    );
});
