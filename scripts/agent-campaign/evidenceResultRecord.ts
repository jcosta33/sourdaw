/// <reference types="node" />
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { types } from 'node:util';

type JsonValue = boolean | number | string | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type ExitStatus = Readonly<{ kind: 'exit'; code: number } | { kind: 'signal'; signal: string }> | null;
type AssertionTotals = Readonly<{ passed: number; failed: number; notApplicable: number; total: number }>;
export type EvidenceResultRecordV1 = {
    readonly schemaVersion: 1;
    readonly resultId: string;
    readonly gateOrSuiteId: string;
    readonly integratedCommit: string;
    readonly policySha256: string;
    readonly packageSha256: string;
    readonly runEnvelopeSha256: string;
    readonly fixtureIds: readonly string[];
    readonly status: 'passed' | 'failed' | 'not-applicable';
    readonly startedAt: string;
    readonly endedAt: string;
    readonly exitStatus: ExitStatus;
    readonly stdoutSha256: string | null;
    readonly stderrSha256: string | null;
    readonly assertionTotals: AssertionTotals;
    readonly metricSamples: readonly JsonValue[];
    readonly aggregates: { readonly [key: string]: JsonValue };
    readonly rawSamplePaths: readonly string[];
    readonly environmentMatch: boolean;
    readonly capabilityDecision: 'applicable' | 'not-applicable';
    readonly reviewerDisposition: 'accepted' | 'rejected' | 'pending';
};
declare const structurallyValidatedEvidenceResult: unique symbol;
/** Proves closed canonical structure only; it is not manifest/envelope binding or persistence authority. */
export type StructurallyValidatedEvidenceResultRecordV1 = EvidenceResultRecordV1 & {
    readonly [structurallyValidatedEvidenceResult]: true;
};
const validated = new WeakSet<object>();
const HEX = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^(?:AC-\d{3}|PG-\d{3}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SIGNAL = /^SIG[A-Z0-9]{1,24}$/;
const FORBIDDEN_KEY =
    /^(?:__proto__|prototype|constructor)$|(?:secret|credential|authorization|token|prompt|lyrics?|projectname|privatepath|tojson|raw(?:audio|midi|output|stdout|stderr))/i;
const RECORD_KEYS =
    'aggregates,assertionTotals,capabilityDecision,endedAt,environmentMatch,exitStatus,fixtureIds,gateOrSuiteId,integratedCommit,metricSamples,packageSha256,policySha256,rawSamplePaths,resultId,reviewerDisposition,runEnvelopeSha256,schemaVersion,startedAt,status,stderrSha256,stdoutSha256'.split(
        ','
    );
export class EvidenceResultRecordError extends Error {
    public constructor() {
        super('invalid evidence result record');
        this.name = 'EvidenceResultRecordError';
    }
}
function fail(): never {
    throw new EvidenceResultRecordError();
}
function object(value: unknown, expectedKeys?: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) {
        return fail();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > 256 || keys.some((key) => typeof key === 'symbol')) {
        return fail();
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
        return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !('value' in descriptor))) {
        return fail();
    }
    if (expectedKeys) {
        const actual = keys.map(String).sort();
        const expected = [...expectedKeys].sort();
        if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
            return fail();
        }
    }
    return value as Record<string, unknown>;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
        return fail();
    }
    return value as number;
}
function array(value: unknown): unknown[] {
    if (
        types.isProxy(value) ||
        !Array.isArray(value) ||
        value.length > 256 ||
        Object.getPrototypeOf(value) !== Array.prototype
    ) {
        return fail();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) {
        return fail();
    }
    if (keys.at(-1) !== 'length' || keys.slice(0, -1).some((key, index) => key !== String(index))) {
        return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) {
        return fail();
    }
    return value;
}
function text(value: unknown, pattern: RegExp, maximum = 256): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || !pattern.test(value)) {
        return fail();
    }
    return value;
}
function stringList(value: unknown, kind: 'id' | 'path'): string[] {
    const entries = array(value);
    const result = entries.map((entry) => {
        if (kind === 'id') {
            return text(entry, ID);
        }
        const path = text(entry, /^evidence\/agent-campaign\/[\p{L}\p{N}._-]+(?:\/[\p{L}\p{N}._-]+)*$/u, 512);
        if (posix.normalize(path) !== path || path.normalize('NFC') !== path) {
            return fail();
        }
        return path;
    });
    if (new Set(result).size !== result.length) {
        return fail();
    }
    return result;
}
function json(value: unknown, seen: WeakSet<object>, depth = 0, budget = { nodes: 0 }): JsonValue {
    budget.nodes += 1;
    if (budget.nodes > 2_048 || depth > 12) {
        return fail();
    }
    if (value === null || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return text(value, /^[\s\S]*$/, 4_096);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) {
            return fail();
        }
        return value;
    }
    if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) {
        return fail();
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return array(value).map((entry) => json(entry, seen, depth + 1, budget));
    }
    const source = object(value);
    const entries = Object.entries(source);
    if (entries.some(([key]) => key.length > 80 || FORBIDDEN_KEY.test(key))) {
        return fail();
    }
    return Object.fromEntries(entries.map(([key, entry]) => [key, json(entry, seen, depth + 1, budget)]));
}
function time(value: unknown): string {
    const timestamp = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24);
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
        return fail();
    }
    return timestamp;
}
const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);
function canonicalJson(value: JsonValue): string {
    if (isJsonArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (!value || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    const entries = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`);
    return `{${entries.join(',')}}`;
}
function deepFreeze(value: unknown): void {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
}
export function validateEvidenceResultRecordV1(input: unknown): StructurallyValidatedEvidenceResultRecordV1 {
    const source = object(input, RECORD_KEYS);
    const gateOrSuiteId = text(source.gateOrSuiteId, ID);
    const assertionSource = object(source.assertionTotals, ['failed', 'notApplicable', 'passed', 'total']);
    const assertionTotals = {
        passed: integer(assertionSource.passed),
        failed: integer(assertionSource.failed),
        notApplicable: integer(assertionSource.notApplicable),
        total: integer(assertionSource.total),
    };
    if (assertionTotals.total !== assertionTotals.passed + assertionTotals.failed + assertionTotals.notApplicable) {
        return fail();
    }
    const exit = source.exitStatus === null ? null : object(source.exitStatus);
    let exitStatus: ExitStatus = null;
    if (exit) {
        if (exit.kind === 'exit') {
            object(exit, ['code', 'kind']);
            exitStatus = { kind: 'exit', code: integer(exit.code, 255) };
        } else if (exit.kind === 'signal') {
            object(exit, ['kind', 'signal']);
            exitStatus = { kind: 'signal', signal: text(exit.signal, SIGNAL) };
        } else {
            return fail();
        }
    }
    const stdoutSha256 = source.stdoutSha256 === null ? null : text(source.stdoutSha256, HEX);
    const stderrSha256 = source.stderrSha256 === null ? null : text(source.stderrSha256, HEX);
    const startedAt = time(source.startedAt);
    const endedAt = time(source.endedAt);
    const status = text(source.status, /^(?:passed|failed|not-applicable)$/) as EvidenceResultRecordV1['status'];
    const metricSamples = json(source.metricSamples, new WeakSet()) as JsonValue[];
    const aggregates = json(source.aggregates, new WeakSet());
    if (
        !Array.isArray(metricSamples) ||
        aggregates === null ||
        Array.isArray(aggregates) ||
        typeof aggregates !== 'object'
    ) {
        return fail();
    }
    const record: EvidenceResultRecordV1 = {
        schemaVersion: source.schemaVersion === 1 ? 1 : fail(),
        resultId: source.resultId === `result.${gateOrSuiteId}` ? source.resultId : fail(),
        gateOrSuiteId,
        integratedCommit: text(source.integratedCommit, COMMIT),
        policySha256: text(source.policySha256, HEX),
        packageSha256: text(source.packageSha256, HEX),
        runEnvelopeSha256: text(source.runEnvelopeSha256, HEX),
        fixtureIds: stringList(source.fixtureIds, 'id'),
        status,
        startedAt,
        endedAt,
        exitStatus,
        stdoutSha256,
        stderrSha256,
        assertionTotals,
        metricSamples,
        aggregates,
        rawSamplePaths: stringList(source.rawSamplePaths, 'path'),
        environmentMatch: typeof source.environmentMatch === 'boolean' ? source.environmentMatch : fail(),
        capabilityDecision:
            source.capabilityDecision === 'applicable' || source.capabilityDecision === 'not-applicable'
                ? source.capabilityDecision
                : fail(),
        reviewerDisposition:
            source.reviewerDisposition === 'accepted' ||
            source.reviewerDisposition === 'rejected' ||
            source.reviewerDisposition === 'pending'
                ? source.reviewerDisposition
                : fail(),
    };
    const noEvidence =
        !exitStatus &&
        !stdoutSha256 &&
        !stderrSha256 &&
        assertionTotals.total === 0 &&
        metricSamples.length === 0 &&
        Object.keys(aggregates).length === 0 &&
        record.rawSamplePaths.length === 0;
    const passed =
        exitStatus?.kind === 'exit' &&
        exitStatus.code === 0 &&
        stdoutSha256 &&
        stderrSha256 &&
        assertionTotals.failed === 0 &&
        record.environmentMatch &&
        record.capabilityDecision === 'applicable';
    const streamDigestsCoherent = Boolean(stdoutSha256) === Boolean(stderrSha256);
    if (
        Date.parse(endedAt) < Date.parse(startedAt) ||
        !streamDigestsCoherent ||
        (status === 'passed' && !passed) ||
        (status === 'not-applicable' && (record.capabilityDecision !== 'not-applicable' || !noEvidence)) ||
        (status !== 'not-applicable' && record.capabilityDecision !== 'applicable')
    ) {
        return fail();
    }
    const bytes = `${canonicalJson(record)}\n`;
    if (Buffer.byteLength(bytes) > 262_144) {
        return fail();
    }
    deepFreeze(record);
    validated.add(record);
    return record as StructurallyValidatedEvidenceResultRecordV1;
}
export function serializeEvidenceResultRecordV1(record: StructurallyValidatedEvidenceResultRecordV1): string {
    if (!validated.has(record)) {
        return fail();
    }
    return `${canonicalJson(record)}\n`;
}
export function digestEvidenceResultRecordV1(record: StructurallyValidatedEvidenceResultRecordV1): string {
    return createHash('sha256').update(serializeEvidenceResultRecordV1(record)).digest('hex');
}
export function parseEvidenceResultRecordV1(source: unknown): StructurallyValidatedEvidenceResultRecordV1 {
    if (typeof source !== 'string' || source.length > 262_144) {
        return fail();
    }
    if (!source.endsWith('\n') || source.includes('\r') || Buffer.byteLength(source) > 262_144) {
        return fail();
    }
    try {
        const record = validateEvidenceResultRecordV1(JSON.parse(source));
        return serializeEvidenceResultRecordV1(record) === source ? record : fail();
    } catch {
        return fail();
    }
}
