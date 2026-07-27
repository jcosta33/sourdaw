import { describe, expect, expectTypeOf, it } from 'vitest';

import { createEvidencePolicy } from '../evidenceContract';
import {
    bindEvidenceResultRecordV1,
    digestContextBoundEvidenceResultRecordV1,
    serializeContextBoundEvidenceResultRecordV1,
    type ContextBoundEvidenceResultRecordV1,
    type TrustedEvidenceResultBindingContextV1,
} from '../evidenceResultBinding';
import {
    digestEvidenceResultRecordV1,
    serializeEvidenceResultRecordV1,
    validateEvidenceResultRecordV1,
} from '../evidenceResultRecord';

const FIXED_ERROR = 'EvidenceResultBindingError: invalid evidence result binding';
const hash = 'a'.repeat(64);
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const packageSha256 = createEvidencePolicy().identity.governingHashes.campaignIndex;
function recordInput(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        resultId: 'result.AC-060',
        gateOrSuiteId: 'AC-060',
        integratedCommit: 'b'.repeat(40),
        policySha256: hash,
        packageSha256,
        runEnvelopeSha256: 'd'.repeat(64),
        fixtureIds: ['fixture-one'],
        status: 'passed',
        startedAt: '2026-07-27T10:00:00.000Z',
        endedAt: '2026-07-27T10:00:01.000Z',
        exitStatus: { kind: 'exit', code: 0 },
        stdoutSha256: emptyHash,
        stderrSha256: emptyHash,
        assertionTotals: { passed: 1, failed: 0, notApplicable: 0, total: 1 },
        metricSamples: [],
        aggregates: {},
        rawSamplePaths: ['evidence/agent-campaign/raw/AC-060.json'],
        environmentMatch: true,
        capabilityDecision: 'applicable',
        reviewerDisposition: 'accepted',
    };
}
function context(): TrustedEvidenceResultBindingContextV1 {
    return {
        schemaVersion: 1,
        resultId: 'result.AC-060',
        gateOrSuiteId: 'AC-060',
        integratedCommit: 'b'.repeat(40),
        policySha256: hash,
        packageSha256,
        runEnvelopeSha256: 'd'.repeat(64),
        declaredFixtureIds: ['fixture-one'],
        expectedCapabilityDecision: 'applicable',
    };
}
const structural = () => validateEvidenceResultRecordV1(recordInput());
function notApplicableStructural() {
    const input = recordInput();
    Object.assign(input, {
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
    return validateEvidenceResultRecordV1(input);
}
const rejection = (operation: () => unknown): string => {
    try {
        operation();
        return '';
    } catch (error) {
        return String(error);
    }
};
const rejects = (trusted: unknown): boolean =>
    rejection(() => bindEvidenceResultRecordV1(structural(), trusted)) === FIXED_ERROR;

describe('evidence result trusted binding boundary', () => {
    it('should preserve the exact frozen object, canonical bytes, digest, and readonly contract', () => {
        const record = structural();
        const bytes = serializeEvidenceResultRecordV1(record);
        const digest = digestEvidenceResultRecordV1(record);
        expect(() => serializeContextBoundEvidenceResultRecordV1(record as ContextBoundEvidenceResultRecordV1)).toThrow(
            'invalid evidence result binding'
        );
        const result = bindEvidenceResultRecordV1(record, context());
        expect([
            result === record,
            Object.isFrozen(result),
            serializeContextBoundEvidenceResultRecordV1(result),
        ]).toEqual([true, true, bytes]);
        expect(digestContextBoundEvidenceResultRecordV1(result)).toBe(digest);
        expectTypeOf(result.fixtureIds).not.toMatchTypeOf<{ push(value: unknown): unknown }>();
        expectTypeOf(context().declaredFixtureIds).not.toMatchTypeOf<{ push(value: unknown): unknown }>();
    });
    it('should reject every identity/hash mismatch and invalid context relationship', () => {
        const variants = [
            { ...context(), schemaVersion: 2 },
            { ...context(), resultId: 'result.PG-001' },
            { ...context(), gateOrSuiteId: 'PG-001', resultId: 'result.PG-001' },
            { ...context(), integratedCommit: 'e'.repeat(40) },
            { ...context(), policySha256: 'e'.repeat(64) },
            { ...context(), packageSha256: 'e'.repeat(64) },
            { ...context(), runEnvelopeSha256: 'e'.repeat(64) },
            { ...context(), expectedCapabilityDecision: 'unknown' },
        ];
        expect(variants.map(rejects).every(Boolean)).toBe(true);
    });
    it('should reject capability self-waivers and bind a matching trusted not-applicable decision', () => {
        const record = notApplicableStructural();
        expect(rejection(() => bindEvidenceResultRecordV1(record, context()))).toBe(FIXED_ERROR);
        const result = bindEvidenceResultRecordV1(record, {
            ...context(),
            expectedCapabilityDecision: 'not-applicable',
        });
        expect(result.capabilityDecision).toBe('not-applicable');
    });
    it('should require unique, bounded declarations covering every record fixture', () => {
        const variants = [
            { ...context(), declaredFixtureIds: [] },
            { ...context(), declaredFixtureIds: ['fixture-one', 'fixture-one'] },
            { ...context(), declaredFixtureIds: Array.from({ length: 257 }, (_, index) => `fixture-${index}`) },
        ];
        expect(variants.map(rejects)).toEqual([true, true, true]);
    });
    it('should reject hostile contexts without executing or exposing their private values', () => {
        let calls = 0;
        const accessor = Object.defineProperty(context(), 'policySha256', {
            enumerable: true,
            get: () => {
                calls += 1;
                return 'private-token';
            },
        });
        const proxied = new Proxy(context(), {
            get: (target, key) => {
                calls += 1;
                return target[key as keyof typeof target];
            },
        });
        const revoked = Proxy.revocable({ ...context(), privateToken: 'private-token' }, {});
        revoked.revoke();
        const symbol = context();
        Object.defineProperty(symbol, Symbol('private-token'), { value: 'private-token' });
        const hidden = Object.defineProperty(context(), 'hidden-private-token', { value: 'private-token' });
        const inherited = context();
        Object.setPrototypeOf(inherited, { privateToken: 'private-token' });
        const unknown = { ...context(), extra: 'private-token' };
        const missing = context() as Record<string, unknown>;
        delete missing.packageSha256;
        const errors = [accessor, proxied, revoked.proxy, symbol, hidden, inherited, unknown, missing].map((value) =>
            rejection(() => bindEvidenceResultRecordV1(structural(), value))
        );
        expect([calls, errors.every((error) => error === FIXED_ERROR)]).toEqual([0, true]);
        expect(errors.join()).not.toContain('private-token');
    });
    it('should reject forged bound values and hostile declared-fixture arrays', () => {
        const record = structural();
        expect(() => serializeContextBoundEvidenceResultRecordV1(record as ContextBoundEvidenceResultRecordV1)).toThrow(
            'invalid evidence result binding'
        );
        const hidden = [...context().declaredFixtureIds];
        Object.defineProperty(hidden, 'hidden-private-token', { value: 'private-token' });
        const proxied = new Proxy([...context().declaredFixtureIds], {});
        const inherited = [...context().declaredFixtureIds];
        Object.setPrototypeOf(inherited, {});
        const errors = [hidden, proxied, inherited].map((declaredFixtureIds) =>
            rejection(() => bindEvidenceResultRecordV1(record, { ...context(), declaredFixtureIds }))
        );
        expect(errors).toEqual([FIXED_ERROR, FIXED_ERROR, FIXED_ERROR]);
    });
});
