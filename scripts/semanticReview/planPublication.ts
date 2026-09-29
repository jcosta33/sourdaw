/**
 * The admission plan as a report publishes it, and the checks a stored plan must satisfy.
 *
 * The plan's own ordering lives in `unitPriority.ts`, which reads a unit's rules and evidence to build
 * the key. This half reads only what a report publishes — paths, classes, the missing-evidence measure,
 * rule ids — so the validator that consumes it stays out of the collector and provider module graph,
 * which the review entry point's trusted-executing closure pins. The docstrings below state exactly
 * which parts of a stored plan those published fields can refute.
 */

import { isUnitPriorityClass, refuse, type SemanticScopeExclusion, type UnitPriorityClass } from './contracts.ts';
import { compareLexicographic } from './pathOrder.ts';
import { isSemanticRuleId, SEVERE_INVESTIGATION_CATEGORIES, type SemanticRuleId } from './rules.ts';

/** The escalation classes, read as a set so a rule's category joins the key by membership, never by a cast. */
const SEVERE_CATEGORIES: ReadonlySet<string> = new Set(SEVERE_INVESTIGATION_CATEGORIES);

/** The classes in admission order, most-preferred first. */
const PRIORITY_RANK: Readonly<Record<UnitPriorityClass, number>> = {
    'severe-production': 0,
    'severe-test': 1,
    production: 2,
    test: 3,
};

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
 * The three fields the admission key reads, in the order it reads them. The report publishes the same
 * three for every planned unit, so the comparator and the validator below hold a stored order to one key
 * rather than to a second, restated one.
 */
type AdmissionKey = {
    readonly path: string;
    readonly priorityClass: UnitPriorityClass;
    readonly missingRequiredEvidenceTokens: number;
};

export function compareAdmissionKeys(left: AdmissionKey, right: AdmissionKey): number {
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
 * Enforced: the entries are distinct; their count is the eligible count; no entry names a path the
 * scope records as excluded, which the planner never planned; every unit the scope records as
 * unassessed is listed; each entry's answerable count fits its rule list; and the entries read
 * non-decreasing in the admission key — class rank, then the missing-evidence measure, then the path.
 * Coverage — that every entry is a unit the run held — is enforced without this order by
 * `assertLedgersPartition`: an entry no signal and no omission names would leave `assessed` short of the
 * units the entries stand for, which that tie refuses.
 *
 * Not enforced, because the published fields cannot support it: an entry's own rule set and counts are
 * never re-derived here, so an entry whose figures, key position, and ledger trace agree with each other
 * passes however the run actually walked its units. The class is re-derived only as far as
 * `assertPlanMatchesLedger` carries it — its severity from the path's signals, and its equality with the
 * class the scope records for the same path; the production/test side of it stays unrefutable, because
 * the report publishes no rename's previous path and a cross-boundary rename is classed production
 * precisely because one of its offered paths is. These checks bound disagreement with the key, the
 * ledger, and the recorded classes; they do not prove that every entry had a unit.
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
 * Ties the published order to the report's own ledger, in both directions and by class.
 *
 * Every unit a signal names must be in the order: a signal for a unit the plan does not list is a report
 * whose order was rewritten around its own records. The other direction — that every entry is a unit the
 * report records — is enforced by `assertLedgersPartition` whatever the order carries: an entry for a unit
 * that left no trace would leave `assessed` short of the units the entries stand for, and that tie
 * refuses it. An honest plan leaves one of the two traces for every unit it holds: an asked unit reports
 * each of its rules as a signal, and a unit no request could ask is recorded as unassessed.
 *
 * Each entry's class is held to the ledger as far as the report can re-derive it. An entry must carry
 * the class the scope records for the same path among the units it never assessed, because one function
 * produced both. And an entry's severity must equal the severity of the path's own signals, which carry
 * every applied rule's investigation category: a severe class with only non-severe signals, and a
 * non-severe class with only severe signals, are both refuted.
 *
 * What stays unrefutable is the production/test side of a class. The report publishes no rename's
 * previous path, and a cross-boundary rename is classed production precisely because one of its offered
 * paths is, so a class that gets severity right and picks the wrong side of that split passes. A forgery
 * that raises the order, the signals, and the scope together passes for the same reason: a stored report
 * is self-describing, and a consistent rewrite of all three is beyond what it can refute about itself. A
 * report written before the order existed carries none and stays valid.
 */
export function assertPlanMatchesLedger(input: {
    readonly requestOrder?: readonly SemanticPlannedRequest[];
    readonly signals: readonly { readonly path: string; readonly investigationCategory: string }[];
    readonly unassessed: readonly SemanticScopeExclusion[];
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
    const classRecordedForOmission = new Map(input.unassessed.map((entry) => [entry.path, entry.priorityClass]));
    for (const entry of order) {
        const recordedClass = classRecordedForOmission.get(entry.path);
        if (recordedClass !== undefined && recordedClass !== entry.priorityClass) {
            refuse(
                'invalid_response',
                `${input.label} publishes ${entry.path} as ${entry.priorityClass} in its plan and as ${recordedClass} among the units it never assessed`
            );
        }
    }
    const severeSupport = severeSupportByPath(input.signals);
    for (const entry of order) {
        const severe = severeSupport.get(entry.path);
        if (severe === undefined || severe === isSevereClass(entry.priorityClass)) {
            continue;
        }
        refuse(
            'invalid_response',
            `${input.label} publishes ${entry.path} as ${entry.priorityClass} while its signals carry ${severe ? 'a severe' : 'no severe'} investigation category`
        );
    }
}

/** The classes whose name carries the severe mark, which is the one class dimension a report re-derives. */
function isSevereClass(priorityClass: UnitPriorityClass): boolean {
    return priorityClass === 'severe-production' || priorityClass === 'severe-test';
}

/** Whether any signal for each path carries a severe investigation category; a path with none is absent. */
function severeSupportByPath(
    signals: readonly { readonly path: string; readonly investigationCategory: string }[]
): Map<string, boolean> {
    const support = new Map<string, boolean>();
    for (const signal of signals) {
        const severe = support.get(signal.path) ?? false;
        support.set(signal.path, severe || SEVERE_CATEGORIES.has(signal.investigationCategory));
    }
    return support;
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
