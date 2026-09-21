/**
 * The TypeSafe adapter: one client per process, an application-owned budget, one retry layer, a
 * content-addressed cache, and offline replay.
 *
 * The provider call is the only external effect here, and it is reached through a narrow port so the
 * pure request construction and the interpretation policy stay testable without a key or a network.
 * The production port is the TypeSafe SDK; the SDK's own automatic retries are disabled because every
 * network attempt must be visible to the budget controller, and exactly one retry layer may exist.
 *
 * Timeout is per attempt and the SDK has no total retry budget, so the adapter owns the overall
 * deadline and cancels through an `AbortSignal`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    APIConnectionError,
    APIError,
    APITimeoutError,
    APIUserAbortError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    TypeSafeClient,
    TypeSafeError,
    UnprocessableEntityError,
    VERSION as TYPESAFE_SDK_VERSION,
} from '@typesafe-ai/sdk';

import {
    refuse,
    SemanticFailure,
    semanticDigest,
    SEMANTIC_EVIDENCE_SELECTION_VERSION,
    SEMANTIC_PRICING_VERSION,
    SEMANTIC_REQUEST_FORMAT_VERSION,
    type SemanticFailureCode,
} from './contracts.ts';

import type { SemanticBudgetProfile } from './rules.ts';

/** Explicit endpoint and model. Environment fallbacks exist in the SDK and must never decide these. */
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai';
export const TYPESAFE_MODEL = 'jev-1.13.0';
export const TYPESAFE_API_KEY_ENV = 'TYPESAFE_API_KEY';

/** USD per million input tokens; output tokens are not charged. Versioned so a change is visible. */
export const TYPESAFE_INPUT_USD_PER_MTOK = 0.042;

export type SemanticProviderQuestions = Readonly<Record<string, unknown>>;

export type SemanticRawResponse = {
    readonly model: string;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly usage?: { readonly input_tokens: number; readonly output_tokens: number } | undefined;
};

export type SemanticProviderPort = {
    systemOne: (request: {
        state: unknown;
        questions: SemanticProviderQuestions;
        model: string;
        signal: AbortSignal;
        timeoutMs: number;
    }) => Promise<SemanticRawResponse>;
};

/**
 * The production port. `baseURL`, `defaultModel`, and `logLevel` are always supplied explicitly so a
 * `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, or `TYPESAFE_LOG_LEVEL` in the environment cannot
 * redirect the endpoint, swap the model, or turn on unredacted body logging.
 */
export function createSdkProviderPort(input: { apiKey: string; model?: string }): SemanticProviderPort {
    const model = input.model ?? TYPESAFE_MODEL;
    const client = new TypeSafeClient({
        apiKey: input.apiKey,
        baseURL: TYPESAFE_ENDPOINT,
        defaultModel: model,
        logLevel: 'warn',
        timeout: 5_000,
        retry: { maxRetries: 0 },
        dangerouslyAllowBrowser: false,
    });
    return {
        systemOne: async (request) => {
            const result = await client.systemOne(
                {
                    state: request.state as never,
                    questions: request.questions as never,
                    model: request.model,
                },
                { signal: request.signal, timeout: request.timeoutMs }
            );
            return {
                model: result.model,
                answers: result.answers,
                usage: result.usage,
            };
        },
    };
}

export const TYPESAFE_SDK_VERSION_FOR_CACHE = TYPESAFE_SDK_VERSION;

/**
 * Normalizes a provider failure into the internal taxonomy. Transient codes may be retried by the
 * adapter; everything else is terminal, including authentication, invalid requests, and aborts.
 */
export function classifyProviderError(error: unknown): { code: SemanticFailureCode; transient: boolean } {
    if (error instanceof APIUserAbortError) {
        return { code: 'cancelled', transient: false };
    }
    if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
        return { code: 'authentication_failed', transient: false };
    }
    if (error instanceof RateLimitError) {
        return { code: 'rate_limited', transient: true };
    }
    if (error instanceof APITimeoutError) {
        return { code: 'timeout', transient: true };
    }
    if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
        return { code: 'invalid_response', transient: false };
    }
    if (error instanceof NotFoundError) {
        return { code: 'unsupported_scope', transient: false };
    }
    if (error instanceof InternalServerError) {
        return { code: 'provider_unavailable', transient: true };
    }
    if (error instanceof APIConnectionError) {
        return { code: 'provider_unavailable', transient: true };
    }
    if (error instanceof APIError) {
        return {
            code: error.status >= 500 ? 'provider_unavailable' : 'invalid_response',
            transient: error.status >= 500,
        };
    }
    if (error instanceof TypeSafeError) {
        return { code: 'provider_unavailable', transient: true };
    }
    return { code: 'provider_unavailable', transient: true };
}

export type SemanticAttemptRecord = {
    readonly attempt: number;
    readonly retry: number;
    readonly outcome: 'ok' | 'transient' | 'terminal';
    readonly failureCode?: SemanticFailureCode;
    readonly bytes: number;
};

export type SemanticUsageTotals = {
    networkAttempts: number;
    logicalRequests: number;
    retries: number;
    submittedBytes: number;
    actualInputTokens: number;
    estimatedInputTokens: number;
    attemptsWithUnknownUsage: number;
    cacheHits: number;
};

/**
 * Validates a returned usage object before any of it is consumed. The cached path always checked
 * this, so the live path consuming it unchecked was an asymmetry: a hostile or buggy token count
 * would inflate the estimated cost, or poison the whole report when the writer re-validated it.
 */
export function readUsage(
    value: unknown,
    label: string,
    maxInputTokens?: number
): { input_tokens: number; output_tokens: number } | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const tokens = value as Record<string, unknown>;
    if (!Number.isSafeInteger(tokens.input_tokens) || (tokens.input_tokens as number) < 0) {
        refuse('invalid_response', `${label} input_tokens must be a non-negative safe integer`);
    }
    if (!Number.isSafeInteger(tokens.output_tokens) || (tokens.output_tokens as number) < 0) {
        refuse('invalid_response', `${label} output_tokens must be a non-negative safe integer`);
    }
    // A token cannot cover less than one byte of the request we serialized, so a count above the
    // submitted byte length is impossible rather than merely large. Without this the reported cost is
    // entirely provider-controlled: a schema-valid but hostile count inflates it without limit.
    if (maxInputTokens !== undefined && (tokens.input_tokens as number) > maxInputTokens) {
        refuse(
            'invalid_response',
            `${label} input_tokens ${String(tokens.input_tokens)} exceeds the ${String(maxInputTokens)} bytes submitted, which no tokenization can produce`
        );
    }
    return { input_tokens: tokens.input_tokens as number, output_tokens: tokens.output_tokens as number };
}

export function emptyUsage(): SemanticUsageTotals {
    return {
        networkAttempts: 0,
        logicalRequests: 0,
        retries: 0,
        submittedBytes: 0,
        actualInputTokens: 0,
        estimatedInputTokens: 0,
        attemptsWithUnknownUsage: 0,
        cacheHits: 0,
    };
}

export type SemanticCostEstimate = {
    readonly usd: number;
    readonly pricingVersion: string;
};

export function estimateCost(actualInputTokens: number): SemanticCostEstimate {
    return {
        usd: (actualInputTokens / 1_000_000) * TYPESAFE_INPUT_USD_PER_MTOK,
        pricingVersion: SEMANTIC_PRICING_VERSION,
    };
}

/**
 * A deliberately rough byte-to-token proxy, always labelled estimated. Bytes and model tokens are not
 * interchangeable, so this never stands in for a hard cost cap.
 */
export function estimateInputTokens(bytes: number): number {
    return Math.ceil(bytes / 4);
}

export type SemanticBudgetReservation = { readonly attempt: number; readonly bytes: number };

type BudgetState = {
    attempts: number;
    bytes: number;
    logicalRequests: number;
};

export type SemanticBudgetController = {
    /** Atomically reserves one attempt and its bytes, or reports why admission was refused. */
    readonly reserve: (
        bytes: number
    ) => SemanticBudgetReservation | { readonly refused: SemanticFailureCode; readonly reason: string };
    readonly recordRetry: () => void;
    readonly recordLogicalRequest: () => void;
    readonly recordCacheHit: () => void;
    readonly recordUsage: (
        usage: { input_tokens: number; output_tokens: number } | undefined,
        estimatedTokens: number
    ) => void;
    readonly totals: () => SemanticUsageTotals;
    readonly remainingBytes: () => number;
};

/**
 * Admission control. Reservation is synchronous so concurrent requests cannot oversubscribe the
 * attempt or byte budget; exhaustion stops new admissions and preserves completed assessments.
 */
export function createBudgetController(profile: SemanticBudgetProfile): SemanticBudgetController {
    const state: BudgetState = { attempts: 0, bytes: 0, logicalRequests: 0 };
    const usage = emptyUsage();
    return {
        reserve: (bytes) => {
            if (state.attempts + 1 > profile.maxAttempts) {
                return {
                    refused: 'budget_exhausted',
                    reason: `network attempt budget ${String(profile.maxAttempts)} exhausted`,
                };
            }
            if (state.bytes + bytes > profile.maxTotalSubmittedBytes) {
                return {
                    refused: 'budget_exhausted',
                    reason: `total submitted byte budget ${String(profile.maxTotalSubmittedBytes)} exhausted`,
                };
            }
            if (bytes > profile.maxRequestBytes) {
                return {
                    refused: 'budget_exhausted',
                    reason: `request of ${String(bytes)} bytes exceeds the ${String(profile.maxRequestBytes)}-byte request limit`,
                };
            }
            state.attempts += 1;
            state.bytes += bytes;
            usage.networkAttempts = state.attempts;
            usage.submittedBytes = state.bytes;
            return { attempt: state.attempts, bytes };
        },
        recordRetry: () => {
            usage.retries += 1;
        },
        recordLogicalRequest: () => {
            state.logicalRequests += 1;
            usage.logicalRequests = state.logicalRequests;
        },
        recordCacheHit: () => {
            usage.cacheHits += 1;
        },
        recordUsage: (returned, estimatedTokens) => {
            if (returned === undefined) {
                usage.attemptsWithUnknownUsage += 1;
                return;
            }
            usage.actualInputTokens += returned.input_tokens;
            usage.estimatedInputTokens += estimatedTokens;
        },
        totals: () => ({
            networkAttempts: usage.networkAttempts,
            logicalRequests: usage.logicalRequests,
            retries: usage.retries,
            submittedBytes: usage.submittedBytes,
            actualInputTokens: usage.actualInputTokens,
            estimatedInputTokens: usage.estimatedInputTokens,
            attemptsWithUnknownUsage: usage.attemptsWithUnknownUsage,
            cacheHits: usage.cacheHits,
        }),
        remainingBytes: () => Math.max(0, profile.maxTotalSubmittedBytes - state.bytes),
    };
}

/** The cache identity: everything that, when changed, must produce a new provider assessment. */
export function computeResponseCacheKey(input: {
    state: unknown;
    questions: SemanticProviderQuestions;
    model: string;
}): string {
    return semanticDigest({
        requestFormatVersion: SEMANTIC_REQUEST_FORMAT_VERSION,
        evidenceSelectionVersion: SEMANTIC_EVIDENCE_SELECTION_VERSION,
        sdkVersion: TYPESAFE_SDK_VERSION_FOR_CACHE,
        model: input.model,
        state: input.state as never,
        questions: input.questions as never,
    });
}

export type SemanticCachePort = {
    read: (key: string) => unknown;
    write: (key: string, value: unknown) => void;
};

export function createMemoryCache(): SemanticCachePort {
    const entries = new Map<string, unknown>();
    return {
        read: (key) => entries.get(key),
        write: (key, value) => {
            entries.set(key, value);
        },
    };
}

/**
 * A durable local cache keyed by the response identity, which is a 64-hex digest and therefore safe
 * as a filename. Only normalized, schema-validated responses are ever written, and the directory is
 * gitignored and lives outside the repository's tracked tree. It never holds a key, a header, or a
 * request body.
 */
export function createFileCache(directory: string): SemanticCachePort {
    return {
        read: (key) => {
            const path = join(directory, `${key}.json`);
            if (!existsSync(path)) {
                return undefined;
            }
            try {
                return JSON.parse(readFileSync(path, 'utf8')) as unknown;
            } catch {
                return undefined;
            }
        },
        write: (key, value) => {
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, `${key}.json`), JSON.stringify(value));
        },
    };
}

/**
 * Validates a cached or replayed response. Only normalized, schema-checked responses are ever stored,
 * so an unvalidated payload can never be replayed as a successful assessment.
 */
export function parseCachedResponse(value: unknown, label: string, maxInputTokens?: number): SemanticRawResponse {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.model !== 'string' || record.model === '') {
        refuse('invalid_response', `${label} is missing a returned model`);
    }
    if (typeof record.answers !== 'object' || record.answers === null || Array.isArray(record.answers)) {
        refuse('invalid_response', `${label} is missing an answers object`);
    }
    return {
        model: record.model,
        answers: record.answers as Readonly<Record<string, unknown>>,
        usage: readUsage(record.usage, `${label} usage`, maxInputTokens),
    };
}

export type SemanticAssessmentResult = {
    readonly cacheKey: string;
    readonly response: SemanticRawResponse;
    readonly attempts: readonly SemanticAttemptRecord[];
    readonly fromCache: boolean;
    readonly requestedModel: string;
};

const MAX_RATE_LIMIT_WAIT_MS = 30_000;

function retryAfterMs(error: unknown): number | undefined {
    if (!(error instanceof RateLimitError)) {
        return undefined;
    }
    const headers = (error as { headers?: Headers }).headers;
    const raw = headers?.get('retry-after');
    if (raw === null || raw === undefined || raw === '') {
        return undefined;
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) {
        return undefined;
    }
    return Math.min(seconds * 1_000, MAX_RATE_LIMIT_WAIT_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * One logical assessment: cache lookup, then bounded attempts under the shared budget.
 *
 * Retries happen only for explicitly transient failures, are counted, and are never used to reroll a
 * valid answer. Invalid requests, authentication failures, schema violations, and model mismatches are
 * terminal on the first attempt.
 */
export async function assessUnit(input: {
    port: SemanticProviderPort;
    cache: SemanticCachePort;
    budget: SemanticBudgetController;
    profile: SemanticBudgetProfile;
    deadline: number;
    state: unknown;
    questions: SemanticProviderQuestions;
    requestedModel: string;
    signal: AbortSignal;
    now?: () => number;
}): Promise<SemanticAssessmentResult> {
    const now = input.now ?? (() => Date.now());
    const cacheKey = computeResponseCacheKey({
        state: input.state,
        questions: input.questions,
        model: input.requestedModel,
    });
    // Serialized before the cache read so the token-magnitude bound applies to a cached response too.
    const body = JSON.stringify({ state: input.state, questions: input.questions, model: input.requestedModel });
    const cachedBytes = Buffer.byteLength(body, 'utf8');
    const cached = input.cache.read(cacheKey);
    if (cached !== undefined) {
        const response = parseCachedResponse(cached, `cache entry ${cacheKey.slice(0, 12)}`, cachedBytes);
        assertReturnedModel(response.model, input.requestedModel);
        input.budget.recordCacheHit();
        return { cacheKey, response, attempts: [], fromCache: true, requestedModel: input.requestedModel };
    }

    const bytes = cachedBytes;
    const stateBytes = Buffer.byteLength(canonicalBytes({ state: input.state, questions: input.questions }), 'utf8');
    if (stateBytes > input.profile.maxStatePlusQuestionBytes) {
        refuse(
            'budget_exhausted',
            `state plus longest question is ${String(stateBytes)} bytes, over the ${String(input.profile.maxStatePlusQuestionBytes)}-byte limit`
        );
    }

    input.budget.recordLogicalRequest();
    const outcome = await attemptWithRetries({
        port: input.port,
        cache: input.cache,
        budget: input.budget,
        profile: input.profile,
        deadline: input.deadline,
        state: input.state,
        questions: input.questions,
        requestedModel: input.requestedModel,
        signal: input.signal,
        bytes,
        cacheKey,
        now,
    });
    return {
        cacheKey,
        response: outcome.response,
        attempts: outcome.attempts,
        fromCache: false,
        requestedModel: input.requestedModel,
    };
}

type AttemptOutcome = {
    readonly response: SemanticRawResponse;
    readonly attempts: readonly SemanticAttemptRecord[];
};

/**
 * The bounded attempt loop. Every attempt reserves budget before it starts, so a concurrent request
 * can never oversubscribe the profile, and an exhausted budget is a typed stop rather than a silent
 * shortfall. A valid answer is returned on the attempt that produced it; nothing is rerolled.
 */
async function attemptWithRetries(input: {
    port: SemanticProviderPort;
    cache: SemanticCachePort;
    budget: SemanticBudgetController;
    profile: SemanticBudgetProfile;
    deadline: number;
    state: unknown;
    questions: SemanticProviderQuestions;
    requestedModel: string;
    signal: AbortSignal;
    bytes: number;
    cacheKey: string;
    now: () => number;
}): Promise<AttemptOutcome> {
    const attempts: SemanticAttemptRecord[] = [];
    const maxAttempts = input.profile.maxRetriesPerRequest + 1;
    let lastFailure: { code: SemanticFailureCode; message: string } | undefined;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        if (input.signal.aborted) {
            refuse('cancelled', 'the assessment was cancelled before the next attempt');
        }
        const remaining = input.deadline - input.now();
        if (remaining <= 0) {
            refuse('timeout', 'the overall assessment deadline elapsed before the next attempt');
        }
        const reservation = input.budget.reserve(input.bytes);
        if ('refused' in reservation) {
            refuse(reservation.refused, reservation.reason);
        }
        const attemptTimeout = Math.min(input.profile.attemptTimeoutMs, remaining);
        try {
            const response = await input.port.systemOne({
                state: input.state,
                questions: input.questions,
                model: input.requestedModel,
                signal: input.signal,
                timeoutMs: attemptTimeout,
            });
            assertReturnedModel(response.model, input.requestedModel);
            attempts.push({ attempt: reservation.attempt, retry: attemptIndex, outcome: 'ok', bytes: input.bytes });
            input.budget.recordUsage(
                readUsage(response.usage, 'TypeSafe response usage', input.bytes),
                estimateInputTokens(input.bytes)
            );
            input.cache.write(input.cacheKey, response);
            return { response, attempts };
        } catch (error) {
            // A refusal this adapter raised is not a provider failure: a model mismatch or a schema
            // violation is terminal and must never be retried or reclassified as transient.
            if (error instanceof SemanticFailure) {
                throw error;
            }
            const classified = classifyProviderError(error);
            const message = error instanceof Error ? error.message : String(error);
            attempts.push({
                attempt: reservation.attempt,
                retry: attemptIndex,
                outcome: classified.transient ? 'transient' : 'terminal',
                failureCode: classified.code,
                bytes: input.bytes,
            });
            if (!classified.transient) {
                refuse(classified.code, `TypeSafe assessment failed: ${message}`);
            }
            lastFailure = { code: classified.code, message };
            if (attemptIndex === maxAttempts - 1) {
                break;
            }
            const waitMs = retryAfterMs(error) ?? 0;
            if (waitMs > input.deadline - input.now()) {
                refuse(classified.code, `retry after ${String(waitMs)}ms would exceed the overall deadline`);
            }
            input.budget.recordRetry();
            if (waitMs > 0) {
                await sleep(waitMs, input.signal);
            }
        }
    }
    const failure = lastFailure ?? {
        code: 'provider_unavailable' as SemanticFailureCode,
        message: 'no attempt was made',
    };
    return refuse(
        failure.code,
        `TypeSafe assessment failed after ${String(attempts.length)} attempt(s): ${failure.message}`
    );
}

function canonicalBytes(value: unknown): string {
    return JSON.stringify(value);
}

/** The returned model must be exactly the pinned model that was requested. */
export function assertReturnedModel(returned: string, requested: string): void {
    if (returned !== requested) {
        refuse('model_mismatch', `TypeSafe answered with model ${returned}, but ${requested} was requested`);
    }
}
