import { type ProjectContext, type ProjectContextTrack } from '../models/ProjectContext';
import {
    type SemanticCommandListConditionField,
    type SemanticCommandListEntity,
    type SemanticCommandListMatch,
    type SemanticCommandListPredicate,
    type SemanticCommandListQuantity,
    type SemanticCommandListRoleFamily,
} from '../models/SemanticCommandList';

/**
 * One resolvable object in a semantic command list selector's universe, carrying the facts of the
 * track that owns it — the track itself when the candidate is a track, otherwise the track its
 * `trackId` names. `match` predicates read only these owner facts, never anything else, so a
 * candidate fingerprint (`JSON.stringify`) taken over this whole shape covers every fact a
 * predicate can have read.
 */
export type SemanticCommandListCandidate = {
    id: string;
    entity: SemanticCommandListEntity;
    name?: string;
    kind?: string;
    type?: string;
    trackId?: string;
    muted?: boolean;
    locked?: boolean;
    bypassed?: boolean;
    enabled?: boolean;
    ownerTrackId?: string;
    ownerCanonicalRole?: string;
    ownerRoleFamily?: SemanticCommandListRoleFamily | null;
    ownerKind?: string;
    ownerMuted?: boolean;
    ownerFrozen?: boolean;
    ownerTags?: readonly string[];
    ownerDeviceTypes?: readonly string[];
    /** The candidate's own beat span for `inSection`: one span for a clip, every clip span for a track. */
    ownSpans?: readonly { startBeat: number; endBeat: number }[];
};

type OwnerFacts = {
    canonicalRole: string;
    roleFamily: SemanticCommandListRoleFamily | null;
    kind: string;
    muted: boolean;
    frozen: boolean;
    tags: readonly string[];
    deviceTypes: readonly string[];
    clipSpans: readonly { startBeat: number; endBeat: number }[];
};

/**
 * A track's tag set: its kind, every device type on it, and every production-brief role authored
 * for it — the same facts `project.discover` shows as tags and roles, read fresh here because that
 * computation lives in Project's `useCases/`, private to this module.
 */
function buildOwnerFacts(
    track: ProjectContextTrack,
    roleFamilyByCanonicalRole: Readonly<Record<string, SemanticCommandListRoleFamily | null>>,
    briefRolesByTrackId: ReadonlyMap<string, readonly string[]>
): OwnerFacts {
    const canonicalRole = track.canonicalRole?.role ?? 'unknown';
    const deviceTypes = track.devices.map((device) => device.type);
    const briefRoles = briefRolesByTrackId.get(track.id) ?? [];
    return {
        canonicalRole,
        roleFamily: roleFamilyByCanonicalRole[canonicalRole] ?? null,
        kind: track.kind,
        muted: track.muted,
        frozen: track.frozen ?? false,
        tags: [...new Set([track.kind, ...deviceTypes, ...briefRoles].map((tag) => tag.toLowerCase()))],
        deviceTypes,
        clipSpans: track.clips.map((clip) => ({ startBeat: clip.startBeat, endBeat: clip.endBeat })),
    };
}

function ownerFields(facts: OwnerFacts | undefined, trackId: string) {
    if (facts === undefined) {
        return {};
    }
    return {
        ownerTrackId: trackId,
        ownerCanonicalRole: facts.canonicalRole,
        ownerRoleFamily: facts.roleFamily,
        ownerKind: facts.kind,
        ownerMuted: facts.muted,
        ownerFrozen: facts.frozen,
        ownerTags: facts.tags,
        ownerDeviceTypes: facts.deviceTypes,
    };
}

/**
 * Every object a semantic command list selector can resolve, each carrying its owning track's
 * facts for `match` predicates. The one candidate universe both the compiler and the evidence
 * validator read, so a selector's `match` resolves identically at both ends.
 */
export function collectSemanticCommandListCandidates(input: {
    context: ProjectContext;
    roleFamilyByCanonicalRole: Readonly<Record<string, SemanticCommandListRoleFamily | null>>;
}): SemanticCommandListCandidate[] {
    const { context } = input;
    const briefRolesByTrackId = new Map<string, string[]>();
    for (const entry of context.productionBrief?.trackRoles ?? []) {
        const existing = briefRolesByTrackId.get(entry.trackId);
        if (existing === undefined) {
            briefRolesByTrackId.set(entry.trackId, [entry.role]);
        } else {
            existing.push(entry.role);
        }
    }
    const factsByTrackId = new Map(
        context.tracks.map((track) => [
            track.id,
            buildOwnerFacts(track, input.roleFamilyByCanonicalRole, briefRolesByTrackId),
        ])
    );

    const tracks = context.tracks.map((track) => ({
        id: track.id,
        entity: 'track' as const,
        name: track.name,
        kind: track.kind,
        muted: track.muted,
        ...ownerFields(factsByTrackId.get(track.id), track.id),
        ownSpans: factsByTrackId.get(track.id)?.clipSpans ?? [],
    }));
    const clips = context.tracks.flatMap((track) =>
        track.clips.map((clip) => ({
            id: clip.id,
            entity: 'clip' as const,
            name: clip.name,
            type: clip.type,
            trackId: track.id,
            muted: clip.muted,
            locked: clip.locked,
            ...ownerFields(factsByTrackId.get(track.id), track.id),
            ownSpans: [{ startBeat: clip.startBeat, endBeat: clip.endBeat }],
        }))
    );
    const devices = context.tracks.flatMap((track) =>
        track.devices.map((device) => ({
            id: device.id,
            entity: 'device' as const,
            name: device.name,
            type: device.type,
            trackId: track.id,
            bypassed: device.bypassed,
            ...ownerFields(factsByTrackId.get(track.id), track.id),
        }))
    );
    const lanes = (context.automationLanes ?? []).map((lane) => ({
        id: lane.id,
        entity: 'automation-lane' as const,
        name: lane.name,
        trackId: lane.trackId,
        enabled: lane.enabled,
        ...ownerFields(factsByTrackId.get(lane.trackId), lane.trackId),
    }));
    const adjustmentLayers = (context.adjustmentLayers ?? []).map((layer) => ({
        id: layer.id,
        entity: 'adjustment-layer' as const,
        name: layer.name,
        type: layer.effectType,
        enabled: layer.enabled,
    }));
    return [...tracks, ...clips, ...devices, ...lanes, ...adjustmentLayers];
}

/** Half-open `[rangeStart, rangeEnd)` overlap: a span touching only the end boundary does not overlap. */
function overlapsHalfOpenRange(spanStart: number, spanEnd: number, rangeStart: number, rangeEnd: number): boolean {
    return spanStart < rangeEnd && spanEnd > rangeStart;
}

function matchesPredicate(
    candidate: SemanticCommandListCandidate,
    predicate: SemanticCommandListPredicate,
    sectionsById: ReadonlyMap<string, { startBeat: number; endBeat: number }>
): boolean {
    if ('role' in predicate) {
        return (candidate.ownerCanonicalRole ?? 'unknown') === predicate.role;
    }
    if ('roleFamily' in predicate) {
        return candidate.ownerRoleFamily === predicate.roleFamily;
    }
    if ('nameIncludes' in predicate) {
        return (candidate.name ?? '').toLowerCase().includes(predicate.nameIncludes.toLowerCase());
    }
    if ('tag' in predicate) {
        return (candidate.ownerTags ?? []).includes(predicate.tag.toLowerCase());
    }
    if ('kind' in predicate) {
        return candidate.ownerKind === predicate.kind;
    }
    if ('hasDeviceType' in predicate) {
        return (candidate.ownerDeviceTypes ?? []).includes(predicate.hasDeviceType);
    }
    if ('isMuted' in predicate) {
        return (candidate.ownerMuted ?? false) === predicate.isMuted;
    }
    if ('isFrozen' in predicate) {
        return (candidate.ownerFrozen ?? false) === predicate.isFrozen;
    }
    const section = sectionsById.get(predicate.inSection);
    return (
        section !== undefined &&
        (candidate.ownSpans ?? []).some((span) =>
            overlapsHalfOpenRange(span.startBeat, span.endBeat, section.startBeat, section.endBeat)
        )
    );
}

function matchesSelectorPredicates(
    candidate: SemanticCommandListCandidate,
    match: SemanticCommandListMatch,
    sectionsById: ReadonlyMap<string, { startBeat: number; endBeat: number }>
): boolean {
    const allSatisfied = (match.all ?? []).every((predicate) => matchesPredicate(candidate, predicate, sectionsById));
    let anySatisfied = true;
    if (match.any !== undefined) {
        anySatisfied = match.any.some((predicate) => matchesPredicate(candidate, predicate, sectionsById));
    }
    return allSatisfied && anySatisfied;
}

/**
 * Validates a `match` against its selector's entity and the live project context, once, before any
 * candidate is filtered — the same checks the task names as compile-time rejections: an
 * adjustment-layer entity admits no `match` at all (it has no single owning track), `inSection`
 * admits no device or automation-lane entity (they are not spanned), an unknown role or section
 * names the offending value.
 */
function validateMatchAgainstContext(input: {
    entity: SemanticCommandListEntity;
    itemId: string;
    match: SemanticCommandListMatch;
    roleFamilyByCanonicalRole: Readonly<Record<string, SemanticCommandListRoleFamily | null>>;
    sectionIds: ReadonlySet<string>;
}): string | null {
    if (input.entity === 'adjustment-layer') {
        return `Bulk selector ${input.itemId} match may not target an adjustment-layer entity.`;
    }
    const allPredicates = input.match.all ?? [];
    const anyPredicates = input.match.any ?? [];
    const predicates = [...allPredicates, ...anyPredicates];
    for (const predicate of predicates) {
        if ('role' in predicate && !Object.hasOwn(input.roleFamilyByCanonicalRole, predicate.role)) {
            return `Bulk selector ${input.itemId} match predicate names an unknown role: ${predicate.role}`;
        }
        if ('inSection' in predicate) {
            if (input.entity === 'device' || input.entity === 'automation-lane') {
                return `Bulk selector ${input.itemId} match may not use inSection with entity ${input.entity}.`;
            }
            if (!input.sectionIds.has(predicate.inSection)) {
                return `Bulk selector ${input.itemId} match predicate names an unknown section: ${predicate.inSection}`;
            }
        }
    }
    return null;
}

export type SemanticCommandListSelectorResolution =
    | { status: 'accepted'; stableIds: string[] }
    | {
          status: 'rejected';
          reason: string;
          detail?: {
              kind: 'missing-target' | 'ambiguous-target';
              resolvedCount: number;
              expectedCount: number;
              candidateIds: string[];
          };
      };

function checkQuantity(
    resolvedCount: number,
    quantity: SemanticCommandListQuantity
): { status: 'ok' } | { status: 'rejected'; kind: 'missing-target' | 'ambiguous-target'; expectedCount: number } {
    if ('exactly' in quantity) {
        if (resolvedCount === quantity.exactly) {
            return { status: 'ok' };
        }
        return {
            status: 'rejected',
            kind: resolvedCount === 0 ? 'missing-target' : 'ambiguous-target',
            expectedCount: quantity.exactly,
        };
    }
    if (resolvedCount === 0) {
        return { status: 'rejected', kind: 'missing-target', expectedCount: quantity.maximum };
    }
    if (resolvedCount > quantity.maximum) {
        return { status: 'rejected', kind: 'ambiguous-target', expectedCount: quantity.maximum };
    }
    return { status: 'ok' };
}

/**
 * Resolves one selector — entity, `where`, `condition`, `match`, `excludeIds`, and `quantity` — to
 * its stable target IDs against the given candidate universe. The compiler and the evidence
 * validator call this with the same candidates and the same selector fields (the validator's read
 * back from recorded evidence), so a selector resolves identically wherever it is replayed.
 */
export function resolveSemanticCommandListSelector(input: {
    candidates: readonly SemanticCommandListCandidate[];
    context: ProjectContext;
    itemId: string;
    roleFamilyByCanonicalRole: Readonly<Record<string, SemanticCommandListRoleFamily | null>>;
    selector: {
        entity: SemanticCommandListEntity;
        where?: Partial<Record<'name' | 'kind' | 'type' | 'trackId', string>>;
        condition?: { field: SemanticCommandListConditionField; equals: boolean };
        match?: SemanticCommandListMatch;
        excludeIds?: string[];
        quantity: SemanticCommandListQuantity;
    };
}): SemanticCommandListSelectorResolution {
    const { selector } = input;
    const sectionsById = new Map((input.context.sections ?? []).map((section) => [section.id, section]));
    if (selector.match !== undefined) {
        const matchError = validateMatchAgainstContext({
            entity: selector.entity,
            itemId: input.itemId,
            match: selector.match,
            roleFamilyByCanonicalRole: input.roleFamilyByCanonicalRole,
            sectionIds: new Set(sectionsById.keys()),
        });
        if (matchError !== null) {
            return { status: 'rejected', reason: matchError };
        }
    }
    const where = selector.where ?? {};
    const filtered = input.candidates.filter((candidate) => {
        if (candidate.entity !== selector.entity) {
            return false;
        }
        if (
            Object.entries(where).some(([key, value]) => candidate[key as keyof SemanticCommandListCandidate] !== value)
        ) {
            return false;
        }
        if (selector.condition !== undefined && candidate[selector.condition.field] !== selector.condition.equals) {
            return false;
        }
        return selector.match === undefined || matchesSelectorPredicates(candidate, selector.match, sectionsById);
    });
    const explicitlyExcludedIds = selector.excludeIds ?? [];
    const excludedIds = new Set(explicitlyExcludedIds);
    const stableIds = filtered.filter((candidate) => !excludedIds.has(candidate.id)).map((candidate) => candidate.id);

    const quantityCheck = checkQuantity(stableIds.length, selector.quantity);
    if (quantityCheck.status === 'rejected') {
        // The exact-quantity message stays byte-identical to its pre-`maximum` wording, read
        // literally by existing evidence; a `maximum` rejection names both the resolved count and
        // the maximum, since either could otherwise be read from the other's precondition failure.
        const reason =
            'exactly' in selector.quantity
                ? `Bulk selector ${input.itemId} resolved ${String(stableIds.length)} targets, not its exact quantity.`
                : `Bulk selector ${input.itemId} resolved ${String(stableIds.length)} targets, more than its maximum of ${String(quantityCheck.expectedCount)}.`;
        return {
            status: 'rejected',
            reason,
            detail: {
                kind: quantityCheck.kind,
                resolvedCount: stableIds.length,
                expectedCount: quantityCheck.expectedCount,
                candidateIds: stableIds.slice(0, 8),
            },
        };
    }
    return { status: 'accepted', stableIds };
}
