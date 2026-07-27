import { describe, expect, expectTypeOf, it } from 'vitest';

import {
    digestEvidenceResultRecordV1 as digestRecord,
    parseEvidenceResultRecordV1,
    serializeEvidenceResultRecordV1,
    validateEvidenceResultRecordV1,
    type StructurallyValidatedEvidenceResultRecordV1,
} from '../evidenceResultRecord';

const hash = 'a'.repeat(64);
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
function valid(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        resultId: 'result.AC-060',
        gateOrSuiteId: 'AC-060',
        integratedCommit: 'b'.repeat(40),
        policySha256: hash,
        packageSha256: 'c'.repeat(64),
        runEnvelopeSha256: 'd'.repeat(64),
        fixtureIds: ['fixture-one'],
        status: 'passed',
        startedAt: '2026-07-27T10:00:00.000Z',
        endedAt: '2026-07-27T10:00:01.000Z',
        exitStatus: { kind: 'exit', code: 0 },
        stdoutSha256: emptyHash,
        stderrSha256: emptyHash,
        assertionTotals: { passed: 1, failed: 0, notApplicable: 0, total: 1 },
        metricSamples: [{ latencyMs: 12.5 }],
        aggregates: { p95Ms: 12.5 },
        rawSamplePaths: ['evidence/agent-campaign/raw/café.json'],
        environmentMatch: true,
        capabilityDecision: 'applicable',
        reviewerDisposition: 'accepted',
    };
}
const FIXED_ERROR = 'EvidenceResultRecordError: invalid evidence result record';
const rejection = (operation: () => unknown): string => {
    try {
        operation();
        return '';
    } catch (error) {
        return String(error);
    }
};
const recordRejection = (value: unknown): string => rejection(() => validateEvidenceResultRecordV1(value));
const rejected = (value: unknown): boolean => recordRejection(value) === FIXED_ERROR;
describe('evidence result record v1', () => {
    it('should round-trip canonical immutable bytes and bind their digest', () => {
        const record = validateEvidenceResultRecordV1(valid());
        const source = serializeEvidenceResultRecordV1(record);
        const parsed = parseEvidenceResultRecordV1(source);
        expect([source.endsWith('\n'), source.includes('\n', 0), Object.isFrozen(record.aggregates)]).toEqual([
            true,
            true,
            true,
        ]);
        expect(serializeEvidenceResultRecordV1(parsed)).toBe(source);
        expect(digestRecord(record)).toBe('45bbeb25b5c97c6102c62f1c99d4bc25474fb3ed95f914322783bed34e061620');
        expectTypeOf(record.metricSamples).not.toMatchTypeOf<{ push(value: unknown): unknown }>();
        expect(() => Object.defineProperty(record.metricSamples, '0', { value: { latencyMs: 1 } })).toThrow();
    });
    it('should accept decisive failed and evidence-free not-applicable records', () => {
        const failed = valid();
        failed.status = 'failed';
        failed.exitStatus = null;
        failed.stdoutSha256 = null;
        failed.stderrSha256 = null;
        failed.assertionTotals = { passed: 0, failed: 0, notApplicable: 0, total: 0 };
        const notApplicable = valid();
        Object.assign(notApplicable, {
            status: 'not-applicable',
            exitStatus: null,
            stdoutSha256: null,
            stderrSha256: null,
            assertionTotals: { passed: 0, failed: 0, notApplicable: 0, total: 0 },
            metricSamples: [],
            aggregates: {},
            rawSamplePaths: [],
            capabilityDecision: 'not-applicable',
        });
        expect([failed, notApplicable].map((value) => validateEvidenceResultRecordV1(value).status)).toEqual([
            'failed',
            'not-applicable',
        ]);
    });
    it('should reject strict field, binding, time, count, status, path, and JSON boundary violations', () => {
        const hiddenDescriptors = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [i, { value: i }]));
        const oversizedObject = Object.defineProperties({}, hiddenDescriptors);
        const variants = [
            { ...valid(), extra: 'private' },
            { ...valid(), schemaVersion: 2 },
            { ...valid(), resultId: 'result.PG-001' },
            { ...valid(), integratedCommit: 'A'.repeat(40) },
            { ...valid(), policySha256: '0'.repeat(63) },
            { ...valid(), startedAt: '2026-07-27T10:00:00.000Zx' },
            { ...valid(), endedAt: '2026-07-27T09:59:59.000Z' },
            { ...valid(), exitStatus: { kind: 'exit', code: 256 } },
            { ...valid(), exitStatus: { kind: 'exit', code: 1 } },
            { ...valid(), stdoutSha256: '0'.repeat(63) },
            { ...valid(), stdoutSha256: null },
            { ...valid(), status: 'failed', exitStatus: null, stdoutSha256: null },
            { ...valid(), assertionTotals: { passed: 1, failed: 1, notApplicable: 0, total: 1 } },
            { ...valid(), status: 'passed', environmentMatch: false },
            { ...valid(), status: 'not-applicable', capabilityDecision: 'not-applicable' },
            { ...valid(), status: 'failed', capabilityDecision: 'not-applicable' },
            { ...valid(), fixtureIds: ['fixture-one', 'fixture-one'] },
            { ...valid(), rawSamplePaths: ['../private/file'] },
            { ...valid(), rawSamplePaths: ['evidence/agent-campaign/raw/bad\nname.json'] },
            { ...valid(), rawSamplePaths: ['evidence/agent-campaign/raw/cafe\u0301.json'] },
            { ...valid(), rawSamplePaths: ['evidence/agent-campaign/raw/same', 'evidence/agent-campaign/raw/same'] },
            { ...valid(), aggregates: { score: Number.NaN } },
            { ...valid(), aggregates: { score: -0 } },
            { ...valid(), aggregates: null },
            { ...valid(), aggregates: { rawOutput: 'private' } },
            { ...valid(), aggregates: JSON.parse('{"__proto__":{"private-token":"x"}}') as unknown },
            { ...valid(), aggregates: oversizedObject },
            { ...valid(), metricSamples: Array.from({ length: 257 }, () => 0) },
            { ...valid(), metricSamples: ['x'.repeat(4_097)] },
        ];
        expect(variants.map(rejected).every(Boolean)).toBe(true);
    });
    it('should reject hostile objects without invoking their code or leaking private values', () => {
        let accessorCalls = 0;
        let proxyCalls = 0;
        let toJsonCalls = 0;
        const accessor = Object.defineProperty(valid(), 'status', {
            enumerable: true,
            get: () => {
                accessorCalls += 1;
                return 'passed';
            },
        });
        const proxy = new Proxy(valid(), {
            get: (target, key) => {
                proxyCalls += 1;
                return target[key as keyof typeof target];
            },
        });
        const revokedObject = Proxy.revocable({ ...valid(), privateToken: 'private-token' }, {});
        const revokedArray = Proxy.revocable(['private-token'], {});
        revokedObject.revoke();
        revokedArray.revoke();
        const withRevokedArray = { ...valid(), metricSamples: revokedArray.proxy };
        const withToJson = valid();
        withToJson.aggregates = { toJSON: () => (toJsonCalls += 1) };
        const withSymbol = valid();
        Object.defineProperty(withSymbol, Symbol('private-token'), { value: 'private-token' });
        const withHiddenArray = valid();
        const hiddenSamples = [{ score: 1 }];
        Object.defineProperty(hiddenSamples, 'hidden-private-token', { value: { toJSON: () => (toJsonCalls += 1) } });
        withHiddenArray.metricSamples = hiddenSamples;
        const cycle = valid();
        cycle.aggregates = {};
        (cycle.aggregates as Record<string, unknown>).loop = cycle.aggregates;
        const inherited = valid();
        Object.setPrototypeOf(inherited, { privateToken: 'private-token' });
        const errors = [accessor, proxy, revokedObject.proxy, withRevokedArray].map(recordRejection);
        errors.push(...[withToJson, withSymbol, withHiddenArray, cycle, inherited].map(recordRejection));
        expect([accessorCalls, proxyCalls, toJsonCalls]).toEqual([0, 0, 0]);
        expect(errors.every((error) => error === FIXED_ERROR)).toBe(true);
        expect(errors.join()).not.toContain('private-token');
    });
    it('should reject noncanonical, duplicate-key, and unvalidated serialization inputs', () => {
        const source = serializeEvidenceResultRecordV1(validateEvidenceResultRecordV1(valid()));
        const duplicate = source.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
        let parserCalls = 0;
        const hostileParser = { endsWith: () => (parserCalls += 1), includes: () => (parserCalls += 1) };
        const revokedParser = Proxy.revocable({ privateToken: 'private-token' }, {});
        revokedParser.revoke();
        const inputs = [` ${source}`, duplicate, null, hostileParser, revokedParser.proxy, 'x'.repeat(262_145)];
        const errors = inputs.map((value) => rejection(() => parseEvidenceResultRecordV1(value)));
        expect(errors.every((error) => error === FIXED_ERROR)).toBe(true);
        expect([parserCalls, errors.join().includes('private-token')]).toEqual([0, false]);
        expect(() => serializeEvidenceResultRecordV1(valid() as StructurallyValidatedEvidenceResultRecordV1)).toThrow(
            'invalid evidence result record'
        );
    });
});
