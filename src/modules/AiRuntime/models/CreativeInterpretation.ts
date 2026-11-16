import { type ProjectContext } from './ProjectContext';
import { type ToolSchema } from './ToolDefinitions';

export const CREATIVE_INTERPRETATION_TOOL_NAME = 'selectCreativeInterpretation';
export const PUBLIC_CREATIVE_INTERPRETATION_MAX_BYTES = 512;

/** Public musical reading only; never model reasoning or execution authority. */
export function isPublicCreativeInterpretation(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        new TextEncoder().encode(value).byteLength <= PUBLIC_CREATIVE_INTERPRETATION_MAX_BYTES
    );
}

/** Read only a successfully admitted creative intake, never a receipt summary or request. */
export function readPublicCreativeInterpretation(
    receipts: readonly { toolName: string; status: string; data: unknown }[]
): string | null {
    for (const receipt of receipts) {
        if (
            receipt.toolName !== CREATIVE_INTERPRETATION_TOOL_NAME ||
            receipt.status !== 'success' ||
            typeof receipt.data !== 'object' ||
            receipt.data === null ||
            Array.isArray(receipt.data)
        )
            continue;
        const data = receipt.data as Record<string, unknown>;
        if (
            data.kind === 'metric-intent' &&
            typeof data.authorityId === 'string' &&
            data.authorityId.length > 0 &&
            isPublicCreativeInterpretation(data.creativeInterpretation)
        )
            return data.creativeInterpretation;
    }
    return null;
}

/**
 * `brief` asks to write the project's production brief rather than to change its sound: it selects no
 * target, dimension or slot, grants no write authority over the project, and only `brief.compile`
 * completes it.
 */
export type CreativeRequestMode = 'edit' | 'create' | 'read-only' | 'brief' | 'unresolved';

/**
 * Why a target was offered: the request named it (`explicit-reference`), named its role family
 * (`role-reference`), or named nothing and pointed at the selection (`contextual-selection`), or the
 * application offered every plannable source because a perceptual request leaves the choice to the
 * agent (`agent-decided`). Persisted authority carries it, so values are only ever added.
 */
export type CreativeTargetProvenance =
    'explicit-reference' | 'contextual-selection' | 'new-object-slot' | 'role-reference' | 'agent-decided';

/**
 * The edit dimensions a delegated request may hand over. These are Command effect dimensions rather
 * than a parallel vocabulary, so an admitted authority names the same thing the handlers say they
 * mutate. Models sit below use cases and cannot import that vocabulary here, so
 * `prepareCreativeInterpretationCatalog` binds this union to it and fails to compile if it drifts.
 */
export type CreativeEditDimension = 'processing' | 'midi-content' | 'arrangement';

export const CREATIVE_EDIT_DIMENSIONS: readonly CreativeEditDimension[] = ['processing', 'midi-content', 'arrangement'];

export type CreativeTargetCandidate = {
    candidateId: string;
    provenance: CreativeTargetProvenance;
    objectType: 'track' | 'clip' | 'clip-set';
    objectIds: string[];
    parentTrackId: string | null;
    label: string;
};

export type CreativeEditDimensionCandidate = {
    candidateId: string;
    dimension: CreativeEditDimension;
};

export type CreativeConstraintCandidate =
    | { candidateId: string; kind: 'exclude-dimension'; dimension: CreativeEditDimension }
    | { candidateId: string; kind: 'protect-object'; objectId: string; label: string };

export type CreativeCreationSlot = {
    candidateId: string;
    objectType: 'track' | 'clip' | 'notes' | 'device';
    /** A target candidate id, or a creation slot candidate id when the parent is created this batch. */
    parentCandidateId: string | null;
    budget: number;
};

export type CreativeSelectionSnapshot = {
    trackId: string | null;
    clipId: string | null;
    clipIds: string[];
    activeView: ProjectContext['activeView'];
};

export type CreativeInterpretationCatalog = {
    schemaVersion: 1;
    catalogId: string;
    revision: string;
    requestDigest: string;
    selection: CreativeSelectionSnapshot;
    unresolvedExplicitReferences: string[];
    modes: CreativeRequestMode[];
    targets: CreativeTargetCandidate[];
    dimensions: CreativeEditDimensionCandidate[];
    constraints: CreativeConstraintCandidate[];
    creationSlots: CreativeCreationSlot[];
};

/**
 * The application's own record of what a delegated request was admitted to mean. It is minted only
 * from published candidates, never from provider prose, and every consumer reads a `structuredClone`
 * of it, so no later turn can widen what the user actually delegated.
 */
export type CreativeRequestAuthority = Readonly<{
    schemaVersion: 1;
    authorityId: string;
    catalogId: string;
    requestDigest: string;
    revision: string;
    selection: Readonly<{
        trackId: string | null;
        clipId: string | null;
        clipIds: readonly string[];
        activeView: ProjectContext['activeView'];
    }>;
    mode: Exclude<CreativeRequestMode, 'unresolved'>;
    targets: readonly Readonly<{
        provenance: CreativeTargetProvenance;
        objectType: 'track' | 'clip' | 'clip-set';
        objectIds: readonly string[];
        parentTrackId: string | null;
    }>[];
    editDimensions: readonly CreativeEditDimension[];
    prohibitions: readonly Readonly<
        { kind: 'exclude-dimension'; dimension: CreativeEditDimension } | { kind: 'protect-object'; objectId: string }
    >[];
    creationSlots: readonly Readonly<{
        objectType: 'track' | 'clip' | 'notes' | 'device';
        parentObjectId: string | null;
        /** Present when the slot hangs under a track this batch creates, which no project id names. */
        parentCreatedObjectType?: 'track';
        budget: number;
    }>[];
    uncertainty: 'none' | 'artistic';
}>;

/**
 * The selection the catalog was published against. The bounded correction compares this snapshot
 * rather than the whole context: a track renamed mid-run does not change what the request delegated,
 * but a different selected object does.
 */
export function getCreativeSelectionSnapshot(context: ProjectContext): CreativeSelectionSnapshot {
    return {
        trackId: context.selectedTrackId,
        clipId: context.selectedClipId,
        clipIds: [...context.selectedClipIds],
        activeView: context.activeView,
    };
}

function candidateIdEnum(candidateIds: readonly string[], family: string): Record<string, unknown> {
    return {
        type: 'array',
        items: { enum: [...candidateIds] },
        description:
            candidateIds.length === 0
                ? `No ${family} candidates are available for this request; pass an empty array.`
                : `Application-published ${family} candidate ids. Choose only from this list.`,
    };
}

export function createCreativeInterpretationToolSchema(catalog: CreativeInterpretationCatalog): ToolSchema {
    return {
        type: 'function',
        function: {
            name: CREATIVE_INTERPRETATION_TOOL_NAME,
            description:
                'Select the application-published interpretation of a musical or artistic request before proposing ordinary commands. Call it alone in a turn. Never call it for explicit literal edits or when a specialized workflow covers the request. Set uncertainty to "authority" when the request\'s objects or edit dimensions are ambiguous and the run must clarify.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    catalogId: { const: catalog.catalogId },
                    modeId: { enum: [...catalog.modes] },
                    targetCandidateIds: candidateIdEnum(
                        catalog.targets.map((target) => target.candidateId),
                        'target'
                    ),
                    editDimensionCandidateIds: candidateIdEnum(
                        catalog.dimensions.map((dimension) => dimension.candidateId),
                        'edit dimension'
                    ),
                    constraintCandidateIds: candidateIdEnum(
                        catalog.constraints.map((constraint) => constraint.candidateId),
                        'constraint'
                    ),
                    creationSlotIds: candidateIdEnum(
                        catalog.creationSlots.map((slot) => slot.candidateId),
                        'creation slot'
                    ),
                    uncertainty: { enum: ['none', 'artistic', 'authority'] },
                },
                required: [
                    'catalogId',
                    'modeId',
                    'targetCandidateIds',
                    'editDimensionCandidateIds',
                    'constraintCandidateIds',
                    'creationSlotIds',
                    'uncertainty',
                ],
            },
        },
    };
}
