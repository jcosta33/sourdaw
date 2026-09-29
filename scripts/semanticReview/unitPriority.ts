/**
 * The admission priority of one planned unit: the deterministic key that decides which units a binding
 * budget or deadline reaches first, and the published record of that decision.
 *
 * Path order alone decided admission, so a run that stopped on its deadline or its byte total omitted
 * whichever units happened to sort last — broad test churn as readily as a realtime or project-integrity
 * unit, and a rename could move a unit across that line. The key below reads the risk the plan already
 * knows: the investigation categories its rules carry, whether the file is production or test material,
 * and how much of the questions' required evidence the unit actually carries. Path order survives only
 * as the final tie-break, so it orders equals and never decides between classes.
 *
 * No reserved quota sits beside this ordering. A quota would admit a severe unit even when the plan
 * holds nothing else, but ordering already gives every severe unit and every production unit precedence
 * over broad test churn, and a binding budget is exactly the case where the order — not a second
 * mechanism — decides. A quota would also make the admitted set depend on a count the operator sets
 * rather than on the plan's own keys, which is the non-determinism this key exists to remove.
 *
 * The published half lives here rather than in `report.ts` because that module is at its size ceiling,
 * the same reason `reporting.ts` exists; the shape it publishes is part of the report.
 */

import { isUnitPriorityClass, refuse, type SemanticScopeExclusion, type UnitPriorityClass } from './contracts.ts';
import { compareByPath } from './evidence.ts';
import { bestPassMissingEvidence, type UnitQuestionPlan } from './passes.ts';
import {
    isSemanticRuleId,
    isTestPath,
    SEVERE_INVESTIGATION_CATEGORIES,
    type SemanticRule,
    type SemanticRuleId,
} from './rules.ts';

/** The escalation classes, read as a set so a rule's category joins the key by membership, never by a cast. */
const SEVERE_CATEGORIES: ReadonlySet<string> = new Set(SEVERE_INVESTIGATION_CATEGORIES);

/**
 * The class this unit's key places it in. A severe rule's investigation category is the strongest signal
 * the plan carries, and production material outranks test-only material within it: a test unit asks
 * test-validity questions, while a production unit can carry the change's behaviour.
 */
export function unitPriorityClass(unit: {
    readonly path: string;
    readonly rules: readonly SemanticRule[];
}): UnitPriorityClass {
    const severe = unit.rules.some((rule) => SEVERE_CATEGORIES.has(rule.investigationCategory));
    const test = isTestPath(unit.path);
    if (severe) {
        return test ? 'severe-test' : 'severe-production';
    }
    return test ? 'test' : 'production';
}

/** The classes in admission order, most-preferred first. */
const PRIORITY_RANK: Readonly<Record<UnitPriorityClass, number>> = {
    'severe-production': 0,
    'severe-test': 1,
    production: 2,
    test: 3,
};

/**
 * The required-evidence tokens no pass of this unit carries, summed over its rules: a unit whose
 * questions can be answered from what it carries ranks ahead of one whose requests would buy discarded
 * answers. It reads the same per-pass measure the requests themselves are filtered by.
 */
export function unitMissingRequiredEvidenceTokens(unit: UnitQuestionPlan): number {
    return unit.rules.reduce(
        (total, rule) =>
            total + bestPassMissingEvidence({ rule, kind: unit.file.kind, evidence: unit.evidence }).length,
        0
    );
}

/**
 * The admission key, total and deterministic: class first, then the fewer-missing-evidence measure, then
 * the path as the final tie-break. Two plans that differ only by an unrelated rename keep the same
 * classes and the same measure, so the rename cannot move a unit across a binding budget.
 */
export function compareUnitPriority(left: UnitQuestionPlan, right: UnitQuestionPlan): number {
    const byClass = PRIORITY_RANK[unitPriorityClass(left)] - PRIORITY_RANK[unitPriorityClass(right)];
    if (byClass !== 0) {
        return byClass;
    }
    const byEvidence = unitMissingRequiredEvidenceTokens(left) - unitMissingRequiredEvidenceTokens(right);
    if (byEvidence !== 0) {
        return byEvidence;
    }
    return compareByPath(left, right);
}

/** The planned units in admission order. The input order is not read: the key is total, so it never leaks. */
export function orderPlannedUnits<Unit extends UnitQuestionPlan>(units: readonly Unit[]): Unit[] {
    return [...units].sort(compareUnitPriority);
}

/**
 * One eligible unit as the report publishes it: where admission placed it and what placed it there. The
 * counts are the key's two evidence-bearing components, so an operator can see why a unit was admitted
 * or omitted without replaying the sort.
 */
export type SemanticPlannedRequest = {
    readonly path: string;
    readonly priorityClass: UnitPriorityClass;
    /** Required-evidence tokens no pass of this unit carries; an unasked rule reports these. */
    readonly missingRequiredEvidenceTokens: number;
    /** Rules at least one pass can answer, which are the questions the unit's requests may contain. */
    readonly answerableRules: number;
    readonly ruleIds: readonly SemanticRuleId[];
};

/**
 * The report's record of one eligible unit admission never assessed, with the class that placed it: an
 * operator reads why a unit was omitted from its reason and the class the ordering key gave it.
 */
export function unitOmission(unit: UnitQuestionPlan, reason: string): SemanticScopeExclusion {
    return { path: unit.path, reason, priorityClass: unitPriorityClass(unit) };
}

/** The published entry for one planned unit, read from the same key the admission order sorts by. */
export function plannedRequest(unit: UnitQuestionPlan): SemanticPlannedRequest {
    return {
        path: unit.path,
        priorityClass: unitPriorityClass(unit),
        missingRequiredEvidenceTokens: unitMissingRequiredEvidenceTokens(unit),
        answerableRules: unit.rules.filter(
            (rule) => bestPassMissingEvidence({ rule, kind: unit.file.kind, evidence: unit.evidence }).length === 0
        ).length,
        ruleIds: unit.rules.map((rule) => rule.id),
    };
}

/**
 * Reads the published order back. Absent is a report written before the field existed, which stays
 * valid; a present value is validated in full, so a foreign or hand-edited order cannot pass as one
 * this planner produced.
 */
export function readPlannedRequests(value: unknown, label: string): readonly SemanticPlannedRequest[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        const at = `${label}[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            refuse('invalid_response', `${at} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.path !== 'string' || record.path === '') {
            refuse('invalid_response', `${at}.path must be a non-empty string`);
        }
        const priorityClass = record.priorityClass;
        if (!isUnitPriorityClass(priorityClass)) {
            refuse('invalid_response', `${at}.priorityClass is not a known priority class`);
        }
        return {
            path: record.path,
            priorityClass,
            missingRequiredEvidenceTokens: readCount(
                record.missingRequiredEvidenceTokens,
                `${at}.missingRequiredEvidenceTokens`
            ),
            answerableRules: readCount(record.answerableRules, `${at}.answerableRules`),
            ruleIds: readRuleIds(record.ruleIds, `${at}.ruleIds`),
        };
    });
}

function readCount(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        refuse('invalid_response', `${label} must be a non-negative safe integer`);
    }
    return value as number;
}

function readRuleIds(value: unknown, label: string): SemanticRuleId[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== 'string' || !isSemanticRuleId(entry)) {
            refuse('invalid_response', `${label}[${String(index)}] is not a known rule id`);
        }
        return entry;
    });
}
