/// <reference types="node" />
import { types } from 'node:util';

import {
    digestEvidenceResultRecordV1,
    serializeEvidenceResultRecordV1,
    type StructurallyValidatedEvidenceResultRecordV1,
} from './evidenceResultRecord.ts';

export type TrustedEvidenceResultBindingContextV1 = {
    readonly schemaVersion: 1;
    readonly resultId: string;
    readonly gateOrSuiteId: string;
    readonly integratedCommit: string;
    /** SHA-256 of the canonical loaded policy bytes. */
    readonly policySha256: string;
    /** Trusted composition reads createEvidencePolicy().identity.governingHashes.campaignIndex. */
    readonly packageSha256: string;
    /** SHA-256 of the validated run-envelope bytes. */
    readonly runEnvelopeSha256: string;
    readonly declaredFixtureIds: readonly string[];
    /** Derived by trusted composition from frozen target requiredWhen and capability/platform inventory. */
    readonly expectedCapabilityDecision: 'applicable' | 'not-applicable';
};

declare const contextBoundEvidenceResult: unique symbol;
export type ContextBoundEvidenceResultRecordV1 = StructurallyValidatedEvidenceResultRecordV1 & {
    readonly [contextBoundEvidenceResult]: true;
};

const bound = new WeakSet<object>();
const HEX = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^(?:AC-\d{3}|PG-\d{3}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const CONTEXT_KEYS =
    'declaredFixtureIds,expectedCapabilityDecision,gateOrSuiteId,integratedCommit,packageSha256,policySha256,resultId,runEnvelopeSha256,schemaVersion'.split(
        ','
    );

export class EvidenceResultBindingError extends Error {
    public constructor() {
        super('invalid evidence result binding');
        this.name = 'EvidenceResultBindingError';
    }
}

function fail(): never {
    throw new EvidenceResultBindingError();
}

function plainObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) {
        return fail();
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== CONTEXT_KEYS.length ||
        keys.some((key) => typeof key === 'symbol') ||
        Object.getPrototypeOf(value) !== Object.prototype
    ) {
        return fail();
    }
    const actual = keys.map(String).sort();
    if (actual.some((key, index) => key !== CONTEXT_KEYS[index])) {
        return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !('value' in descriptor))) {
        return fail();
    }
    return value as Record<string, unknown>;
}

function text(value: unknown, pattern: RegExp, maximum = 256): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || !pattern.test(value)) {
        return fail();
    }
    return value;
}

function fixtureIds(value: unknown): readonly string[] {
    if (types.isProxy(value) || !Array.isArray(value) || value.length > 256) {
        return fail();
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== value.length + 1 ||
        keys.some((key) => typeof key === 'symbol') ||
        keys.at(-1) !== 'length' ||
        keys.slice(0, -1).some((key, index) => key !== String(index)) ||
        Object.getPrototypeOf(value) !== Array.prototype
    ) {
        return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) {
        return fail();
    }
    const result = value.map((entry) => text(entry, ID));
    if (new Set(result).size !== result.length) {
        return fail();
    }
    return result;
}

function validateContext(value: unknown): TrustedEvidenceResultBindingContextV1 {
    const source = plainObject(value);
    const gateOrSuiteId = text(source.gateOrSuiteId, ID);
    const resultId = source.resultId === `result.${gateOrSuiteId}` ? source.resultId : fail();
    return Object.freeze({
        schemaVersion: source.schemaVersion === 1 ? 1 : fail(),
        resultId,
        gateOrSuiteId,
        integratedCommit: text(source.integratedCommit, COMMIT),
        policySha256: text(source.policySha256, HEX),
        packageSha256: text(source.packageSha256, HEX),
        runEnvelopeSha256: text(source.runEnvelopeSha256, HEX),
        declaredFixtureIds: Object.freeze([...fixtureIds(source.declaredFixtureIds)]),
        expectedCapabilityDecision:
            source.expectedCapabilityDecision === 'applicable' || source.expectedCapabilityDecision === 'not-applicable'
                ? source.expectedCapabilityDecision
                : fail(),
    });
}

/**
 * Proves exact equality to the supplied trusted composition context; it does not authenticate caller-created context.
 * Trusted composition must populate hash fields from their documented canonical policy and envelope sources.
 */
export function bindEvidenceResultRecordV1(
    record: StructurallyValidatedEvidenceResultRecordV1,
    context: unknown
): ContextBoundEvidenceResultRecordV1 {
    try {
        serializeEvidenceResultRecordV1(record);
    } catch {
        return fail();
    }
    const trusted = validateContext(context);
    const bindingMismatch =
        record.resultId !== trusted.resultId ||
        record.gateOrSuiteId !== trusted.gateOrSuiteId ||
        record.integratedCommit !== trusted.integratedCommit ||
        record.policySha256 !== trusted.policySha256 ||
        record.packageSha256 !== trusted.packageSha256 ||
        record.runEnvelopeSha256 !== trusted.runEnvelopeSha256 ||
        record.capabilityDecision !== trusted.expectedCapabilityDecision ||
        record.fixtureIds.some((fixtureId) => !trusted.declaredFixtureIds.includes(fixtureId)) ||
        record.rawSamplePaths.some((path) => !path.startsWith('evidence/agent-campaign/'));
    if (bindingMismatch) {
        return fail();
    }
    bound.add(record);
    return record as ContextBoundEvidenceResultRecordV1;
}

export function serializeContextBoundEvidenceResultRecordV1(record: ContextBoundEvidenceResultRecordV1): string {
    if (!bound.has(record)) {
        return fail();
    }
    return serializeEvidenceResultRecordV1(record);
}

export function digestContextBoundEvidenceResultRecordV1(record: ContextBoundEvidenceResultRecordV1): string {
    if (!bound.has(record)) {
        return fail();
    }
    return digestEvidenceResultRecordV1(record);
}
