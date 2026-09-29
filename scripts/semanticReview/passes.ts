/**
 * Ordered passes of one unit's evidence and the deterministic merge rule.
 *
 * A unit whose evidence does not fit one request is partitioned into ordered passes, every pass
 * repeats the same questions, and the answers are merged per question by the pass that best carries
 * that question's required evidence. This module owns the composition and the merge, both pure, so the
 * planner and the assessor share one definition and a mutation test can attack the merge directly.
 */

import { refuse, semanticDigest, type EvidenceReference, type EvidenceSide } from './contracts.ts';
import { type SemanticChangedFile, type SemanticEvidenceSet } from './evidence.ts';
import { fitUnitEvidence, partitionUnitEvidence, type FittedPass } from './fit.ts';
import { unitRequestPayload } from './requestPayload.ts';
import { missingRequiredEvidence } from './requiredEvidence.ts';
import { type SemanticRule, type SemanticRuleId } from './rules.ts';

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

/**
 * The required-evidence tokens one pass lacks, read from that pass's own regions alone. The unit's
 * dropped sides are supplied because a side the collector or the partitioner dropped is not supplied
 * by any pass, however many of its regions a pass still carries; a side whose regions live in a
 * different pass is absent from this pass's own set and therefore missing from it too.
 */
export function passMissingEvidence(input: {
    readonly kind: SemanticChangedFile['kind'];
    readonly rule: SemanticRule;
    readonly pass: { readonly own: readonly EvidenceReference[]; readonly context: readonly EvidenceReference[] };
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
}): string[] {
    return missingRequiredEvidence(
        input.rule,
        input.pass.own,
        input.pass.context,
        input.kind,
        input.ownDroppedSides,
        input.contextDroppedSides
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
