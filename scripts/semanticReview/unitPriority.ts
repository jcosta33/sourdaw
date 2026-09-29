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
import { compareLexicographic } from './evidence.ts';
import { bestPassMissingEvidence, type UnitQuestionPlan } from './passes.ts';
import { isSemanticRuleId, isTestPath, SEVERE_INVESTIGATION_CATEGORIES, type SemanticRuleId } from './rules.ts';

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

/**
 * The three fields the admission key reads, in the order it reads them. The report publishes the same
 * three for every planned unit, so the validator below holds a stored order to the key this comparator
 * defines rather than to a second, restated one.
 */
type AdmissionKey = {
    readonly path: string;
    readonly priorityClass: UnitPriorityClass;
    readonly missingRequiredEvidenceTokens: number;
};

function compareAdmissionKeys(left: AdmissionKey, right: AdmissionKey): number {
    const byClass = PRIORITY_RANK[left.priorityClass] - PRIORITY_RANK[right.priorityClass];
    if (byClass !== 0) {
        return byClass;
    }
    const byEvidence = left.missingRequiredEvidenceTokens - right.missingRequiredEvidenceTokens;
    if (byEvidence !== 0) {
        return byEvidence;
    }
    return compareLexicographic(left.path, right.path);
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
 * Reads one published order entry's shape. Shape alone proves nothing about the walk, so the report
 * follows this with `assertRequestOrderIsSorted`, which holds the entries to the admission key and to
 * the scope's own records; absent is a report written before the field existed, which stays valid.
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

/**
 * Holds a published order to the key it claims to be sorted by, and to the scope's own records.
 *
 * Enforced: the entries are distinct; they cover exactly the eligible units; no entry names a path the
 * scope records as excluded, which the planner never planned; every unit the scope records as
 * unassessed is listed; each entry's answerable count fits its rule list; and the entries read
 * non-decreasing in the admission key — class rank, then the missing-evidence measure, then the path.
 *
 * Not enforced, because the published fields cannot support it: an entry's own rule set, class, and
 * counts are never re-derived here. The report carries no plan and no previous path, so an entry whose
 * figures and key position agree with each other passes however the run actually walked its units; a
 * stored order can be refuted for disagreeing with the key or with the scope's records, never for
 * disagreeing with a plan nobody published.
 */
export function assertRequestOrderIsSorted(input: {
    readonly requestOrder?: readonly SemanticPlannedRequest[];
    readonly eligible: number;
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly unassessed: readonly SemanticScopeExclusion[];
    readonly label: string;
}): void {
    const order = input.requestOrder;
    if (order === undefined) {
        return;
    }
    const planned = new Set<string>();
    for (const entry of order) {
        if (planned.has(entry.path)) {
            refuse('invalid_response', `${input.label} lists ${entry.path} more than once in its planned order`);
        }
        planned.add(entry.path);
        if (entry.ruleIds.length === 0 || entry.answerableRules > entry.ruleIds.length) {
            refuse(
                'invalid_response',
                `${input.label} publishes ${entry.path} with ${String(entry.answerableRules)} answerable rule(s) out of ${String(entry.ruleIds.length)}`
            );
        }
    }
    if (order.length !== input.eligible) {
        refuse(
            'invalid_response',
            `${input.label} publishes ${String(order.length)} planned unit(s) for ${String(input.eligible)} eligible`
        );
    }
    const excluded = new Set(input.excluded.map((entry) => entry.path));
    for (const entry of order) {
        if (excluded.has(entry.path)) {
            refuse(
                'invalid_response',
                `${input.label} publishes ${entry.path} as planned and as excluded; the planner never planned it`
            );
        }
    }
    for (const entry of input.unassessed) {
        if (!planned.has(entry.path)) {
            refuse(
                'invalid_response',
                `${input.label} records ${entry.path} as unassessed without listing it in the planned order`
            );
        }
    }
    let previous: SemanticPlannedRequest | undefined;
    for (const entry of order) {
        if (previous !== undefined && compareAdmissionKeys(previous, entry) > 0) {
            refuse(
                'invalid_response',
                `${input.label} places ${entry.path} after ${previous.path}, which the admission key orders the other way`
            );
        }
        previous = entry;
    }
}

/**
 * Holds the report's own signals to the plan it publishes: every unit a signal names must be a unit the
 * order lists. Without this, an entry's path could be rewritten to any file the plan never contained and
 * the order would still agree with the scope's counts — the displaced unit's ledger would simply name a
 * unit the plan no longer holds. A report written before the order existed carries none and stays valid.
 */
export function assertSignalsNamePlannedUnits(input: {
    readonly requestOrder?: readonly SemanticPlannedRequest[];
    readonly signals: readonly { readonly path: string }[];
    readonly label: string;
}): void {
    const order = input.requestOrder;
    if (order === undefined) {
        return;
    }
    const planned = new Set(order.map((entry) => entry.path));
    for (const signal of input.signals) {
        if (!planned.has(signal.path)) {
            refuse(
                'invalid_response',
                `${input.label} carries a signal for ${signal.path}, which its planned order does not list`
            );
        }
    }
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
