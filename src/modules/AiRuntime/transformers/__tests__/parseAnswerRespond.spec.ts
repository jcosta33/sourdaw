import { describe, expect, it } from 'vitest';

import { ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS, ANSWER_RESPOND_MAX_TEXT_LENGTH } from '../../models/AnswerRespond';
import { parseAnswerRespond } from '../parseAnswerRespond';

describe('parseAnswerRespond', () => {
    it('accepts text and call ids, keeping each id once in first-cited order', () => {
        expect(parseAnswerRespond({ text: 'Loud.', evidenceCallIds: ['b', 'a', 'b'] })).toEqual({
            status: 'accepted',
            answer: { text: 'Loud.', evidenceCallIds: ['b', 'a'] },
        });
    });

    it('accepts text of exactly the maximum length', () => {
        const text = 'x'.repeat(ANSWER_RESPOND_MAX_TEXT_LENGTH);

        expect(parseAnswerRespond({ text, evidenceCallIds: [] })).toEqual({
            status: 'accepted',
            answer: { text, evidenceCallIds: [] },
        });
    });

    it('accepts exactly the maximum number of distinct call ids', () => {
        const evidenceCallIds = Array.from(
            { length: ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS },
            (_, index) => `call-${String(index)}`
        );

        expect(parseAnswerRespond({ text: 'Loud.', evidenceCallIds })).toEqual({
            status: 'accepted',
            answer: { text: 'Loud.', evidenceCallIds },
        });
    });

    it.each([
        ['an argument outside the contract', { text: 'Loud.', evidenceCallIds: [], commands: [] }],
        ['missing text', { evidenceCallIds: [] }],
        ['blank text', { text: '   ', evidenceCallIds: [] }],
        ['text over the bound', { text: 'x'.repeat(ANSWER_RESPOND_MAX_TEXT_LENGTH + 1), evidenceCallIds: [] }],
        ['missing call ids', { text: 'Loud.' }],
        ['an empty call id', { text: 'Loud.', evidenceCallIds: [''] }],
        ['a non-string call id', { text: 'Loud.', evidenceCallIds: [7] }],
        [
            'more call ids than the bound',
            {
                text: 'Loud.',
                evidenceCallIds: Array.from({ length: ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS + 1 }, () => 'call-1'),
            },
        ],
    ])('refuses %s', (_label, argumentsValue) => {
        expect(parseAnswerRespond(argumentsValue)).toMatchObject({ status: 'rejected' });
    });
});
