import { describe, expect, it } from 'vitest';

import { ANSWER_RESPOND_MAX_STATEMENTS } from '../../models/AnswerRespond';
import {
    projectPlanningProviderToolSchemas,
    getPlanningProviderToolSchemas,
} from '../../useCases/getPlanningProviderToolSchemas';
import { getPlanningProviderSchemaContract } from '../../useCases/planningProviderSchema';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { parseAnswerRespond } from '../parseAnswerRespond';

const reference = { callId: 'measure', targetId: 'master', metricId: 'integratedLoudness' };
const schema = getPlanningProviderToolSchemas().find((tool) => tool.function.name === 'answer.respond')!.function
    .parameters;
const document = { intakeCallId: 'intake', statements: [{ kind: 'metric', reference }] };
describe('parseAnswerRespond', () => {
    it('publishes the canonical forms but advertises only the actual consuming phase', () => {
        const contract = getPlanningProviderSchemaContract();
        const schemas = getPlanningProviderToolSchemas();
        const entry = projectPlanningProviderToolSchemas(schemas, 'planning').find(
            (tool) => tool.function.name === 'answer.respond'
        )!;
        const complete = projectPlanningProviderToolSchemas(schemas, 'answer').find(
            (tool) => tool.function.name === 'answer.respond'
        )!;
        expect(matchesJsonSchema({}, schema)).toBe(true);
        expect(matchesJsonSchema(document, schema)).toBe(true);
        expect(matchesJsonSchema({}, entry.function.parameters)).toBe(true);
        expect(matchesJsonSchema(document, entry.function.parameters)).toBe(false);
        expect(matchesJsonSchema({}, complete.function.parameters)).toBe(false);
        expect(matchesJsonSchema(document, complete.function.parameters)).toBe(true);
        expect(parseAnswerRespond({}).status).toBe('rejected');
        expect(entry.function.parameters).not.toEqual(complete.function.parameters);
        expect(getPlanningProviderSchemaContract().identity).toBe(contract.identity);
        expect(complete.function.description).not.toContain('{}');
    });

    it('accepts the closed document through parser and actual published schema', () => {
        expect(parseAnswerRespond(document)).toEqual({ status: 'accepted', answer: document });
        expect(matchesJsonSchema(document, schema)).toBe(true);
    });
    it('accepts all finite statement forms', () => {
        const statements = [
            { kind: 'difference', left: reference, right: { ...reference, targetId: 'vocal' } },
            { kind: 'ranking', references: [reference], operation: 'maximum' },
            { kind: 'project-fact', fact: 'summary' },
            { kind: 'query-page', callId: 'query' },
            { kind: 'recipe', callId: 'recipe', recipeId: 'warm' },
            { kind: 'source-onsets', callId: 'onset' },
            { kind: 'limitation', code: 'timing-unavailable' },
        ];
        expect(parseAnswerRespond({ intakeCallId: 'intake', statements }).status).toBe('accepted');
        expect(matchesJsonSchema({ intakeCallId: 'intake', statements }, schema)).toBe(true);
    });
    it.each([
        { text: 'The master is minus fourteen LUFS.', evidenceCallIds: [] },
        { ...document, text: 'Better by three decibels' },
        { ...document, statements: [] },
        { ...document, intakeCallId: '' },
        {
            ...document,
            statements: Array.from({ length: ANSWER_RESPOND_MAX_STATEMENTS + 1 }, () => document.statements[0]),
        },
        { ...document, statements: [{ kind: 'metric', reference: { ...reference, value: -14, unit: 'LUFS' } }] },
        {
            ...document,
            statements: [{ kind: 'metric', reference: { ...reference, pointer: '/targets/0/measurements' } }],
        },
        {
            ...document,
            statements: [{ kind: 'ranking', references: [reference], operation: 'louder', winner: 'master' }],
        },
        { ...document, statements: [{ kind: 'prose', text: 'ten LUFS' }] },
        { ...document, statements: [{ kind: 'project-fact', fact: 'loudness' }] },
    ])('refuses raw prose, arbitrary values and malformed document: %j', (value) => {
        expect(parseAnswerRespond(value).status).toBe('rejected');
        expect(matchesJsonSchema(value, schema)).toBe(false);
    });
});
