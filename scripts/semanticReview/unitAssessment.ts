/**
 * One unit's merged answers, and the coverage ledger of the questions no request asked.
 *
 * Every pass of a unit repeats only the questions it can answer, so a rule's answer comes from the pass
 * that best carries its required evidence. A rule no pass can answer was never asked, and it still
 * reports its missing required evidence: a unit that was skipped, or a rule inside a unit that was
 * partly answerable, must never make the report look more complete than the run was. The merge is pure
 * and exported so a mutation test can attack it without a provider.
 *
 * The stored record keeps every rule of the unit, answered or not, because `replay` reinterprets the
 * stored answers offline: a record that omitted an unasked rule would silently drop that rule's
 * insufficient-context entry from the replayed report.
 */

import { evidenceIdSet, refuse } from './contracts.ts';
import { interpretScanOutcome, type ScanAssessment } from './interpret.ts';
import {
    assertAnswerEvidenceSupplied,
    bestPassMissingEvidence,
    choosePassIndexForRule,
    type SemanticUnitPass,
    type StoredUnitPass,
    type UnitQuestionPlan,
} from './passes.ts';
import { type SemanticAssessmentResult } from './provider.ts';
import { type SemanticRule, type SemanticRuleId } from './rules.ts';
import { MISSING_REQUIRED_EVIDENCE_REASON } from './scopeAccounting.ts';

/** One planned unit plus the identity the report and the stored record name it by. */
export type MergeableUnit = UnitQuestionPlan & { readonly unitId: string };

/** One pass that was sent, with the questions its request asked and the answer it returned. */
export type AssessedPass = {
    readonly pass: SemanticUnitPass;
    /** Exactly the rules that pass could answer, which are the questions its request contained. */
    readonly askedRuleIds: readonly SemanticRuleId[];
    readonly result: SemanticAssessmentResult;
};

/**
 * The stored name of one unit's response: the merged answers plus the deterministic inputs replay reads.
 * A unit no pass could ask stores no answer at all, with `omissionReason` saying why.
 */
export type StoredUnitResponse = {
    readonly unitId: string;
    readonly path: string;
    readonly ruleIds: readonly SemanticRuleId[];
    readonly answers: Readonly<Record<string, unknown>>;
    readonly missingEvidence: Readonly<Record<string, readonly string[]>>;
    /** The passes this unit's evidence travelled in; the merged answer names its source pass. */
    readonly passes: readonly StoredUnitPass[];
    /** Why no request was sent, when no pass carried the evidence its questions require. */
    readonly omissionReason?: string;
};

export type MergedUnitAssessment = {
    readonly signals: readonly ScanAssessment[];
    readonly stored: StoredUnitResponse;
    readonly returnedModels: readonly string[];
    readonly fromCache: boolean;
};

/**
 * Merges one unit's per-pass answers per question, and records every rule the requests did not ask. The
 * chosen pass is the same fewest-missing pass the request filter reads, so a rule with a decidable pass
 * is always answered by it and a rule without one is never left unnamed.
 */
export function mergeUnitAnswers(input: {
    readonly unit: MergeableUnit;
    readonly assessedPasses: readonly AssessedPass[];
}): MergedUnitAssessment {
    const { unit } = input;
    const assessedByPass = new Map<SemanticUnitPass, AssessedPass>(
        input.assessedPasses.map((assessed) => [assessed.pass, assessed])
    );
    const mergedAnswers: Record<string, unknown> = {};
    const sourcePassByRule = new Map<SemanticRuleId, SemanticUnitPass>();
    const mergedMissing = new Map<SemanticRuleId, string[]>();

    for (const rule of unit.rules) {
        const missing = bestPassMissingEvidence({ rule, kind: unit.file.kind, evidence: unit.evidence });
        mergedMissing.set(rule.id, missing);
        const chosen = unit.evidence.passes[choosePassIndexForRule(chooseInput(unit, rule))];
        const assessed = chosen === undefined ? undefined : assessedByPass.get(chosen);
        // The chosen pass is this rule's best pass, which is not the same as a pass that asked it: a
        // pass carrying most of the required evidence was still sent for the rules it can answer. Only
        // membership in the sent question set makes an answer exist.
        if (assessed === undefined || !assessed.askedRuleIds.includes(rule.id)) {
            // No request carried this rule's required evidence, so there is no answer to merge. A pass
            // that could carry it and did not ask is a membership defect, never a silent gap.
            if (missing.length === 0) {
                refuse(
                    'invalid_response',
                    `unit ${unit.unitId} never asked ${rule.id} although a pass carries the evidence it requires`
                );
            }
            continue;
        }
        // A selected evidence id is validated against the ids the answering pass actually sent, never
        // the unit's union, so a merged answer can cite only evidence its source pass carried.
        mergedAnswers[rule.id] = assertAnswerEvidenceSupplied(
            assessed.result.response.answers[rule.id],
            evidenceIdSet(assessed.pass.references)
        );
        sourcePassByRule.set(rule.id, assessed.pass);
    }

    const signals = unit.rules.map((rule) =>
        interpretScanOutcome({
            answer: mergedAnswers[rule.id],
            rule,
            unitId: unit.unitId,
            path: unit.path,
            missingEvidence: mergedMissing.get(rule.id) ?? [],
        })
    );
    const storedPasses = input.assessedPasses.map((assessed) => ({
        passId: assessed.pass.passId,
        evidenceIds: assessed.pass.references.map((reference) => reference.evidenceId),
        answerRuleIds: assessed.askedRuleIds.filter((ruleId) => sourcePassByRule.get(ruleId) === assessed.pass),
    }));
    const requested = input.assessedPasses.length > 0;
    const stored: StoredUnitResponse = {
        unitId: unit.unitId,
        path: unit.path,
        ruleIds: unit.rules.map((rule) => rule.id),
        answers: mergedAnswers,
        missingEvidence: Object.fromEntries(mergedMissing),
        passes: storedPasses,
    };
    // A unit no pass could ask stores no answer at all; the reason is what keeps its rules' missing
    // evidence attributable to the plan rather than to a provider that failed.
    const omitted: StoredUnitResponse = { ...stored, omissionReason: MISSING_REQUIRED_EVIDENCE_REASON };
    return {
        signals,
        stored: requested ? stored : omitted,
        returnedModels: input.assessedPasses
            .filter((assessed) => !assessed.result.fromCache)
            .map((assessed) => assessed.result.response.model),
        fromCache: requested && input.assessedPasses.every((assessed) => assessed.result.fromCache),
    };
}

/** The pass-choice input for one rule, so the merge and the request filter read one measure. */
function chooseInput(unit: MergeableUnit, rule: SemanticRule): Parameters<typeof choosePassIndexForRule>[0] {
    return {
        kind: unit.file.kind,
        rule,
        passes: unit.evidence.passes,
        unitOwn: unit.evidence.own,
        unitContext: unit.evidence.context,
        ownDroppedSides: unit.evidence.ownDroppedSides,
        contextDroppedSides: unit.evidence.contextDroppedSides,
    };
}
