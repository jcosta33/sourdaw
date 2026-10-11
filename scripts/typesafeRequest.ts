import { types } from 'node:util';

import {
    TypeSafeClient,
    type EntryType,
    type Fetch,
    type JsonValue,
    type Question,
    type SystemOneRequestPayload,
} from '@typesafe-ai/sdk';

import { refuse, SemanticFailure } from './semanticReview/contracts.ts';
import { sensitiveContentReason } from './semanticReview/sensitive.ts';

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai';
export const TYPESAFE_MAX_CONTAINERS = 64;
export const TYPESAFE_MAX_VALUES = 65_536;

type JsonObject = { [key: string]: JsonValue };

export type PreparedTypeSafeRequest = {
    readonly payload: Readonly<SystemOneRequestPayload>;
    readonly serializedBody: string;
    readonly bodyBytes: number;
    readonly stateQuestionsBytes: number;
};

const preparedRequests = new WeakSet<PreparedTypeSafeRequest>();

export function assertTypeSafeActive(signal: AbortSignal): void {
    if (signal.aborted) {
        refuse('cancelled', 'the TypeSafe request was cancelled');
    }
}

function invalidShape(): never {
    return refuse('invalid_response', 'TypeSafe request must contain plain JSON and valid typed questions');
}

function screen(text: string): void {
    const reason = sensitiveContentReason(text);
    if (reason !== undefined) {
        refuse('sensitive_content_excluded', `TypeSafe request withheld because it contains ${reason}`);
    }
}

type CopyBudget = {
    visit: () => void;
    text: (text: string) => void;
    remainingValues: () => number;
};

function createCopyBudget(maxBytes: number): CopyBudget {
    let visited = 0;
    let minimumBytes = 0;
    return {
        visit: () => {
            visited += 1;
            if (visited > TYPESAFE_MAX_VALUES) {
                refuse('request_too_large', 'TypeSafe request exceeds the JSON value limit');
            }
        },
        text: (text) => {
            // UTF-8 is at least one byte per UTF-16 code unit. Refuse huge inputs before encoding or regexes.
            if (text.length > maxBytes) {
                refuse('request_too_large', 'TypeSafe request contains an oversized string or key');
            }
            minimumBytes += Buffer.byteLength(text, 'utf8');
            if (minimumBytes > maxBytes) {
                refuse('request_too_large', 'TypeSafe request exceeds the encoded body limit');
            }
            screen(text);
        },
        remainingValues: () => TYPESAFE_MAX_VALUES - visited,
    };
}

type JsonContainer = {
    array: boolean;
    prototype: object | null;
    keys: string[];
    descriptors: Record<string, PropertyDescriptor>;
};

function readContainerPrototype(value: object, array: boolean): object | null {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (typeof prototype !== 'object') {
        invalidShape();
    }
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        invalidShape();
    }
    // Bound inherited lookup to the standard JSON container prototypes without invoking hooks.
    if (array && Object.getPrototypeOf(Array.prototype) !== Object.prototype) {
        invalidShape();
    }
    let inheritedToJson: PropertyDescriptor | undefined;
    if (prototype !== null) {
        inheritedToJson = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    }
    if (array && inheritedToJson === undefined) {
        inheritedToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    }
    if (
        inheritedToJson !== undefined &&
        (!('value' in inheritedToJson) || typeof inheritedToJson.value === 'function')
    ) {
        invalidShape();
    }
    return prototype;
}

/** Inspect descriptors before reading values: JSON.stringify must never get to invoke caller code. */
function inspectContainer(value: object, budget: CopyBudget): JsonContainer {
    // Descriptor and prototype inspection also executes Proxy traps; reject before any reflection.
    if (types.isProxy(value)) {
        invalidShape();
    }
    const array = Array.isArray(value);
    const prototype = readContainerPrototype(value, array);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > budget.remainingValues() + (array ? 1 : 0)) {
        refuse('request_too_large', 'TypeSafe request exceeds the JSON value limit');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys: string[] = [];
    for (const key of ownKeys) {
        if (typeof key !== 'string') {
            invalidShape();
        }
        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) {
            invalidShape();
        }
        keys.push(key);
        if (array && key === 'length') {
            continue;
        }
        if (!descriptor.enumerable) {
            invalidShape();
        }
        if (!array) {
            budget.text(key);
        }
    }
    return { array, prototype, keys, descriptors };
}

type CopyValue = (value: unknown, depth: number) => JsonValue;

function copyArray(container: JsonContainer, depth: number, copy: CopyValue): JsonValue[] {
    const length: unknown = container.descriptors.length?.value;
    if (typeof length !== 'number' || container.keys.length !== length + 1) {
        invalidShape();
    }
    const result: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = container.descriptors[String(index)];
        if (descriptor === undefined) {
            invalidShape();
        }
        result.push(copy(descriptor.value, depth + 1));
    }
    return result;
}

function copyObject(container: JsonContainer, depth: number, copy: CopyValue): JsonObject {
    const result: JsonObject = {};
    if (container.prototype === null) {
        Object.setPrototypeOf(result, null);
    }
    for (const key of container.keys) {
        // defineProperty keeps an own __proto__ key inert and preserves caller insertion order.
        Object.defineProperty(result, key, {
            value: copy(container.descriptors[key]?.value, depth + 1),
            enumerable: true,
            writable: false,
            configurable: false,
        });
    }
    return result;
}

function copyJson(input: unknown, maxBytes: number): JsonValue {
    const ancestors = new Set<object>();
    const budget = createCopyBudget(maxBytes);
    function copy(value: unknown, depth: number): JsonValue {
        budget.visit();
        if (typeof value === 'string') {
            budget.text(value);
            return value;
        }
        if (value === null || typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                invalidShape();
            }
            return value;
        }
        if (typeof value !== 'object') {
            invalidShape();
        }
        if (depth >= TYPESAFE_MAX_CONTAINERS) {
            refuse('request_too_large', 'TypeSafe request exceeds the nested container limit');
        }
        if (ancestors.has(value)) {
            invalidShape();
        }
        const container = inspectContainer(value, budget);
        ancestors.add(value);
        let result: JsonValue;
        if (container.array) {
            result = copyArray(container, depth, copy);
        } else {
            result = copyObject(container, depth, copy);
        }
        ancestors.delete(value);
        Object.freeze(result);
        return result;
    }
    try {
        return copy(input, 0);
    } catch (error) {
        if (error instanceof SemanticFailure) {
            throw error;
        }
        return invalidShape();
    }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntry(value: JsonValue | undefined): value is EntryType {
    return value === null || typeof value === 'string' || (typeof value === 'object' && value !== null);
}

function isQuestion(value: JsonValue): value is JsonObject & Question {
    if (!isObject(value) || !Object.hasOwn(value, 'type')) {
        return false;
    }
    if (Object.hasOwn(value, 'instructions') && !isEntry(value.instructions)) {
        return false;
    }
    const criteria = Object.hasOwn(value, 'criteria') ? value.criteria : undefined;
    if (value.type === 'noul') {
        return (
            criteria === undefined ||
            criteria === null ||
            (isObject(criteria) &&
                Object.entries(criteria).every(([key, entry]) => (key === 'true' || key === 'false') && isEntry(entry)))
        );
    }
    if (value.type === 'choice') {
        return isObject(criteria) && Object.keys(criteria).length <= 255 && Object.values(criteria).every(isEntry);
    }
    if (value.type === 'score') {
        return Array.isArray(criteria) && criteria.length >= 2 && criteria.length <= 10 && criteria.every(isEntry);
    }
    return false;
}

function assertPayload(value: JsonValue): asserts value is JsonObject & SystemOneRequestPayload {
    if (
        !isObject(value) ||
        !Object.hasOwn(value, 'state') ||
        !Object.hasOwn(value, 'model') ||
        !Object.hasOwn(value, 'questions') ||
        !isEntry(value.state) ||
        typeof value.model !== 'string' ||
        value.model === ''
    ) {
        invalidShape();
    }
    if (
        !isObject(value.questions) ||
        Object.keys(value.questions).length === 0 ||
        !Object.values(value.questions).every(isQuestion)
    ) {
        invalidShape();
    }
}

/** Complete admission precedes hashing, cache lookup, recording, reservation, and provider handoff. */
export function prepareTypeSafeRequest(input: {
    payload: unknown;
    maxStatePlusQuestionBytes: number;
    maxRequestBytes: number;
    signal: AbortSignal;
}): PreparedTypeSafeRequest {
    assertTypeSafeActive(input.signal);
    if (
        !Number.isSafeInteger(input.maxRequestBytes) ||
        input.maxRequestBytes <= 0 ||
        !Number.isSafeInteger(input.maxStatePlusQuestionBytes) ||
        input.maxStatePlusQuestionBytes <= 0
    ) {
        invalidShape();
    }
    const payload = copyJson(input.payload, input.maxRequestBytes);
    assertPayload(payload);
    const stateQuestionsBytes = Buffer.byteLength(
        JSON.stringify({ state: payload.state, questions: payload.questions }),
        'utf8'
    );
    const serializedBody = JSON.stringify(payload);
    const bodyBytes = Buffer.byteLength(serializedBody, 'utf8');
    if (stateQuestionsBytes > input.maxStatePlusQuestionBytes || bodyBytes > input.maxRequestBytes) {
        refuse('request_too_large', 'TypeSafe request exceeds the encoded request limits');
    }
    screen(serializedBody);
    assertTypeSafeActive(input.signal);
    const prepared = Object.freeze({ payload, serializedBody, bodyBytes, stateQuestionsBytes });
    preparedRequests.add(prepared);
    return prepared;
}

/** The SDK wraps custom-fetch failures; recover our local terminal refusal before caller retry policy. */
export function localTypeSafeFailure(error: unknown): SemanticFailure | undefined {
    const seen = new Set<unknown>();
    let current = error;
    while (current instanceof Error && !seen.has(current)) {
        if (current instanceof SemanticFailure) {
            return current;
        }
        seen.add(current);
        current = current.cause;
    }
    return undefined;
}

/** One SDK attempt, with a fetch closure bound to exactly one immutable prepared body. */
export async function sendTypeSafeRequest(input: {
    prepared: PreparedTypeSafeRequest;
    apiKey: string;
    signal: AbortSignal;
    timeoutMs: number;
    fetch?: Fetch;
}) {
    assertTypeSafeActive(input.signal);
    if (!preparedRequests.has(input.prepared)) {
        invalidShape();
    }
    const prepared = input.prepared;
    const delegate: Fetch = input.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const client = new TypeSafeClient({
        apiKey: input.apiKey,
        baseURL: TYPESAFE_ENDPOINT,
        defaultModel: prepared.payload.model,
        logLevel: 'warn',
        timeout: input.timeoutMs,
        retry: { maxRetries: 0 },
        dangerouslyAllowBrowser: false,
        fetch: (url, init) => {
            assertTypeSafeActive(input.signal);
            if (typeof init?.body !== 'string' || init.body !== prepared.serializedBody) {
                refuse('invalid_response', 'TypeSafe SDK serialized a body different from the prepared request');
            }
            return delegate(url, init);
        },
    });
    try {
        const response = await client.systemOne(prepared.payload, {
            signal: input.signal,
            timeout: input.timeoutMs,
            retry: { maxRetries: 0 },
        });
        assertTypeSafeActive(input.signal);
        return response;
    } catch (error) {
        const local = localTypeSafeFailure(error);
        if (local !== undefined) {
            throw local;
        }
        throw error;
    }
}
