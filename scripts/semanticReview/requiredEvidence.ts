/**
 * Resolution of a rule's required-evidence vocabulary against one unit's supplied regions.
 *
 * Each side resolves against the set it belongs to: the unit's `before`/`after` come from its own
 * regions, `context` from the context regions a rule declared it needed, and `implementation` from any
 * after region that is not a collected spec. A dropped side unsupplies only the set it was dropped
 * from, so a context region dropped for budget must not mark the unit's own side missing.
 *
 * Every token a rule can declare is mapped here by exact string, so adding a rule with a new token is
 * a visible decision rather than a silent fall-through. A token the mapping does not answer is
 * reported missing: the previous `return own.length > 0 || context.length > 0` fallback let an
 * unmatched token — `related existing source` — be satisfied by whatever the unit happened to carry,
 * so a rule about duplication scored a decisive verdict with no related source ever sent.
 */

import { type EvidenceReference, type EvidenceSide } from './contracts.ts';
import { type SemanticChangedFile } from './evidence.ts';
import { isCollectedSpec, type SemanticRule } from './rules.ts';

/** The regions a token resolves against, split so an own-side drop never unsupplies a context region. */
type EvidenceResolution = {
    readonly own: readonly EvidenceReference[];
    readonly context: readonly EvidenceReference[];
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
};

/**
 * Whether a side is supplied: at least one region of that side survived the fitter. A side split
 * across several hunks where one was dropped is not supplied, so a region that survived alone cannot
 * satisfy a requirement over a side the model saw only in part.
 */
function sidePresent(
    regions: readonly EvidenceReference[],
    side: EvidenceReference['side'],
    dropped: ReadonlySet<EvidenceSide>
): boolean {
    return !dropped.has(side) && regions.some((reference) => reference.side === side);
}

/**
 * Whether the regions carry implementation source: an after region a runner does not collect. A
 * collected spec is never implementation source, while a `__tests__/`-resident double the runner does
 * not collect is admitted.
 */
function implementationPresent(regions: readonly EvidenceReference[], dropped: ReadonlySet<EvidenceSide>): boolean {
    return (
        !dropped.has('after') &&
        regions.some((reference) => reference.side === 'after' && !isCollectedSpec(reference.path))
    );
}

/**
 * The exact required-evidence tokens a rule may declare, each resolved against the set it belongs to.
 * Caller and call-site tokens resolve against the context regions alone: the unit's own after side is
 * the changed file itself, not a caller outside it, so it must not satisfy a question about whether
 * callers were updated.
 */
const REQUIRED_EVIDENCE_RESOLVERS: Readonly<Record<string, (resolution: EvidenceResolution) => boolean>> = {
    'before test source': ({ own, ownDroppedSides }) => sidePresent(own, 'before', ownDroppedSides),
    'after test source': ({ own, ownDroppedSides }) => sidePresent(own, 'after', ownDroppedSides),
    'before source': ({ own, ownDroppedSides }) => sidePresent(own, 'before', ownDroppedSides),
    'after source': ({ own, ownDroppedSides }) => sidePresent(own, 'after', ownDroppedSides),
    'after implementation source': ({ own, context, ownDroppedSides, contextDroppedSides }) =>
        implementationPresent(own, ownDroppedSides) || implementationPresent(context, contextDroppedSides),
    'migration or version contract': ({ context, contextDroppedSides }) =>
        sidePresent(context, 'context', contextDroppedSides),
    'undo contract': ({ context, contextDroppedSides }) => sidePresent(context, 'context', contextDroppedSides),
    'decision or documented invariant': ({ context, contextDroppedSides }) =>
        sidePresent(context, 'context', contextDroppedSides),
    'scheduling call-site': ({ context, contextDroppedSides }) => sidePresent(context, 'context', contextDroppedSides),
    'caller or contract': ({ context, contextDroppedSides }) => sidePresent(context, 'context', contextDroppedSides),
    'related existing source': ({ context, contextDroppedSides }) =>
        sidePresent(context, 'context', contextDroppedSides) || sidePresent(context, 'after', contextDroppedSides),
};

/** The tokens the resolver answers, exported so a coverage guard can fail on an unhandled declaration. */
export const RESOLVED_EVIDENCE_TOKENS: ReadonlySet<string> = new Set(Object.keys(REQUIRED_EVIDENCE_RESOLVERS));

/** Whether a rule's required-evidence token is supplied by the unit's own or context regions. */
function requiredEvidencePresent(
    token: string,
    own: readonly EvidenceReference[],
    context: readonly EvidenceReference[],
    ownDroppedSides: ReadonlySet<EvidenceSide>,
    contextDroppedSides: ReadonlySet<EvidenceSide>
): boolean {
    const resolver = REQUIRED_EVIDENCE_RESOLVERS[token];
    if (resolver === undefined) {
        // A token the mapping does not answer is missing, never satisfied by whatever happens to be
        // carried. The coverage guard above fails when a rule declares a token that reaches this.
        return false;
    }
    return resolver({ own, context, ownDroppedSides, contextDroppedSides });
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
