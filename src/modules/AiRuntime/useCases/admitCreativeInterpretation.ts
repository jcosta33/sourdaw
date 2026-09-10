import {
    type CreativeConstraintCandidate,
    type CreativeCreationSlot,
    type CreativeEditDimension,
    type CreativeEditDimensionCandidate,
    type CreativeInterpretationCatalog,
    type CreativeRequestAuthority,
    type CreativeRequestMode,
    type CreativeTargetCandidate,
} from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../transformers/toolCallParser';

export type CreativeInterpretationAdmission =
    | { status: 'admitted'; authority: CreativeRequestAuthority }
    | { status: 'clarify'; reason: string }
    | { status: 'rejected'; reason: string };

const REQUIRED_ARGUMENT_KEYS = [
    'catalogId',
    'modeId',
    'targetCandidateIds',
    'editDimensionCandidateIds',
    'constraintCandidateIds',
    'creationSlotIds',
    'uncertainty',
] as const;

const UNCERTAINTY_VALUES = ['none', 'artistic', 'authority'] as const;

type CreativeUncertainty = (typeof UNCERTAINTY_VALUES)[number];

const SCHEMA_MISMATCH = 'Creative interpretation arguments do not match the published schema.';
const STALE_CATALOG = 'Creative interpretation refers to a stale or unknown catalog.';
const UNKNOWN_CANDIDATE = 'Creative interpretation selected an unknown or duplicate candidate.';
const UNAVAILABLE_MODE = 'Creative interpretation selected an unavailable request mode.';
const CLARIFY_REASON = 'The request does not identify which objects or edit dimensions it delegates.';
const READ_ONLY_WITH_EDITS = 'A read-only interpretation cannot select edits or targets.';
const MISSING_FOR_MODE = 'Creative interpretation is missing a target, dimension, or creation slot for its mode.';
const CONTEXTUAL_REPLACED_EXPLICIT = 'Explicit request references cannot be replaced by contextual selection.';
const DIMENSION_SELECTED_AND_EXCLUDED = 'Creative interpretation both selects and excludes one edit dimension.';
const PROTECTED_OBJECT_TARGETED = 'Creative interpretation targets a protected object.';
const DETACHED_CREATION_SLOT = 'Creative creation slot is not attached to a selected target.';

type InterpretationArguments = {
    catalogId: string;
    modeId: string;
    targetCandidateIds: string[];
    editDimensionCandidateIds: string[];
    constraintCandidateIds: string[];
    creationSlotIds: string[];
    uncertainty: CreativeUncertainty;
};

type ResolvedSelections = {
    targets: CreativeTargetCandidate[];
    dimensions: CreativeEditDimensionCandidate[];
    constraints: CreativeConstraintCandidate[];
    creationSlots: CreativeCreationSlot[];
};

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isUncertainty(value: unknown): value is CreativeUncertainty {
    return UNCERTAINTY_VALUES.some((entry) => entry === value);
}

/** Accepts only the exact published argument shape; anything else is not this tool's contract. */
function parseInterpretationArguments(args: Record<string, unknown>): InterpretationArguments | null {
    const keys = Object.keys(args);
    if (keys.length !== REQUIRED_ARGUMENT_KEYS.length || REQUIRED_ARGUMENT_KEYS.some((key) => !keys.includes(key))) {
        return null;
    }
    const { catalogId, modeId, uncertainty } = args;
    if (
        typeof catalogId !== 'string' ||
        typeof modeId !== 'string' ||
        !isUncertainty(uncertainty) ||
        !isStringArray(args.targetCandidateIds) ||
        !isStringArray(args.editDimensionCandidateIds) ||
        !isStringArray(args.constraintCandidateIds) ||
        !isStringArray(args.creationSlotIds)
    ) {
        return null;
    }
    return {
        catalogId,
        modeId,
        targetCandidateIds: args.targetCandidateIds,
        editDimensionCandidateIds: args.editDimensionCandidateIds,
        constraintCandidateIds: args.constraintCandidateIds,
        creationSlotIds: args.creationSlotIds,
        uncertainty,
    };
}

/** Resolves one id family, refusing an unknown id and a repeated one alike. */
function resolveFamily<TCandidate extends { candidateId: string }>(
    selectedIds: readonly string[],
    candidates: readonly TCandidate[]
): TCandidate[] | null {
    if (new Set(selectedIds).size !== selectedIds.length) {
        return null;
    }
    const resolved: TCandidate[] = [];
    for (const selectedId of selectedIds) {
        const candidate = candidates.find((entry) => entry.candidateId === selectedId);
        if (candidate === undefined) {
            return null;
        }
        resolved.push(candidate);
    }
    return resolved;
}

function resolveSelections(
    catalog: CreativeInterpretationCatalog,
    args: InterpretationArguments
): ResolvedSelections | null {
    const targets = resolveFamily(args.targetCandidateIds, catalog.targets);
    const dimensions = resolveFamily(args.editDimensionCandidateIds, catalog.dimensions);
    const constraints = resolveFamily(args.constraintCandidateIds, catalog.constraints);
    const creationSlots = resolveFamily(args.creationSlotIds, catalog.creationSlots);
    if (targets === null || dimensions === null || constraints === null || creationSlots === null) {
        return null;
    }
    return { targets, dimensions, constraints, creationSlots };
}

/** What the selected mode itself requires or forbids, before any selection is compared to another. */
function findModeRuleViolation(
    mode: Exclude<CreativeRequestMode, 'unresolved'>,
    selections: ResolvedSelections
): string | null {
    const { targets, dimensions, creationSlots } = selections;
    if (mode === 'read-only' && (dimensions.length > 0 || creationSlots.length > 0 || targets.length > 0)) {
        return READ_ONLY_WITH_EDITS;
    }
    if (
        (mode === 'edit' && (targets.length === 0 || dimensions.length === 0)) ||
        (mode === 'create' && creationSlots.length === 0)
    ) {
        return MISSING_FOR_MODE;
    }
    return null;
}

/** What one selection says about another, and about what the catalog already published. */
function findSelectionRuleViolation(
    catalog: CreativeInterpretationCatalog,
    selections: ResolvedSelections
): string | null {
    const { targets, dimensions, constraints, creationSlots } = selections;
    // A named object outranks the current selection. Admitting a contextual target beside a published
    // explicit one would silently retarget the request at whatever happened to be selected.
    if (
        catalog.targets.some((candidate) => candidate.provenance === 'explicit-reference') &&
        targets.some((target) => target.provenance !== 'explicit-reference')
    ) {
        return CONTEXTUAL_REPLACED_EXPLICIT;
    }
    const selectedDimensions: CreativeEditDimension[] = dimensions.map((candidate) => candidate.dimension);
    if (
        constraints.some(
            (constraint) => constraint.kind === 'exclude-dimension' && selectedDimensions.includes(constraint.dimension)
        )
    ) {
        return DIMENSION_SELECTED_AND_EXCLUDED;
    }
    const targetObjectIds = new Set(targets.flatMap((target) => target.objectIds));
    if (
        constraints.some(
            (constraint) => constraint.kind === 'protect-object' && targetObjectIds.has(constraint.objectId)
        )
    ) {
        return PROTECTED_OBJECT_TARGETED;
    }
    const selectedTargetCandidateIds = new Set(targets.map((target) => target.candidateId));
    return creationSlots.some(
        (slot) => slot.parentCandidateId !== null && !selectedTargetCandidateIds.has(slot.parentCandidateId)
    )
        ? DETACHED_CREATION_SLOT
        : null;
}

function toAuthorityTargets(targets: readonly CreativeTargetCandidate[]): CreativeRequestAuthority['targets'] {
    return targets.map((target) => ({
        provenance: target.provenance,
        objectType: target.objectType,
        objectIds: [...target.objectIds],
        parentTrackId: target.parentTrackId,
    }));
}

function toProhibitions(constraints: readonly CreativeConstraintCandidate[]): CreativeRequestAuthority['prohibitions'] {
    return constraints.map((constraint) =>
        constraint.kind === 'exclude-dimension'
            ? { kind: 'exclude-dimension' as const, dimension: constraint.dimension }
            : { kind: 'protect-object' as const, objectId: constraint.objectId }
    );
}

function mintAuthority(input: {
    catalog: CreativeInterpretationCatalog;
    mode: Exclude<CreativeRequestMode, 'unresolved'>;
    selections: ResolvedSelections;
    uncertainty: Exclude<CreativeUncertainty, 'authority'>;
}): CreativeRequestAuthority {
    const { catalog, selections } = input;
    const parentObjectIdByCandidateId = new Map(
        selections.targets.map((target) => [target.candidateId, target.objectIds[0] ?? null])
    );
    return {
        schemaVersion: 1,
        authorityId: `creative-authority-${crypto.randomUUID()}`,
        catalogId: catalog.catalogId,
        requestDigest: catalog.requestDigest,
        revision: catalog.revision,
        selection: { ...catalog.selection, clipIds: [...catalog.selection.clipIds] },
        mode: input.mode,
        targets: toAuthorityTargets(selections.targets),
        editDimensions: selections.dimensions.map((candidate) => candidate.dimension),
        prohibitions: toProhibitions(selections.constraints),
        creationSlots: selections.creationSlots.map((slot) => ({
            objectType: slot.objectType,
            parentObjectId:
                slot.parentCandidateId === null
                    ? null
                    : (parentObjectIdByCandidateId.get(slot.parentCandidateId) ?? null),
            budget: slot.budget,
        })),
        uncertainty: input.uncertainty,
    };
}

/**
 * The only route from a provider tool call to a `CreativeRequestAuthority`. It selects from the
 * published catalog and never reads free text, so an admitted authority is always something the
 * application itself offered against the revision it offered it for.
 */
export function admitCreativeInterpretation(input: {
    catalog: CreativeInterpretationCatalog;
    call: ToolCallResult;
    projectRevision: string;
}): CreativeInterpretationAdmission {
    const { catalog } = input;
    const args = parseInterpretationArguments(input.call.arguments);
    if (args === null) {
        return { status: 'rejected', reason: SCHEMA_MISMATCH };
    }
    if (args.catalogId !== catalog.catalogId || input.projectRevision !== catalog.revision) {
        return { status: 'rejected', reason: STALE_CATALOG };
    }
    const selections = resolveSelections(catalog, args);
    if (selections === null) {
        return { status: 'rejected', reason: UNKNOWN_CANDIDATE };
    }
    const mode = catalog.modes.find((published) => published === args.modeId);
    if (mode === undefined) {
        return { status: 'rejected', reason: UNAVAILABLE_MODE };
    }
    // An admitted authority is a statement about what the request delegated. A run that cannot say
    // that owes the user a question, not a record standing in for one.
    if (args.uncertainty === 'authority' || mode === 'unresolved') {
        return { status: 'clarify', reason: CLARIFY_REASON };
    }
    const violation = findModeRuleViolation(mode, selections) ?? findSelectionRuleViolation(catalog, selections);
    if (violation !== null) {
        return { status: 'rejected', reason: violation };
    }
    return {
        status: 'admitted',
        authority: structuredClone(mintAuthority({ catalog, mode, selections, uncertainty: args.uncertainty })),
    };
}
