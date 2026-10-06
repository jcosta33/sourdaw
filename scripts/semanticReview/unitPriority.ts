/**
 * The admission priority of one planned unit: the deterministic key that decides which units a binding
 * budget or deadline reaches first.
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
 * The published half — the entry shape and the checks a stored plan must satisfy — lives in
 * `planPublication.ts`, so the report validator can hold a stored plan to this key without reaching the
 * collector and provider modules this file reads for the measure itself.
 */

import { type SemanticScopeExclusion, type UnitPriorityClass } from './contracts.ts';
import { bestPassMissingEvidence, type UnitQuestionPlan } from './passes.ts';
import { compareAdmissionKeys, type SemanticPlannedRequest } from './planPublication.ts';
import { isTestPath, SEVERE_INVESTIGATION_CATEGORIES } from './rules.ts';

/** The escalation classes, read as a set so a rule's category joins the key by membership, never by a cast. */
const SEVERE_CATEGORIES: ReadonlySet<string> = new Set(SEVERE_INVESTIGATION_CATEGORIES);

/**
 * The class this unit's key places it in. A severe rule's investigation category is the strongest signal
 * the plan carries, and production material outranks test-only material within it: a test unit asks
 * test-validity questions, while a production unit can carry the change's behaviour.
 *
 * A unit is test-only only when every path the change offers it is a test path. The planner admits a
 * rename's rules from both offered paths, so classifying from the destination alone let a production
 * file renamed into a test directory drop behind every production unit: the rename, not the risk,
 * decided what a binding budget assessed. A cross-boundary rename keeps the production class whichever
 * way it crosses, which is the safe side of the line — it carries a production path's questions.
 */
export function unitPriorityClass(unit: UnitQuestionPlan): UnitPriorityClass {
    const severe = unit.rules.some((rule) => SEVERE_CATEGORIES.has(rule.investigationCategory));
    const test = offeredPaths(unit).every(isTestPath);
    if (severe) {
        return test ? 'severe-test' : 'severe-production';
    }
    return test ? 'test' : 'production';
}

/** Every path the change offers for a unit: its destination, and a rename's previous path. */
function offeredPaths(unit: UnitQuestionPlan): string[] {
    return unit.file.previousPath === undefined ? [unit.path] : [unit.path, unit.file.previousPath];
}

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
 * the path as the final tie-break. The class reads every path the change offers, so a rename keeps it;
 * the measure moves only when the rename changes which rules apply or what evidence the unit carries,
 * and the path itself is reached only by two units that already key identically.
 */
export function compareUnitPriority(left: UnitQuestionPlan, right: UnitQuestionPlan): number {
    return compareAdmissionKeys(
        {
            path: left.path,
            priorityClass: unitPriorityClass(left),
            missingRequiredEvidenceTokens: unitMissingRequiredEvidenceTokens(left),
        },
        {
            path: right.path,
            priorityClass: unitPriorityClass(right),
            missingRequiredEvidenceTokens: unitMissingRequiredEvidenceTokens(right),
        }
    );
}

/** The planned units in admission order. The input order is not read: the key is total, so it never leaks. */
export function orderPlannedUnits<Unit extends UnitQuestionPlan>(units: readonly Unit[]): Unit[] {
    return [...units].sort(compareUnitPriority);
}

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

/** The published entry shape, re-exported so a producer names one module for what it builds. */
export type { SemanticPlannedRequest } from './planPublication.ts';
