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
} from '../checkStancesRecord.ts';

import type { StanceAdmission, StancesCheckRecord } from '../checkStancesRecord.ts';

const STANCES_PATH = 'bundles/2999-head/stances.json';

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

function checkRecord(
    state: unknown = genuineRecord(),
    admissions: StanceAdmission[] = GENUINE_ADMISSIONS
): StancesCheckRecord {
    return { state, admissions };
}

describe('readStancesCheckRecord', () => {
    it('parses the record through the production parser and carries the state and each admission', () => {
        const raw = genuineRecord();
        const record = readStancesCheckRecord(raw, STANCES_PATH);

        expect(record.state).toEqual(raw);
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
            expect(question.criteria.true).toContain('not merely which files changed');
            expect(question.criteria.false).toContain('touched files, paths, hunks, or module areas');
        }
    });
});

describe('buildStancesCheckBody', () => {
    it('builds one request body carrying the parsed state, the Jev model, and all questions', () => {
        const record = checkRecord();
        const body = buildStancesCheckBody(record);

        expect(body.state).toEqual(record.state);
        expect(body.model).toBe(TYPESAFE_STANCES_MODEL);
        expect(body.questions).toEqual(buildStancesCheckQuestions(record));
    });
});

describe('readStancesCheckAnswers', () => {
    it('lifts the answers member out of the response envelope', () => {
        const answers = { stance_0: { type: 'noul', noul: 0.03 } };

        expect(readStancesCheckAnswers({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1 } })).toEqual(answers);
    });

    it('refuses a payload without an answers object', () => {
        expect(() => readStancesCheckAnswers({ model: 'jev-1.13.0' })).toThrow(
            /TypeSafe response must carry an answers object/
        );
        expect(() => readStancesCheckAnswers(undefined)).toThrow(/TypeSafe response must carry an answers object/);
    });
});

describe('evaluateStancesCheck', () => {
    const ANSWERS = { stance_0: { noul: 0.93 }, stance_1: { noul: 0.41 } };

    it('passes a probability at the threshold and fails one below it', () => {
        const evaluation = evaluateStancesCheck(
            { stance_0: { noul: 0.5 }, stance_1: { noul: 0.4999 } },
            0.5,
            GENUINE_ADMISSIONS
        );

        expect(evaluation.verdicts[0]?.passes).toBe(true);
        expect(evaluation.verdicts[1]?.passes).toBe(false);
    });

    it('names every failing stance with its probability', () => {
        const evaluation = evaluateStancesCheck(ANSWERS, DEFAULT_STANCES_THRESHOLD, GENUINE_ADMISSIONS);

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
            GENUINE_ADMISSIONS
        );

        expect(evaluation.failures).toEqual([]);
        expect(evaluation.verdicts).toHaveLength(2);
    });

    it('stops on a missing answer key', () => {
        expect(() => evaluateStancesCheck({}, DEFAULT_STANCES_THRESHOLD, GENUINE_ADMISSIONS)).toThrow(
            /answers\[stance_0\]\.noul must be a number in \[0, 1\], found undefined/
        );
    });

    it('stops on a non-numeric noul', () => {
        expect(() =>
            evaluateStancesCheck({ stance_0: { noul: 'high' } }, DEFAULT_STANCES_THRESHOLD, GENUINE_ADMISSIONS)
        ).toThrow(/answers\[stance_0\]\.noul must be a number in \[0, 1\], found "high"/);
    });

    it('stops on a noul outside [0, 1]', () => {
        expect(() =>
            evaluateStancesCheck({ stance_0: { noul: 1.5 } }, DEFAULT_STANCES_THRESHOLD, GENUINE_ADMISSIONS)
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
