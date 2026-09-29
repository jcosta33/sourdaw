/**
 * Ordered passes of one unit's evidence and the deterministic merge rule.
 *
 * A unit whose evidence does not fit one request is partitioned into ordered passes, every pass
 * repeats the same questions, and the answers are merged per question by the pass that best carries
 * that question's required evidence. This module owns the composition and the merge, both pure, so the
 * planner and the assessor share one definition and a mutation test can attack the merge directly.
 */

import { NO_EVIDENCE_ID, refuse, semanticDigest, type EvidenceReference, type EvidenceSide } from './contracts.ts';
import { type SemanticChangedFile, type SemanticEvidenceSet } from './evidence.ts';
import { fitUnitEvidence, partitionUnitEvidence, type FittedPass } from './fit.ts';
import { unitRequestPayload } from './requestPayload.ts';
import { missingRequiredEvidence } from './requiredEvidence.ts';
import { type SemanticRule, type SemanticRuleId } from './rules.ts';

/**
 * One unit's evidence as every per-pass question about it is asked: the passes it travels in, the
 * regions it carries whole, and the sides the fitter or the collector dropped. A planned unit
 * satisfies this shape, so the planner and the assessor read one measure of what a request can answer.
 */
export type UnitPassEvidence = {
    readonly passes: readonly SemanticUnitPass[];
    readonly own: readonly EvidenceReference[];
    readonly context: readonly EvidenceReference[];
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
};

/**
 * A planned unit as every per-pass question about it is read: what it is, which rules apply, and the
 * evidence those rules are answered from. A plan satisfies this shape, so the ordering, the request
 * carriage, and the merge share one definition without importing the planner's own record.
 *
 * A rename's previous path is carried because the planner admits the rules of both offered paths, and
 * the admission class reads the same pair: a cross-boundary rename must not be classified from its
 * destination alone.
 */
export type UnitQuestionPlan = {
    readonly path: string;
    readonly file: {
        readonly kind: SemanticChangedFile['kind'];
        readonly previousPath?: string;
    };
    readonly rules: readonly SemanticRule[];
    readonly evidence: UnitPassEvidence;
};

/** One ordered pass: a fitted region set plus its deterministic identity. */
export type SemanticUnitPass = FittedPass & {
    /** A digest over the unit and the pass's ordered evidence ids, so two compositions never collide. */
    readonly passId: string;
};

/** The stored name of one pass: which evidence it sent and which rules' merged answers it supplied. */
export type StoredUnitPass = {
    readonly passId: string;
    readonly evidenceIds: readonly string[];
    readonly answerRuleIds: readonly SemanticRuleId[];
};

/** The deterministic identity of one pass: the unit and the pass's ordered evidence ids. */
export function computePassId(unitId: string, references: readonly EvidenceReference[]): string {
    return semanticDigest({ unitId, evidenceIds: references.map((reference) => reference.evidenceId) });
}

/** One unit's evidence composed into passes, with the regions no pass could carry kept apart. */
export type ComposedUnitEvidence = {
    readonly passes: readonly SemanticUnitPass[];
    readonly references: readonly EvidenceReference[];
    readonly contents: ReadonlyMap<string, string>;
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
    readonly fittedDroppedSides: ReadonlySet<EvidenceSide>;
    readonly dropped: number;
};

/**
 * Composes one unit's evidence into ordered passes. When everything fits one request the single-pass
 * fit — and the context share it reserves — is kept exactly, so a unit that never exceeded the budget
 * travels as it always did. Otherwise the whole region set is partitioned, and only a region larger
 * than one request's evidence budget is dropped, with its side recorded.
 */
export function composeUnitPasses(
    set: SemanticEvidenceSet,
    own: readonly EvidenceReference[],
    context: readonly EvidenceReference[],
    unitId: string,
    evidenceBudget: number
): ComposedUnitEvidence {
    const fitted = fitUnitEvidence(set, own, context, evidenceBudget);
    if (fitted.dropped === 0) {
        const references = [...fitted.own.references, ...fitted.context.references];
        const contents = new Map<string, string>([...fitted.own.contents, ...fitted.context.contents]);
        return {
            passes: [
                {
                    passId: computePassId(unitId, references),
                    own: fitted.own.references,
                    context: fitted.context.references,
                    references,
                    contents,
                },
            ],
            references,
            contents,
            ownDroppedSides: fitted.own.droppedSides,
            contextDroppedSides: fitted.context.droppedSides,
            fittedDroppedSides: new Set<EvidenceSide>(),
            dropped: 0,
        };
    }
    const partitioned = partitionUnitEvidence(set, own, context, evidenceBudget);
    const passes = partitioned.passes.map((pass) => ({ ...pass, passId: computePassId(unitId, pass.references) }));
    const references = [...passes.flatMap((pass) => pass.own), ...passes.flatMap((pass) => pass.context)];
    const contents = new Map<string, string>(passes.flatMap((pass) => [...pass.contents]));
    return {
        passes,
        references,
        contents,
        ownDroppedSides: partitioned.ownDroppedSides,
        contextDroppedSides: partitioned.contextDroppedSides,
        fittedDroppedSides: new Set<EvidenceSide>([...partitioned.ownDroppedSides, ...partitioned.contextDroppedSides]),
        dropped: partitioned.dropped,
    };
}

/** The sides a pass does not carry in full: the unit's dropped sides plus any side it carries only in part. */
function effectiveDroppedSides(
    passRegions: readonly EvidenceReference[],
    unitRegions: readonly EvidenceReference[],
    unitDroppedSides: ReadonlySet<EvidenceSide>
): Set<EvidenceSide> {
    const dropped = new Set<EvidenceSide>(unitDroppedSides);
    const unitIdsBySide = new Map<EvidenceSide, Set<string>>();
    for (const region of unitRegions) {
        let ids = unitIdsBySide.get(region.side);
        if (ids === undefined) {
            ids = new Set();
            unitIdsBySide.set(region.side, ids);
        }
        ids.add(region.evidenceId);
    }
    const passIdsBySide = new Map<EvidenceSide, Set<string>>();
    for (const region of passRegions) {
        let ids = passIdsBySide.get(region.side);
        if (ids === undefined) {
            ids = new Set();
            passIdsBySide.set(region.side, ids);
        }
        ids.add(region.evidenceId);
    }
    // A pass's regions are a subset of the unit's, so a side whose ids it holds in full has an equal
    // id count; fewer ids means the side's regions live partly in other passes and this pass did not
    // supply the whole side.
    for (const [side, unitIds] of unitIdsBySide) {
        const passIds = passIdsBySide.get(side);
        if (passIds === undefined || passIds.size < unitIds.size) {
            dropped.add(side);
        }
    }
    return dropped;
}

/**
 * The required-evidence tokens one pass lacks. A side is supplied only when this pass carries every
 * one of the unit's regions of that side: a side spread across several passes is not supplied by any
 * of them, exactly as a side the fitter dropped is not supplied at all. The unit's dropped sides and
 * full per-side region sets come from the caller, so the measure never reads a side from a fragment.
 */
export function passMissingEvidence(input: {
    readonly kind: SemanticChangedFile['kind'];
    readonly rule: SemanticRule;
    readonly pass: { readonly own: readonly EvidenceReference[]; readonly context: readonly EvidenceReference[] };
    readonly unitOwn: readonly EvidenceReference[];
    readonly unitContext: readonly EvidenceReference[];
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
}): string[] {
    const ownDropped = effectiveDroppedSides(input.pass.own, input.unitOwn, input.ownDroppedSides);
    const contextDropped = effectiveDroppedSides(input.pass.context, input.unitContext, input.contextDroppedSides);
    return missingRequiredEvidence(
        input.rule,
        input.pass.own,
        input.pass.context,
        input.kind,
        ownDropped,
        contextDropped
    );
}

/**
 * The pass that best supplies one rule's required evidence: the pass with the fewest missing
 * required-evidence tokens, and the earliest pass when several carry the same amount. The pass order
 * is a deterministic function of the unit's admission order and the profile, so the earliest-pass
 * tie-break is deterministic too.
 *
 * Exported so the merge rule is a pure function a mutation test can attack directly; nothing else
 * reads it. The caller then reads the chosen pass's missing tokens through `passMissingEvidence`, so a
 * rule whose required sides land in different passes is never certified on a one-sided answer.
 */
export function choosePassIndexForRule(input: {
    readonly kind: SemanticChangedFile['kind'];
    readonly rule: SemanticRule;
    readonly passes: readonly {
        readonly own: readonly EvidenceReference[];
        readonly context: readonly EvidenceReference[];
    }[];
    readonly unitOwn: readonly EvidenceReference[];
    readonly unitContext: readonly EvidenceReference[];
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
}): number {
    const first = input.passes[0];
    if (first === undefined) {
        refuse('invalid_response', `cannot choose a pass for ${input.rule.id}: the unit has no passes`);
    }
    let best = 0;
    let bestMissing = passMissingEvidence({
        kind: input.kind,
        rule: input.rule,
        pass: first,
        unitOwn: input.unitOwn,
        unitContext: input.unitContext,
        ownDroppedSides: input.ownDroppedSides,
        contextDroppedSides: input.contextDroppedSides,
    }).length;
    for (let index = 1; index < input.passes.length; index += 1) {
        const pass = input.passes[index];
        if (pass === undefined) {
            continue;
        }
        const missing = passMissingEvidence({
            kind: input.kind,
            rule: input.rule,
            pass,
            unitOwn: input.unitOwn,
            unitContext: input.unitContext,
            ownDroppedSides: input.ownDroppedSides,
            contextDroppedSides: input.contextDroppedSides,
        });
        if (missing.length < bestMissing) {
            bestMissing = missing.length;
            best = index;
        }
    }
    return best;
}

/**
 * The rules one pass can answer: exactly those whose required evidence that pass carries in full. They
 * are the questions that pass's request may contain — a rule whose evidence this pass leaves missing
 * would only buy an answer the interpreter discards.
 */
export function answerableRulesForPass(input: {
    readonly rules: readonly SemanticRule[];
    readonly pass: SemanticUnitPass;
    readonly kind: SemanticChangedFile['kind'];
    readonly evidence: UnitPassEvidence;
}): SemanticRule[] {
    return input.rules.filter((rule) => missingEvidenceInPass({ ...input, rule }).length === 0);
}

/**
 * The required-evidence tokens no pass of this unit carries: what the unit cannot ask anyone. It is the
 * fewest-missing measure the pass choice reads, so a rule this reports empty for is exactly a rule some
 * request of the unit asks.
 */
export function bestPassMissingEvidence(input: {
    readonly rule: SemanticRule;
    readonly kind: SemanticChangedFile['kind'];
    readonly evidence: UnitPassEvidence;
}): string[] {
    let best: string[] | undefined;
    for (const pass of input.evidence.passes) {
        const missing = missingEvidenceInPass({ ...input, pass });
        if (best === undefined || missing.length < best.length) {
            best = missing;
        }
        if (best.length === 0) {
            break;
        }
    }
    // A planned unit always has at least one pass, so the fallback only answers an empty unit.
    return best ?? [];
}

/** One pass's missing tokens for one rule, read through the shared measure and the unit's own sides. */
function missingEvidenceInPass(input: {
    readonly kind: SemanticChangedFile['kind'];
    readonly evidence: UnitPassEvidence;
    readonly rule: SemanticRule;
    readonly pass: SemanticUnitPass;
}): string[] {
    return passMissingEvidence({
        kind: input.kind,
        rule: input.rule,
        pass: input.pass,
        unitOwn: input.evidence.own,
        unitContext: input.evidence.context,
        ownDroppedSides: input.evidence.ownDroppedSides,
        contextDroppedSides: input.evidence.contextDroppedSides,
    });
}

/**
 * The response must answer exactly the questions the request sent. A missing answer for a sent question
 * cannot be interpreted — the request asked for it — and an answer for a question this pass never sent
 * is refused too, because nothing checked a value the request did not define. Matching in both
 * directions is what makes the answer set a fact about the request rather than the provider's choice.
 */
export function assertAnswersMatchQuestions(input: {
    readonly unitId: string;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly askedRuleIds: readonly SemanticRuleId[];
}): void {
    for (const ruleId of input.askedRuleIds) {
        if (input.answers[ruleId] === undefined) {
            refuse(
                'invalid_response',
                `TypeSafe response for ${input.unitId} is missing the answer ${ruleId} its request asked for`
            );
        }
    }
    const asked: ReadonlySet<string> = new Set(input.askedRuleIds);
    for (const ruleId of Object.keys(input.answers)) {
        if (!asked.has(ruleId)) {
            refuse(
                'invalid_response',
                `TypeSafe response for ${input.unitId} answered ${ruleId}, which its request did not ask`
            );
        }
    }
}

/**
 * Validates a returned answer's selected evidence id against the ids the answering pass actually sent.
 * The pass's own region set is the authority, never the unit's union: a merged answer may cite only
 * evidence its source pass carried, and the explicit `none` option is always available.
 */
export function assertAnswerEvidenceSupplied(answer: unknown, supplied: ReadonlySet<string>): unknown {
    if (typeof answer !== 'object' || answer === null) {
        return answer;
    }
    const selected = (answer as Record<string, unknown>).selectedEvidenceId;
    if (selected === undefined) {
        return answer;
    }
    if (typeof selected !== 'string' || (selected !== NO_EVIDENCE_ID && !supplied.has(selected))) {
        refuse('invalid_response', `answer selected unknown evidence id ${JSON.stringify(selected)}`);
    }
    return answer;
}

/** One pass with the questions its request would ask: the answerable rules, in plan order. */
export type RequestedPass = {
    readonly pass: SemanticUnitPass;
    readonly rules: readonly SemanticRule[];
};

/**
 * The passes one unit would send, each with the rules it can answer. A pass no rule can be asked in is
 * not a request at all, so it is absent here — and a unit with no entry sends nothing, which is exactly
 * the unit whose omission the report records as missing required evidence.
 */
export function requestedPasses(input: {
    readonly rules: readonly SemanticRule[];
    readonly kind: SemanticChangedFile['kind'];
    readonly evidence: UnitPassEvidence;
}): RequestedPass[] {
    const requested: RequestedPass[] = [];
    for (const pass of input.evidence.passes) {
        const rules = answerableRulesForPass({ ...input, pass });
        if (rules.length > 0) {
            requested.push({ pass, rules });
        }
    }
    return requested;
}

/** One pass's request payload, shaped exactly as the provider receives it. */
export function passRequestPayload(input: {
    readonly unitId: string;
    readonly path: string;
    readonly file: SemanticChangedFile;
    readonly rules: readonly SemanticRule[];
    readonly pass: SemanticUnitPass;
}): { readonly state: Record<string, unknown>; readonly questions: Record<string, unknown> } {
    return unitRequestPayload({
        unitId: input.unitId,
        path: input.path,
        file: input.file,
        rules: input.rules,
        evidence: { references: input.pass.references, contents: input.pass.contents },
    });
}
