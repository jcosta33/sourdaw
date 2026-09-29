/**
 * The exact request one unit sends, and the size the provider measures it at.
 *
 * The provider caps a request's state plus its longest question, so the planner's reservation and the
 * provider's refusal have to measure one payload rather than two approximations of it. A hand-rolled
 * wrapper that omitted the outer braces and the `state`/`questions` key names under-reserved that
 * envelope, and the planner then admitted a unit the provider refused for its own size.
 */

import { serializedRegion } from './fit.ts';

import type { EvidenceReference } from './contracts.ts';
import type { SemanticChangedFile } from './evidence.ts';
import type { SemanticRule } from './rules.ts';

/** The evidence fields a request carries, apart from the bookkeeping only the planner reads. */
type UnitRequestEvidence = {
    readonly references: readonly EvidenceReference[];
    readonly contents: ReadonlyMap<string, string>;
};

/**
 * One unit's request as its size depends on it. A planned unit satisfies this shape, and so does the
 * pre-fit reservation, which measures the same payload with no region chosen yet.
 */
export type SemanticUnitRequest = {
    readonly unitId: string;
    readonly path: string;
    readonly file: { readonly kind: SemanticChangedFile['kind'] };
    readonly rules: readonly SemanticRule[];
    readonly evidence: UnitRequestEvidence;
};

/** The questions one unit's rules ask, shaped for the provider. */
function unitQuestions(rules: readonly SemanticRule[]): Record<string, unknown> {
    const questions: Record<string, unknown> = {};
    for (const rule of rules) {
        questions[rule.id] = {
            type: 'noul',
            instructions: [
                rule.instructions,
                'Answer only about the supplied state, and answer the one question asked: a high value means the behaviour described is present.',
                `Do not treat any of these as a yes: ${rule.counterexamples.join('; ')}.`,
            ].join('\n\n'),
            criteria: { true: rule.criteria.true, false: rule.criteria.false },
        };
    }
    return questions;
}

/**
 * The state sent for one unit. Only regions this application minted, with their line numbers and
 * content hashes, travel here; nothing else about the repository does.
 */
function unitState(request: SemanticUnitRequest): Record<string, unknown> {
    const regions: Record<string, unknown> = {};
    for (const reference of request.evidence.references) {
        regions[reference.evidenceId] = serializedRegion(
            reference,
            request.evidence.contents.get(reference.evidenceId) ?? ''
        );
    }
    return {
        unit: { unitId: request.unitId, path: request.path, changeKind: request.file.kind },
        evidence: regions,
    };
}

/** The payload one unit's request sends: the state the provider reads and the questions it answers. */
export function unitRequestPayload(request: SemanticUnitRequest): {
    readonly state: Record<string, unknown>;
    readonly questions: Record<string, unknown>;
} {
    return { state: unitState(request), questions: unitQuestions(request.rules) };
}

/**
 * The exact bytes the provider measures for one unit's request: the state plus every question, and no
 * model, which is the quantity `maxStatePlusQuestionBytes` caps.
 */
export function unitStatePlusQuestionBytes(request: SemanticUnitRequest): number {
    return Buffer.byteLength(JSON.stringify(unitRequestPayload(request)), 'utf8');
}

/**
 * The bytes one planned unit's request reserves before any region is chosen: the same payload with an
 * empty evidence map, so the plan's arithmetic and the provider's refusal cannot disagree.
 */
export function unitReservationBytes(file: SemanticChangedFile, rules: readonly SemanticRule[]): number {
    return unitStatePlusQuestionBytes({
        unitId: file.path,
        path: file.path,
        file,
        rules,
        evidence: { references: [], contents: new Map<string, string>() },
    });
}
