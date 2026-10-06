/**
 * The per-mode assessment arrays a stored report carries, read back under validation.
 *
 * `report.ts` owns the report's shape and its scope arithmetic, and both were at their size ceilings, so
 * the two mode-specific readers live here — the same reason `reporting.ts` exists. Nothing here derives
 * a verdict: a malformed outcome, probability, or confidence is refused rather than rendered.
 */

import { assertNonEmptyString, refuse } from './contracts.ts';
import { SCAN_OUTCOMES, type SemanticRuleId } from './rules.ts';

import type { FindingAssessment, ScanAssessment } from './interpret.ts';

/** The outcomes a scan signal may carry, read as a set so an unknown one is refused rather than trusted. */
const SCAN_OUTCOME_SET: ReadonlySet<string> = new Set(SCAN_OUTCOMES);

function readProbabilities<Label extends string>(
    value: unknown,
    labels: readonly Label[],
    label: string
): Record<Label, number> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const probabilities = {} as Record<Label, number>;
    for (const name of labels) {
        const entry = record[name];
        if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1) {
            refuse('invalid_response', `${label}.${name} must be a finite probability in [0, 1]`);
        }
        probabilities[name] = entry;
    }
    return probabilities;
}

export function readStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== 'string') {
            refuse('invalid_response', `${label}[${String(index)}] must be a string`);
        }
        return entry;
    });
}

export function readScanAssessments(value: unknown): ScanAssessment[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', 'scan report signals must be an array');
    }
    return value.map((entry, index) => {
        const label = `signals[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null) {
            refuse('invalid_response', `${label} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (!SCAN_OUTCOME_SET.has(record.outcome as string)) {
            refuse('invalid_response', `${label}.outcome is not a known scan outcome`);
        }
        if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) {
            refuse('invalid_response', `${label}.confidence must be a finite number`);
        }
        if (typeof record.probability !== 'number' || !Number.isFinite(record.probability)) {
            refuse('invalid_response', `${label}.probability must be a finite number`);
        }
        if (record.probability < 0 || record.probability > 1) {
            refuse('invalid_response', `${label}.probability must be in [0, 1]`);
        }
        return {
            ruleId: assertNonEmptyString(record.ruleId, `${label}.ruleId`) as SemanticRuleId,
            unitId: assertNonEmptyString(record.unitId, `${label}.unitId`),
            path: assertNonEmptyString(record.path, `${label}.path`),
            outcome: record.outcome as ScanAssessment['outcome'],
            probability: record.probability,
            confidence: record.confidence,
            disposition: assertNonEmptyString(
                record.disposition,
                `${label}.disposition`
            ) as ScanAssessment['disposition'],
            investigationCategory: assertNonEmptyString(
                record.investigationCategory,
                `${label}.investigationCategory`
            ) as ScanAssessment['investigationCategory'],
            missingEvidence: readStringArray(record.missingEvidence, `${label}.missingEvidence`),
            reasoning: assertNonEmptyString(record.reasoning, `${label}.reasoning`),
        };
    });
}

export function readFindingAssessments(value: unknown): FindingAssessment[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', 'verify report findingAssessments must be an array');
    }
    return value.map((entry, index) => {
        const label = `findingAssessments[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null) {
            refuse('invalid_response', `${label} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.escalate !== 'boolean') {
            refuse('invalid_response', `${label}.escalate must be a boolean`);
        }
        return {
            findingId: assertNonEmptyString(record.findingId, `${label}.findingId`),
            support: readAssessmentPart(
                record.support,
                ['supported', 'contradicted', 'insufficient_context'],
                `${label}.support`
            ),
            attribution: readAssessmentPart(
                record.attribution,
                ['introduced_by_change', 'pre_existing', 'undetermined'],
                `${label}.attribution`
            ),
            kind: readAssessmentPart(
                record.kind,
                ['behavioral_or_contract_issue', 'style_preference', 'undetermined'],
                `${label}.kind`
            ),
            disposition: assertNonEmptyString(
                record.disposition,
                `${label}.disposition`
            ) as FindingAssessment['disposition'],
            escalate: record.escalate,
            strongestEvidenceIds: readStringArray(record.strongestEvidenceIds, `${label}.strongestEvidenceIds`),
            reasoning: assertNonEmptyString(record.reasoning, `${label}.reasoning`),
        };
    });
}

function readAssessmentPart<Outcome extends string>(
    value: unknown,
    labels: readonly Outcome[],
    label: string
): { outcome: Outcome; probabilities: Record<Outcome, number>; confidence: number } {
    if (typeof value !== 'object' || value === null) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) {
        refuse('invalid_response', `${label}.confidence must be a finite number`);
    }
    const known: readonly string[] = labels;
    if (!known.includes(record.outcome as string)) {
        refuse('invalid_response', `${label}.outcome is not a known value`);
    }
    return {
        outcome: record.outcome as Outcome,
        probabilities: readProbabilities(record.probabilities, labels, `${label}.probabilities`),
        confidence: record.confidence,
    };
}
