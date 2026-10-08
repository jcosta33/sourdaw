// @vitest-environment node
import { APIConnectionError, APITimeoutError, APIUserAbortError, type Fetch } from '@typesafe-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SemanticFailure } from '../semanticReview/contracts.ts';
import {
    assessUnit,
    classifyProviderError,
    createBudgetController,
    createSdkProviderPort,
} from '../semanticReview/provider.ts';
import { SEMANTIC_BUDGET_PROFILES } from '../semanticReview/rules.ts';
import {
    localTypeSafeFailure,
    prepareTypeSafeRequest,
    sendTypeSafeRequest,
    TYPESAFE_MAX_VALUES,
} from '../typesafeRequest.ts';

const MODEL = 'jev-1.13.0';
const KEY = 'unused-offline-key';
const QUESTIONS = { check: { type: 'noul', instructions: 'Is this consistent?' } };
const signal = (): AbortSignal => new AbortController().signal;
function prepare(payload: unknown, maxRequestBytes = 2_000_000, maxStatePlusQuestionBytes = maxRequestBytes) {
    return prepareTypeSafeRequest({ payload, maxRequestBytes, maxStatePlusQuestionBytes, signal: signal() });
}
function body(state: unknown = { label: 'ordinary' }, questions: unknown = QUESTIONS) {
    return { state, questions, model: MODEL };
}
function response() {
    return new Response(
        JSON.stringify({
            model: MODEL,
            answers: { check: { noul: 0.9 } },
            usage: { input_tokens: 2, output_tokens: 0 },
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    );
}
afterEach(() => vi.restoreAllMocks());

describe('prepared TypeSafe JSON', () => {
    it('detaches and freezes every carried occurrence while retaining order and inert own __proto__', () => {
        const shared = { label: 'before' };
        const state = Object.assign(Object.create(null), { z: shared, a: shared });
        Object.defineProperty(state, '__proto__', { value: { carried: true }, enumerable: true });
        const source = { state, model: MODEL, questions: QUESTIONS };
        const expected = JSON.stringify(source);
        const prepared = prepare(source);
        shared.label = 'after';
        state.extra = 'after';
        expect(prepared.serializedBody).toBe(expected);
        expect(JSON.stringify(prepared.payload)).toBe(expected);
        expect(Object.getPrototypeOf(prepared.payload.state)).toBeNull();
        const frozen = prepared.payload.state;
        if (typeof frozen !== 'object' || frozen === null || Array.isArray(frozen)) {
            throw new Error('expected a frozen object state');
        }
        expect(Object.hasOwn(frozen, '__proto__')).toBe(true);
        expect(frozen.z).not.toBe(frozen.a);
        expect(Object.isFrozen(frozen.z)).toBe(true);
        expect(Object.isFrozen(frozen.__proto__)).toBe(true);
        expect(Object.isFrozen(prepared.payload.questions.check)).toBe(true);
        expect(Object.isFrozen(prepared)).toBe(true);
    });

    it('rejects descriptors and serialization hooks without invoking them', () => {
        const getter = vi.fn(() => 'ordinary');
        const toJSON = vi.fn(() => 'ordinary');
        const accessor = Object.defineProperty({}, 'label', { get: getter, enumerable: true });
        const hidden = Object.defineProperty({}, 'label', { value: 'ordinary' });
        for (const state of [accessor, hidden, { toJSON }, Object.assign({}, { [Symbol('hidden')]: true })]) {
            expect(() => prepare(body(state))).toThrow(SemanticFailure);
        }
        expect(getter).not.toHaveBeenCalled();
        expect(toJSON).not.toHaveBeenCalled();
    });

    it.each([
        ['undefined', { label: undefined }],
        ['function', { label: () => 1 }],
        ['bigint', { label: 1n }],
        ['symbol', { label: Symbol('value') }],
        ['NaN', { label: NaN }],
        ['infinity', { label: Infinity }],
        ['custom prototype', new Date()],
        ['sparse', Array(1)],
        ['extra array key', Object.assign([1], { extra: 2 })],
    ])('rejects %s instead of silently changing JSON', (_name, state) => {
        expect(() => prepare(body(state))).toThrow(SemanticFailure);
    });

    it('rejects cycles but accepts repeated noncyclic values', () => {
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);
        expect(() => prepare(body(cyclic))).toThrow(SemanticFailure);
        const shared = { value: true };
        expect(prepare(body([shared, shared])).payload.state).toEqual([shared, shared]);
    });

    it('admits exactly 64 containers and refuses the next', () => {
        let state: unknown = 'leaf';
        for (let count = 0; count < 63; count += 1) {
            state = { nested: state };
        }
        expect(() => prepare(body(state))).not.toThrow();
        expect(() => prepare(body({ nested: state }))).toThrow(/container limit/u);
    });

    it('counts repeated carried values at the exact work boundary', () => {
        // Envelope, state, questions, question, type, instructions, model consume seven values.
        const state = Array.from({ length: TYPESAFE_MAX_VALUES - 7 }, () => null);
        expect(() => prepare(body(state))).not.toThrow();
        state.push(null);
        expect(() => prepare(body(state))).toThrow(/value limit/u);
        const shared = { value: null };
        expect(() => prepare(body(Array.from({ length: 33_000 }, () => shared)))).toThrow(/value limit/u);
    });

    it.each(['state', 'instructions', 'criteria', 'key', 'questionName', 'criterionKey', 'model'])(
        'screens decoded %s in the complete envelope',
        (position) => {
            const secret = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
            let payload: unknown = body({ nested: secret });
            if (position === 'model') {
                payload = { ...body(), model: secret };
            } else if (position === 'key') {
                payload = body({ [secret]: 'ordinary' });
            } else if (position === 'questionName') {
                payload = body({}, { [secret]: { type: 'noul' } });
            } else if (position === 'criterionKey') {
                payload = body({}, { check: { type: 'choice', criteria: { [secret]: null } } });
            } else if (position === 'instructions') {
                payload = body({}, { check: { type: 'noul', instructions: secret } });
            } else if (position === 'criteria') {
                payload = body({}, { check: { type: 'choice', criteria: { yes: { nested: secret } } } });
            }
            expect(() => prepare(payload)).toThrow(expect.objectContaining({ code: 'sensitive_content_excluded' }));
        }
    );

    it('screens the serialized envelope as well as individual text leaves', () => {
        expect(() => prepare(body({ password: ['A1b2C3d4', 'E5f6G7h8', 'I9j0'].join('') }))).toThrow(
            expect.objectContaining({ code: 'sensitive_content_excluded' })
        );
    });

    it('refuses huge strings and keys before serialization', () => {
        const stringify = vi.spyOn(JSON, 'stringify');
        for (const state of ['é'.repeat(500), { ['x'.repeat(1001)]: '' }]) {
            expect(() => prepare(body(state), 1000)).toThrow(expect.objectContaining({ code: 'request_too_large' }));
        }
        expect(stringify).not.toHaveBeenCalled();
    });

    it('checks exact UTF-8 and escaped caps for both measured envelopes', () => {
        const source = body({ label: 'é☃\\"\n'.repeat(20) });
        const prepared = prepare(source);
        expect(prepared.bodyBytes).toBe(Buffer.byteLength(JSON.stringify(source), 'utf8'));
        expect(() => prepare(source, prepared.bodyBytes, prepared.stateQuestionsBytes)).not.toThrow();
        expect(() => prepare(source, prepared.bodyBytes - 1)).toThrow(
            expect.objectContaining({ code: 'request_too_large' })
        );
        expect(() => prepare(source, prepared.bodyBytes, prepared.stateQuestionsBytes - 1)).toThrow(
            expect.objectContaining({ code: 'request_too_large' })
        );
    });

    it('preserves SDK optional and null fields and nested EntryType descriptions', () => {
        const questions = {
            noul: { type: 'noul' },
            nullNoul: { type: 'noul', instructions: null, criteria: null },
            choice: { type: 'choice', criteria: { yes: null, no: { explanation: ['nested', 2, false, null] } } },
            score: { type: 'score', instructions: ['rubric'], criteria: [null, { explanation: 'good' }] },
        };
        expect(prepare(body(null, questions)).payload.questions).toEqual(questions);
    });

    it('admits the documented criterion count boundaries and refuses their successors', () => {
        const choices = Object.fromEntries(Array.from({ length: 255 }, (_, index) => [String(index), null]));
        expect(() => prepare(body({}, { check: { type: 'choice', criteria: choices } }))).not.toThrow();
        expect(() => prepare(body({}, { check: { type: 'choice', criteria: { ...choices, next: null } } }))).toThrow(
            SemanticFailure
        );
        expect(() => prepare(body({}, { check: { type: 'score', criteria: Array(10).fill(null) } }))).not.toThrow();
        expect(() => prepare(body({}, { check: { type: 'score', criteria: Array(11).fill(null) } }))).toThrow(
            SemanticFailure
        );
    });

    it.each([
        {},
        { check: { type: 'unknown' } },
        { check: { type: 'noul', instructions: 1 } },
        { check: { type: 'noul', criteria: { maybe: 'description' } } },
        { check: { type: 'choice', criteria: [] } },
        { check: { type: 'choice', criteria: { yes: true } } },
        { check: { type: 'score', criteria: ['one'] } },
        { check: { type: 'score', criteria: [null, 2] } },
    ])('rejects an invalid question union %#', (questions) => {
        expect(() => prepare(body({}, questions))).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    });
});

describe('installed SDK prepared handoff', () => {
    it('keeps overlapping SDK handoffs bound to their own body', async () => {
        const first = prepare(body('first'));
        const second = prepare(body('second'));
        const captured: unknown[] = [];
        const fetch: Fetch = async (_url, init) => {
            captured.push(init?.body);
            return response();
        };
        await Promise.all(
            [first, second].map((prepared) =>
                sendTypeSafeRequest({ prepared, apiKey: KEY, signal: signal(), timeoutMs: 1000, fetch })
            )
        );
        expect(captured).toEqual([first.serializedBody, second.serializedBody]);
    });

    it('keeps an installed-SDK wire mismatch to one reserved caller attempt and zero delegated fetches', async () => {
        const fetch = vi.fn<Fetch>(async () => response());
        const sdk = createSdkProviderPort({ apiKey: KEY, fetch });
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 3 };
        const budget = createBudgetController(profile);
        let calls = 0;
        let writes = 0;
        const original = JSON.stringify;
        await expect(
            assessUnit({
                port: {
                    systemOne: async (request) => {
                        calls += 1;
                        vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
                            if (value?.state === request.state) {
                                return original({ ...value, sdkDrift: true });
                            }
                            return original(value, replacer, space);
                        });
                        return sdk.systemOne(request);
                    },
                },
                cache: {
                    read: () => undefined,
                    write: () => {
                        writes += 1;
                    },
                },
                budget,
                profile,
                deadline: Date.now() + 60_000,
                state: 'ordinary',
                questions: QUESTIONS,
                requestedModel: MODEL,
                signal: signal(),
            })
        ).rejects.toMatchObject({ code: 'invalid_response' });
        expect(calls).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
        expect(writes).toBe(0);
        expect(budget.totals()).toMatchObject({ networkAttempts: 1, retries: 0 });
    });

    it.each(['state-first', 'model-first'])('sends exactly the frozen prepared string with %s order', async (order) => {
        const state = { label: 'é☃\\"\n', nested: { z: 1, a: 2 } };
        const questions = { check: { type: 'choice', criteria: { yes: { nested: ['é', null] }, no: null } } };
        const payload =
            order === 'state-first' ? { state, questions, model: MODEL } : { model: MODEL, state, questions };
        const prepared = prepare(payload);
        state.label = 'mutated';
        const fetch = vi.fn<Fetch>(async (url, init) => {
            expect(url).toBe('https://api.typesafe.ai/v1/systemone');
            expect(init?.body).toBe(prepared.serializedBody);
            if (typeof init?.body !== 'string') {
                throw new TypeError('expected the SDK to send a string body');
            }
            expect(Buffer.byteLength(init.body, 'utf8')).toBe(prepared.bodyBytes);
            return response();
        });
        await sendTypeSafeRequest({ prepared, apiKey: KEY, signal: signal(), timeoutMs: 1000, fetch });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('recovers a wire mismatch wrapped by the installed SDK as a terminal local refusal', async () => {
        const prepared = prepare(body());
        const original = JSON.stringify;
        vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
            if (value?.state === prepared.payload.state) {
                return original({ ...value, sdkDrift: true });
            }
            return original(value, replacer, space);
        });
        const fetch = vi.fn<Fetch>(async () => response());
        await expect(
            sendTypeSafeRequest({ prepared, apiKey: KEY, signal: signal(), timeoutMs: 1000, fetch })
        ).rejects.toThrow(/different from the prepared request/u);
        expect(fetch).not.toHaveBeenCalled();
        const local = new SemanticFailure('invalid_response', 'local wire mismatch');
        const wrapped = new APIConnectionError('offline connection wrapper', { cause: local });
        expect(localTypeSafeFailure(wrapped)).toBe(local);
        expect(classifyProviderError(wrapped)).toEqual({ code: 'invalid_response', transient: false });
    });

    it('does not delegate a pre-aborted request', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetch = vi.fn<Fetch>(async () => response());
        await expect(
            sendTypeSafeRequest({
                prepared: prepare(body()),
                apiKey: KEY,
                signal: controller.signal,
                timeoutMs: 1000,
                fetch,
            })
        ).rejects.toMatchObject({ code: 'cancelled' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['timeout', 'cancel'])('covers response body delivery under %s', async (mode) => {
        const controller = new AbortController();
        const fetch = vi.fn<Fetch>(async () => {
            if (mode === 'cancel') {
                queueMicrotask(() => controller.abort());
            }
            return new Response(new ReadableStream({ start() {} }), {
                headers: { 'Content-Type': 'application/json' },
            });
        });
        await expect(
            sendTypeSafeRequest({
                prepared: prepare(body()),
                apiKey: KEY,
                signal: controller.signal,
                timeoutMs: 25,
                fetch,
            })
        ).rejects.toBeInstanceOf(mode === 'timeout' ? APITimeoutError : APIUserAbortError);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
