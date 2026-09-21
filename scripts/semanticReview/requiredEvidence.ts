/**
 * Resolution of a rule's required-evidence vocabulary against one unit's supplied regions.
 *
 * Each side resolves against the set it belongs to: the unit's `before`/`after` come from its own
 * regions, `context` from the context regions a rule declared it needed, and `implementation` from any
 * after region that is not a collected spec. A dropped side unsupplies only the set it was dropped
 * from, so a context region dropped for budget must not mark the unit's own side missing.
 */

import { type EvidenceReference, type EvidenceSide } from './contracts.ts';
import { type SemanticChangedFile } from './evidence.ts';
import { isCollectedSpec, type SemanticRule } from './rules.ts';

/** Required-evidence vocabulary mapped to a deterministic predicate over the supplied regions. */
function requiredEvidencePresent(
    token: string,
    own: readonly EvidenceReference[],
    context: readonly EvidenceReference[],
    ownDroppedSides: ReadonlySet<EvidenceSide>,
    contextDroppedSides: ReadonlySet<EvidenceSide>
): boolean {
    const lower = token.toLowerCase();
    // A region cut to a prefix does not answer for the whole side it came from, so it cannot satisfy
    // a required side on its own: a rule told it has the after side while holding 6% of it would
    // score evidence it never saw. A side the fitter dropped in part is the same defect — one of
    // several regions of the side survived, but the side was still delivered incompletely.
    const ownHas = (side: EvidenceReference['side']): boolean =>
        !ownDroppedSides.has(side) && own.some((reference) => reference.side === side);
    const contextHas = (side: EvidenceReference['side']): boolean =>
        !contextDroppedSides.has(side) && context.some((reference) => reference.side === side);
    // Implementation source is a claim about *which* after side, not merely that one exists. Resolving
    // it to `has('after')` let a test unit's own region satisfy a rule that declared it needed the
    // implementation, so the rule scored a question it never had the evidence to answer — and this
    // branch has to come before the generic `after` one for that resolution to mean anything. A file
    // the runner collects as a test is never implementation source, so a spec is excluded while a
    // `__tests__/`-resident double that the runner does not collect is admitted. Each set resolves on
    // its own and the two disjoin, so a context region dropped for budget can neither satisfy nor deny
    // an own-side requirement.
    if (lower.includes('implementation')) {
        const completeIn = (regions: readonly EvidenceReference[], dropped: ReadonlySet<EvidenceSide>): boolean =>
            !dropped.has('after') &&
            regions.some((reference) => reference.side === 'after' && !isCollectedSpec(reference.path));
        return completeIn(own, ownDroppedSides) || completeIn(context, contextDroppedSides);
    }
    if (lower.includes('before')) {
        return ownHas('before');
    }
    if (lower.includes('after')) {
        return ownHas('after');
    }
    // A caller or call-site is either a contract region or the changed file's own after side, each of
    // which must be complete. This branch precedes the generic contract one so `caller or contract`
    // resolves as a caller token rather than a contract-only one.
    if (lower.includes('call-site') || lower.includes('caller') || lower.includes('scheduling')) {
        return ownHas('after') || contextHas('context');
    }
    if (lower.includes('contract') || lower.includes('decision') || lower.includes('registration')) {
        return contextHas('context');
    }
    return own.length > 0 || context.length > 0;
}

/**
 * The rule's required evidence that is genuinely absent.
 *
 * A side that cannot exist for this change is not missing. An added file has no before side, so a
 * rule about removing previously-checked behavior has nothing to compare against and must not be
 * reported incomplete for evidence the change could not have produced; the same holds for the after
 * side of a deletion.
 */
export function missingRequiredEvidence(
    rule: SemanticRule,
    own: readonly EvidenceReference[],
    context: readonly EvidenceReference[],
    kind: SemanticChangedFile['kind'] = 'modified',
    ownDroppedSides: ReadonlySet<EvidenceSide> = new Set<EvidenceSide>(),
    contextDroppedSides: ReadonlySet<EvidenceSide> = new Set<EvidenceSide>()
): string[] {
    return rule.requiredEvidence.filter((token) => {
        const lower = token.toLowerCase();
        if (kind === 'added' && lower.includes('before')) {
            return false;
        }
        if (kind === 'deleted' && lower.includes('after')) {
            return false;
        }
        return !requiredEvidencePresent(token, own, context, ownDroppedSides, contextDroppedSides);
    });
}
