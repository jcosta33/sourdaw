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
import { sensitiveContentReason } from '../semanticReview/sensitive.ts';
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
function observedProxy<T extends object>(target: T) {
    const traps = {
        getPrototypeOf: vi.fn(Reflect.getPrototypeOf),
        ownKeys: vi.fn(Reflect.ownKeys),
        getOwnPropertyDescriptor: vi.fn(Reflect.getOwnPropertyDescriptor),
        get: vi.fn(Reflect.get),
    };
    return { proxy: new Proxy<T>(target, traps), traps };
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

    const proxyCases: { name: string; target: object; payload: (proxy: object) => unknown }[] = [
        { name: 'payload', target: body(), payload: (proxy) => proxy },
        { name: 'state object', target: { label: 'ordinary' }, payload: (proxy) => body(proxy) },
        { name: 'nested object', target: { label: 'ordinary' }, payload: (proxy) => body({ nested: proxy }) },
        { name: 'state array', target: ['ordinary'], payload: (proxy) => body(proxy) },
        { name: 'nested array', target: ['ordinary'], payload: (proxy) => body({ nested: proxy }) },
        { name: 'questions', target: QUESTIONS, payload: (proxy) => body({}, proxy) },
        { name: 'question', target: QUESTIONS.check, payload: (proxy) => body({}, { check: proxy }) },
        {
            name: 'instructions',
            target: { label: 'ordinary' },
            payload: (proxy) => body({}, { check: { type: 'noul', instructions: proxy } }),
        },
        {
            name: 'criteria',
            target: { yes: 'ordinary' },
            payload: (proxy) => body({}, { check: { type: 'choice', criteria: proxy } }),
        },
    ];
    it.each(proxyCases)('rejects a Proxy $name before invoking any inspection trap', ({ target, payload }) => {
        const { proxy, traps } = observedProxy(target);
        expect(() => prepare(payload(proxy))).toThrow(expect.objectContaining({ code: 'invalid_response' }));
        for (const trap of Object.values(traps)) {
            expect(trap).not.toHaveBeenCalled();
        }
    });

    it.each(['object', 'array'])('returns a bounded local refusal for a revoked %s Proxy', (kind) => {
        const target = kind === 'array' ? ['ordinary'] : { label: 'ordinary' };
        const { proxy, revoke } = Proxy.revocable(target, {});
        revoke();
        expect(() => prepare(body(proxy))).toThrow(
            expect.objectContaining({
                code: 'invalid_response',
                message: 'TypeSafe request must contain plain JSON and valid typed questions',
            })
        );
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
    it.each(['state', 'questions'])('refuses a Proxy %s before cache, budget, provider, or fetch', async (position) => {
        const state = observedProxy({ label: 'ordinary' });
        const questions = observedProxy(QUESTIONS);
        const fetch = vi.fn<Fetch>(async () => response());
        const sdk = createSdkProviderPort({ apiKey: KEY, fetch });
        const systemOne = vi.fn(sdk.systemOne);
        const read = vi.fn(() => undefined);
        const write = vi.fn(() => undefined);
        const profile = SEMANTIC_BUDGET_PROFILES.ci;
        const budget = createBudgetController(profile);
        await expect(
            assessUnit({
                port: { systemOne },
                cache: { read, write },
                budget,
                profile,
                deadline: Date.now() + 60_000,
                state: position === 'state' ? state.proxy : { label: 'ordinary' },
                questions: position === 'questions' ? questions.proxy : QUESTIONS,
                requestedModel: MODEL,
                signal: signal(),
            })
        ).rejects.toMatchObject({ code: 'invalid_response' });
        for (const trap of Object.values(position === 'state' ? state.traps : questions.traps)) {
            expect(trap).not.toHaveBeenCalled();
        }
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(systemOne).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(budget.totals()).toMatchObject({ logicalRequests: 0, networkAttempts: 0, retries: 0, cacheHits: 0 });
    });

    it.each(['function', 'accessor'])(
        'refuses an inherited %s serialization hook above Array.prototype before SDK fetch',
        async (kind) => {
            const fetch = vi.fn<Fetch>(async () => response());
            const hook = vi.fn(() => ['rewritten']);
            const ancestor = Object.create(Object.prototype);
            Object.defineProperty(ancestor, 'toJSON', kind === 'accessor' ? { get: hook } : { value: hook });
            const previous = Object.getPrototypeOf(Array.prototype);
            let failure: unknown;
            try {
                Object.setPrototypeOf(Array.prototype, ancestor);
                const prepared = prepare(body(['ordinary', 'copied state[1]']));
                await sendTypeSafeRequest({ prepared, apiKey: KEY, signal: signal(), timeoutMs: 1000, fetch });
            } catch (error) {
                failure = error;
            } finally {
                Object.setPrototypeOf(Array.prototype, previous);
            }
            expect(failure).toBeInstanceOf(SemanticFailure);
            expect(failure).toMatchObject({ code: 'invalid_response' });
            expect(hook).not.toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
        }
    );

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

describe('opaque bearer complete request admission', () => {
    const opaque = ['A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2', 'M3n4O5p6', 'Q7r8S9t0'].join('');
    const header = ['Authorization:', 'Bearer', opaque].join(' ');
    const headerValues = [
        { shape: 'one-character', value: String.fromCharCode(81) },
        { shape: 'fifteen-character', value: ['Q1w2E3', 'r4T5y6', 'U7i'].join('') },
        { shape: 'sixteen-character', value: ['Q1w2E3', 'r4T5y6', 'U7iO'].join('') },
        { shape: 'rfc-example', value: ['mF_9', 'B5f-4', '1JqM'].join('.') },
    ];
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
        ...headerValues
            .slice(0, 2)
            .flatMap(({ shape, value }) =>
                whitespaceHeaderForms(value).map((form) => ({ ...form, shape: `${form.shape}-${shape}` }))
            ),
        ...headerValues.flatMap(({ shape, value }) =>
            explicitHeaderForms(value).map((form) => ({ ...form, shape: `${form.shape}-${shape}` }))
        ),
        ...headerValues.flatMap(({ shape, value }) => [
            { shape: `explicit-header-${shape}`, value: ['Authorization:', 'Bearer', value].join(' ') },
            { shape: `quoted-header-${shape}`, value: JSON.stringify({ Authorization: ['Bearer', value].join(' ') }) },
        ]),
        {
            shape: 'escaped-header',
            value: JSON.stringify(JSON.stringify({ Authorization: ['Bearer', headerValues[0]!.value].join(' ') })),
        },
        { shape: 'alphanumeric', value: header },
        { shape: 'dotted', value: ['Bearer', ['abcde', 'fghij', 'klmnop'].join('.')].join(' ') },
        { shape: 'alphabetic', value: ['Bearer', ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join('')].join(' ') },
        { shape: 'header-tail', value: `${header} expired` },
        {
            shape: 'dotted-tail',
            value: ['finding: Bearer', ['abcde', 'fghij', 'klmnop'].join('.'), 'was logged'].join(' '),
        },
        {
            shape: 'alphabetic-tail',
            value: ['finding: Bearer', ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join(''), 'was logged'].join(' '),
        },
        { shape: 'hyphenated', value: ['Bearer', 'credential-shaped'].join(' ') },
        { shape: 'quoted-hyphenated', value: `'${['Bearer', 'credential-shaped'].join(' ')}'` },
        { shape: 'header-hyphenated', value: ['Authorization:', 'Bearer', 'credential-shaped'].join(' ') },
        { shape: 'uppercase-underscore', value: ['Bearer', ['ABCD1234', 'EFGH5678'].join('_')].join(' ') },
        {
            shape: 'hyphenated-prose',
            value: ['Reviewer saw Bearer', ['qzxvpmrt', 'ncbwksjg'].join('-'), 'expire'].join(' '),
        },
    ];
    const positions = ['state', 'instructions', 'criteria', 'key', 'questionName', 'criterionKey', 'model'] as const;
    function payload(position: (typeof positions)[number], value: string) {
        let state: unknown = {};
        if (position === 'state') {
            state = { nested: [value] };
        }
        if (position === 'key') {
            state = { [value]: 'ordinary' };
        }
        return {
            state,
            model: position === 'model' ? value : MODEL,
            questions: {
                [position === 'questionName' ? value : 'q']: {
                    type: 'choice' as const,
                    instructions: position === 'instructions' ? value : 'Is it ordinary?',
                    criteria: {
                        [position === 'criterionKey' ? value : 'true']:
                            position === 'criteria' ? { nested: value } : 'ordinary',
                    },
                },
            },
        };
    }

    const headerStructures = headerValues.flatMap(({ shape, value }) =>
        ['', ' ', String.fromCharCode(9), ` ${String.fromCharCode(9)}`].flatMap((padding, index) => [
            {
                shape: `object-${shape}-padding-${String(index)}`,
                value,
                state: { Authorization: `${padding}${['Bearer', value].join(' ')}` },
            },
            {
                shape: `tuple-${shape}-padding-${String(index)}`,
                value,
                state: [['Authorization', `${padding}${['Bearer', value].join(' ')}`]],
            },
        ])
    );
    it.each(headerStructures)(
        'opaque bearer paired header $shape requires the serialized screen',
        ({ value, state }) => {
            expect(sensitiveContentReason('Authorization')).toBeUndefined();
            if (value.length < 16) {
                // Neither leaf carries header context; the final envelope must pair the key and value.
                expect(sensitiveContentReason(['Bearer', value].join(' '))).toBeUndefined();
            }
            expect(sensitiveContentReason(JSON.stringify(state))).toBeDefined();
            expect(sensitiveContentReason(JSON.stringify({ source: JSON.stringify(state) }))).toBeDefined();
            expect(() => prepare(body(state))).toThrow(expect.objectContaining({ code: 'sensitive_content_excluded' }));
        }
    );

    it.each([
        ...positions.flatMap((position) => literals.map((literal) => ({ position, ...literal, objectHeader: false }))),
        ...headerStructures.map(({ shape, value, state }) => ({
            position: 'state' as const,
            shape: `paired-header-${shape}`,
            value,
            objectHeader: state,
        })),
    ])(
        'opaque bearer $shape $position rejects before a would-hit cache and SDK delegate',
        async ({ position, value, objectHeader }) => {
            const request = payload(position, value);
            if (objectHeader) {
                request.state = objectHeader;
            }
            const validCachedResponse = {
                model: request.model,
                answers: Object.fromEntries(
                    Object.keys(request.questions).map((key) => [
                        key,
                        {
                            type: 'choice',
                            choice: Object.keys(request.questions[key]!.criteria)[0],
                            probabilities: Object.fromEntries(
                                Object.keys(request.questions[key]!.criteria).map((label) => [label, 1])
                            ),
                            confidence: 0.9,
                        },
                    ])
                ),
            };
            const read = vi.fn(() => validCachedResponse);
            const write = vi.fn();
            const fetch = vi.fn<Fetch>(async () => response());
            const sdk = createSdkProviderPort({ apiKey: KEY, fetch });
            const systemOne = vi.fn(sdk.systemOne);
            const profile = SEMANTIC_BUDGET_PROFILES.ci;
            const budget = createBudgetController(profile);
            const reserve = vi.spyOn(budget, 'reserve');
            const before = budget.totals();
            let failure: unknown;
            try {
                await assessUnit({
                    port: { systemOne },
                    cache: { read, write },
                    budget,
                    profile,
                    deadline: Date.now() + 60_000,
                    state: request.state,
                    questions: request.questions,
                    requestedModel: request.model,
                    signal: signal(),
                });
            } catch (error) {
                failure = error;
            }
            expect(read).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            expect(reserve).not.toHaveBeenCalled();
            expect(systemOne).not.toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
            expect(budget.totals()).toEqual(before);
            expect(failure).toMatchObject({ code: 'sensitive_content_excluded' });
            expect(() => prepare(request)).toThrow(expect.objectContaining({ code: 'sensitive_content_excluded' }));
            expect(sensitiveContentReason(JSON.stringify(request))).toBeDefined();
        }
    );

    it.each([
        ...positions.flatMap((position) => [
            // A reference needs actual interpolation; a bare alphabetic scheme value is a literal.
            { position, control: 'reference', value: 'Bearer ${runtimeCredentialReference}' },
            { position, control: 'short-prose', value: 'A reviewer mentions Bearer schemes in this note.' },
            { position, control: 'header-placeholder', value: 'Authorization: Bearer <token>' },
            { position, control: 'header-reference', value: 'Authorization: Bearer ${runtimeCredentialReference}' },
            ...explicitHeaderForms('<token>').map((form) => ({
                position,
                control: `${form.shape}-placeholder`,
                value: form.value,
            })),
            ...explicitHeaderForms('${runtimeCredentialReference}').map((form) => ({
                position,
                control: `${form.shape}-reference`,
                value: form.value,
            })),
            {
                position,
                control: 'prose',
                value: 'A reviewer notes Bearer credential-shaped examples remain synthetic and contain no credential.',
            },
        ]),
        ...['<token>', '${runtimeCredentialReference}', 'RUNTIME_CREDENTIAL_REFERENCE_PLACEHOLDER'].flatMap((value) =>
            whitespaceHeaderForms(value).map((form) => ({
                position: 'state' as const,
                control: `${form.shape}-benign`,
                value: form.value,
            }))
        ),
    ])('opaque bearer $control $position reaches a valid matching cache', async ({ position, value }) => {
        const request = payload(position, value);
        const read = vi.fn(() => ({
            model: request.model,
            answers: Object.fromEntries(
                Object.keys(request.questions).map((key) => [
                    key,
                    {
                        type: 'choice',
                        choice: Object.keys(request.questions[key]!.criteria)[0],
                        probabilities: Object.fromEntries(
                            Object.keys(request.questions[key]!.criteria).map((label) => [label, 1])
                        ),
                        confidence: 0.9,
                    },
                ])
            ),
        }));
        const fetch = vi.fn<Fetch>(async () => response());
        const sdk = createSdkProviderPort({ apiKey: KEY, fetch });
        const systemOne = vi.fn(sdk.systemOne);
        const write = vi.fn();
        const budget = createBudgetController(SEMANTIC_BUDGET_PROFILES.ci);
        const reserve = vi.spyOn(budget, 'reserve');
        const before = budget.totals();
        const result = await assessUnit({
            port: { systemOne },
            cache: { read, write },
            budget,
            profile: SEMANTIC_BUDGET_PROFILES.ci,
            deadline: Date.now() + 60_000,
            state: request.state,
            questions: request.questions,
            requestedModel: request.model,
            signal: signal(),
        });
        expect(result.fromCache).toBe(true);
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith(result.cacheKey);
        expect(result.response.model).toBe(request.model);
        expect(write).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
        expect(systemOne).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(budget.totals()).toEqual({ ...before, cacheHits: 1 });
    });

    it('opaque bearer serialized envelope control reaches one installed SDK delegate unchanged', async () => {
        const prepared = prepare(body({ header: 'Bearer <token>' }));
        const fetch = vi.fn<Fetch>(async (_url, init) => {
            expect(init?.body).toBe(prepared.serializedBody);
            return response();
        });
        await sendTypeSafeRequest({ prepared, apiKey: KEY, signal: signal(), timeoutMs: 1000, fetch });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
