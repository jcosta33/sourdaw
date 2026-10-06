/**
 * The exact request one unit sends, and the size the provider measures it at.
 *
 * The provider caps a request's state plus its longest question, so the planner's reservation and the
 * provider's refusal have to measure one payload rather than two approximations of it. A hand-rolled
 * wrapper that omitted the outer braces and the `state`/`questions` key names under-reserved that
 * envelope, and the planner then admitted a unit the provider refused for its own size.
 *
 * The unit's deterministic change facts are part of that state, so they are part of the identity the
 * response cache keys on — a fact change produces a different cache key and can never reuse an answer
 * given without it. The request format version is deliberately not bumped for this: the version keys the
 * shape of every request, and the facts travel inside a state the key already covers, so a stored answer
 * from before the block existed has a different key rather than a stale one. Bumping it would also throw
 * away the findings-path cache, whose request did not change.
 */

import { type UnitChangedLineFacts } from './changeFacts.ts';
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
    /** The deterministic change facts about this unit's own hunks, keyed to the unit it describes. */
    readonly changedLineFacts: UnitChangedLineFacts;
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
 * content hashes, travel here; nothing else about the repository does. The change facts travel inside the
 * unit record because they are facts about that unit's own hunks, and a request that carried another
 * unit's lines would ground a question in an edit it was never asked about.
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
        unit: {
            unitId: request.unitId,
            path: request.path,
            changeKind: request.file.kind,
            changedLines: request.changedLineFacts,
        },
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
 * empty evidence map, so the plan's arithmetic and the provider's refusal cannot disagree. The unit's
 * change facts are already known when the reservation is taken, so they are reserved with it rather than
 * discovered later as bytes the fitter never accounted for.
 */
export function unitReservationBytes(
    file: SemanticChangedFile,
    rules: readonly SemanticRule[],
    changedLineFacts: UnitChangedLineFacts
): number {
    return unitStatePlusQuestionBytes({
        unitId: file.path,
        path: file.path,
        file,
        rules,
        evidence: { references: [], contents: new Map<string, string>() },
        changedLineFacts,
    });
}
