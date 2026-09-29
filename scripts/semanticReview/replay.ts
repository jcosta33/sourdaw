/**
 * Offline reinterpretation of a stored scan: the saved answers, the report they belong to, and the
 * signals a selected policy derives from them without another provider call.
 *
 * A unit no pass could ask stores no answer, and its record names every rule with the required evidence
 * no request carried. Replay reads exactly that record, so a skipped unit replays as the same
 * insufficient-context entries the scan reported — the coverage ledger survives a replay instead of the
 * replayed report looking more complete than the run was. This module owns the stored shape and the
 * replay derivation so the command stays a thin wire and the two are testable without a provider.
 */

import { refuse } from './contracts.ts';
import { interpretScanOutcome, type ScanAssessment } from './interpret.ts';
import { type StoredUnitPass } from './passes.ts';
import { type RuleThresholds, type SemanticRuleId, semanticRule } from './rules.ts';
import { type StoredUnitResponse } from './unitAssessment.ts';

export type StoredResponses = {
    readonly contextDigest: string;
    readonly rulesDigest: string;
    readonly units: readonly StoredUnitResponse[];
};

/** A local policy file's overrides: interpretation thresholds only, never a question. */
export type PolicyOverrides = Partial<Record<SemanticRuleId, RuleThresholds>>;

/**
 * The signals a stored assessment replays to. Every rule of every stored unit is interpreted, asked or
 * not: an unanswered rule carries its recorded missing evidence, which is what makes it unresolved.
 */
export function replayScanSignals(responses: StoredResponses, overrides: PolicyOverrides = {}): ScanAssessment[] {
    return responses.units.flatMap((unit) =>
        unit.ruleIds.map((ruleId) => {
            const rule = semanticRule(ruleId);
            const thresholds = overrides[ruleId];
            return interpretScanOutcome({
                answer: unit.answers[ruleId],
                rule: thresholds === undefined ? rule : { ...rule, thresholds },
                unitId: unit.unitId,
                path: unit.path,
                missingEvidence: unit.missingEvidence[ruleId] ?? [],
            });
        })
    );
}

export function parseStoredResponses(value: unknown, label: string): StoredResponses {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const units = record.units;
    if (!Array.isArray(units)) {
        refuse('invalid_response', `${label} must carry a units array`);
    }
    if (typeof record.contextDigest !== 'string' || typeof record.rulesDigest !== 'string') {
        refuse('invalid_response', `${label} must record the identity of the assessment it belongs to`);
    }
    return {
        contextDigest: record.contextDigest,
        rulesDigest: record.rulesDigest,
        units: units.map((entry, index) => readStoredUnit(entry, `${label}.units[${String(index)}]`)),
    };
}

function readStoredUnit(entry: unknown, at: string): StoredUnitResponse {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        refuse('invalid_response', `${at} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.unitId !== 'string' || typeof record.path !== 'string') {
        refuse('invalid_response', `${at} needs unitId and path`);
    }
    if (!Array.isArray(record.ruleIds) || typeof record.answers !== 'object' || record.answers === null) {
        refuse('invalid_response', `${at} needs ruleIds and answers`);
    }
    const omissionReason = record.omissionReason;
    if (omissionReason !== undefined && typeof omissionReason !== 'string') {
        refuse('invalid_response', `${at}.omissionReason must be a string when present`);
    }
    const unit: StoredUnitResponse = {
        unitId: record.unitId,
        path: record.path,
        ruleIds: record.ruleIds as SemanticRuleId[],
        answers: record.answers as Record<string, unknown>,
        missingEvidence: (record.missingEvidence ?? {}) as Record<string, readonly string[]>,
        passes: record.passes === undefined ? [] : readStoredPasses(record.passes, `${at}.passes`),
    };
    return omissionReason === undefined ? unit : { ...unit, omissionReason };
}

/** The stored passes of one unit. A skipped unit has none: no request was sent to attribute. */
function readStoredPasses(value: unknown, label: string): StoredUnitPass[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        const at = `${label}[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            refuse('invalid_response', `${at} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.passId !== 'string' || record.passId === '') {
            refuse('invalid_response', `${at} needs a passId`);
        }
        if (!Array.isArray(record.evidenceIds) || !Array.isArray(record.answerRuleIds)) {
            refuse('invalid_response', `${at} needs evidenceIds and answerRuleIds arrays`);
        }
        return {
            passId: record.passId,
            evidenceIds: record.evidenceIds as string[],
            answerRuleIds: record.answerRuleIds as SemanticRuleId[],
        };
    });
}
