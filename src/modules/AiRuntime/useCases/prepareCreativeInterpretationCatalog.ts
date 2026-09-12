import { type getExecutableAppActionEffect } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import {
    CREATIVE_EDIT_DIMENSIONS,
    type CreativeConstraintCandidate,
    type CreativeEditDimension,
    type CreativeCreationSlot,
    type CreativeEditDimensionCandidate,
    type CreativeInterpretationCatalog,
    type CreativeRequestMode,
    type CreativeTargetCandidate,
    getCreativeSelectionSnapshot,
} from '../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextClip } from '../models/ProjectContext';

import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';

/**
 * Provisional ceilings on what one admitted creation slot may produce. They sit below the
 * MAX_LLM_ACTIONS_PER_BATCH-derived command budgets that actually bound a batch, and they are
 * interpretation bounds rather than musical limits: nothing here says a part may not be longer.
 */
const TRACK_CREATION_BUDGET = 4;
const CLIP_CREATION_BUDGET = 8;
const NOTE_CREATION_BUDGET = 256;
const DEVICE_CREATION_BUDGET = 4;

const QUOTED_SPAN_PATTERN = /'([^']+)'|"([^"]+)"|“([^”]+)”/gu;

/**
 * Command keeps its effect vocabulary private to the module, so the binding is read off the callable
 * contract the barrel does publish rather than off a type export.
 */
type CommandEffectDimension = NonNullable<ReturnType<typeof getExecutableAppActionEffect>>['dimensions'][number];

/**
 * The published dimensions, retyped through the Command module's own effect vocabulary. Renaming or
 * dropping an effect dimension there stops this file compiling, which is the point: the catalog must
 * never offer a dimension no handler claims to mutate.
 */
const PUBLISHED_EDIT_DIMENSIONS: readonly Extract<CommandEffectDimension, CreativeEditDimension>[] =
    CREATIVE_EDIT_DIMENSIONS;

type ClipWithTrack = { clip: ProjectContextClip; trackId: string };

function collectClips(context: ProjectContext): ClipWithTrack[] {
    return context.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, trackId: track.id })));
}

/** Whole-word containment over the same folded vocabulary the reference grounder uses. */
function mentionsName(normalizedPrompt: string, name: string): boolean {
    const normalizedName = normalizeAgentReferenceText(name);
    if (normalizedName.length === 0) {
        return false;
    }
    return ` ${normalizedPrompt} `.includes(` ${normalizedName} `);
}

function collectQuotedSpans(prompt: string): string[] {
    const spans: string[] = [];
    for (const match of prompt.matchAll(QUOTED_SPAN_PATTERN)) {
        const span = match[1] ?? match[2] ?? match[3];
        if (span !== undefined && span.length > 0 && !spans.includes(span)) {
            spans.push(span);
        }
    }
    return spans;
}

function collectExplicitTargets(prompt: string, context: ProjectContext): CreativeTargetCandidate[] {
    const normalizedPrompt = normalizeAgentReferenceText(prompt);
    const targets: CreativeTargetCandidate[] = [];
    for (const track of context.tracks) {
        if (mentionsName(normalizedPrompt, track.name)) {
            targets.push({
                candidateId: `target-${String(targets.length + 1)}`,
                provenance: 'explicit-reference',
                objectType: 'track',
                objectIds: [track.id],
                parentTrackId: null,
                label: track.name,
            });
        }
    }
    for (const { clip, trackId } of collectClips(context)) {
        if (mentionsName(normalizedPrompt, clip.name)) {
            targets.push({
                candidateId: `target-${String(targets.length + 1)}`,
                provenance: 'explicit-reference',
                objectType: 'clip',
                objectIds: [clip.id],
                parentTrackId: trackId,
                label: clip.name,
            });
        }
    }
    return targets;
}

/**
 * Selection only speaks when the request named nothing. A plural clip selection publishes one
 * `clip-set`, never a scalar clip derived from it, so an admitted authority can never narrow a
 * multi-clip request down to whichever clip happened to be focused last.
 */
function collectContextualTargets(context: ProjectContext): CreativeTargetCandidate[] {
    const targets: CreativeTargetCandidate[] = [];
    const nextId = () => `target-${String(targets.length + 1)}`;
    const selectedTrack = context.tracks.find((track) => track.id === context.selectedTrackId) ?? null;
    if (selectedTrack !== null) {
        targets.push({
            candidateId: nextId(),
            provenance: 'contextual-selection',
            objectType: 'track',
            objectIds: [selectedTrack.id],
            parentTrackId: null,
            label: selectedTrack.name,
        });
    }
    if (context.selectedClipIds.length > 1) {
        targets.push({
            candidateId: nextId(),
            provenance: 'contextual-selection',
            objectType: 'clip-set',
            objectIds: [...context.selectedClipIds],
            parentTrackId: null,
            label: `${String(context.selectedClipIds.length)} selected clips`,
        });
        return targets;
    }
    const selectedClip =
        context.selectedClipId === null
            ? undefined
            : collectClips(context).find(({ clip }) => clip.id === context.selectedClipId);
    if (selectedClip === undefined) {
        return targets;
    }
    targets.push({
        candidateId: nextId(),
        provenance: 'contextual-selection',
        objectType: 'clip',
        objectIds: [selectedClip.clip.id],
        parentTrackId: selectedClip.trackId,
        label: selectedClip.clip.name,
    });
    if (!targets.some((target) => target.objectType === 'track' && target.objectIds[0] === selectedClip.trackId)) {
        const parentTrack = context.tracks.find((track) => track.id === selectedClip.trackId);
        targets.push({
            candidateId: nextId(),
            provenance: 'contextual-selection',
            objectType: 'track',
            objectIds: [selectedClip.trackId],
            parentTrackId: null,
            label: parentTrack?.name ?? selectedClip.trackId,
        });
    }
    return targets;
}

function collectConstraints(context: ProjectContext): CreativeConstraintCandidate[] {
    const constraints: CreativeConstraintCandidate[] = PUBLISHED_EDIT_DIMENSIONS.map((dimension, index) => ({
        candidateId: `constraint-${String(index + 1)}`,
        kind: 'exclude-dimension' as const,
        dimension,
    }));
    const objectsById = new Map<string, string>([
        ...context.tracks.map((track): [string, string] => [track.id, track.name]),
        ...collectClips(context).map(({ clip }): [string, string] => [clip.id, clip.name]),
    ]);
    for (const lock of context.productionBrief?.locks ?? []) {
        const objectId = lock.scope.kind === 'track' ? lock.scope.trackId : null;
        const lockedObjectId = lock.scope.kind === 'object' ? lock.scope.objectId : objectId;
        if (lockedObjectId === null) {
            continue;
        }
        constraints.push({
            candidateId: `constraint-${String(constraints.length + 1)}`,
            kind: 'protect-object',
            objectId: lockedObjectId,
            label: objectsById.get(lockedObjectId) ?? lockedObjectId,
        });
    }
    return constraints;
}

function collectCreationSlots(targets: readonly CreativeTargetCandidate[]): CreativeCreationSlot[] {
    const slots: CreativeCreationSlot[] = [
        { candidateId: 'slot-1', objectType: 'track', parentCandidateId: null, budget: TRACK_CREATION_BUDGET },
    ];
    const nextId = () => `slot-${String(slots.length + 1)}`;
    const trackCandidate = targets.find((target) => target.objectType === 'track');
    // Pushed one at a time: `nextId` counts what the list already holds, so minting several ids in
    // one push call would hand every slot in it the same id and make all but the first unselectable.
    if (trackCandidate !== undefined) {
        slots.push({
            candidateId: nextId(),
            objectType: 'clip',
            parentCandidateId: trackCandidate.candidateId,
            budget: CLIP_CREATION_BUDGET,
        });
        slots.push({
            candidateId: nextId(),
            objectType: 'notes',
            parentCandidateId: trackCandidate.candidateId,
            budget: NOTE_CREATION_BUDGET,
        });
        slots.push({
            candidateId: nextId(),
            objectType: 'device',
            parentCandidateId: trackCandidate.candidateId,
            budget: DEVICE_CREATION_BUDGET,
        });
    }
    const clipCandidate = targets.find((target) => target.objectType === 'clip');
    if (clipCandidate !== undefined) {
        slots.push({
            candidateId: nextId(),
            objectType: 'notes',
            parentCandidateId: clipCandidate.candidateId,
            budget: NOTE_CREATION_BUDGET,
        });
    }
    return slots;
}

/**
 * Publishes what a delegated request could legitimately mean against one project snapshot. It reads
 * project data and prompt text and decides nothing: every candidate carries an application-minted
 * opaque id, and only ids from this catalog can later be admitted.
 */
export function prepareCreativeInterpretationCatalog(input: {
    prompt: string;
    context: ProjectContext;
    projectRevision: string;
}): CreativeInterpretationCatalog {
    const { context, projectRevision } = input;
    const trimmedPrompt = input.prompt.trim();
    const requestDigest = digest(trimmedPrompt);
    const selection = getCreativeSelectionSnapshot(context);
    const catalogId = `creative-${digest({ requestDigest, revision: projectRevision, selection }).slice(0, 16)}`;

    const explicitTargets = collectExplicitTargets(trimmedPrompt, context);
    const knownNames = new Set(
        [...context.tracks.map((track) => track.name), ...collectClips(context).map(({ clip }) => clip.name)].map(
            (name) => normalizeAgentReferenceText(name)
        )
    );
    const unresolvedExplicitReferences = collectQuotedSpans(trimmedPrompt).filter(
        (span) => !knownNames.has(normalizeAgentReferenceText(span))
    );

    const dimensions: CreativeEditDimensionCandidate[] = PUBLISHED_EDIT_DIMENSIONS.map((dimension) => ({
        candidateId: `dimension-${dimension}`,
        dimension,
    }));
    const constraints = collectConstraints(context);

    // A quoted name the project does not hold is a request about something that is not here. Falling
    // back to the current selection would answer a different request than the one that was made.
    if (unresolvedExplicitReferences.length > 0) {
        return {
            schemaVersion: 1,
            catalogId,
            revision: projectRevision,
            requestDigest,
            selection,
            unresolvedExplicitReferences,
            modes: ['unresolved'],
            targets: [],
            dimensions,
            constraints,
            creationSlots: collectCreationSlots([]),
        };
    }

    const targets = explicitTargets.length > 0 ? explicitTargets : collectContextualTargets(context);
    const creationSlots = collectCreationSlots(targets);
    // `edit` needs a target to be admissible at all, so a catalog without one does not publish it:
    // a mode no admission could ever accept would only invite a rejected turn.
    const modes: CreativeRequestMode[] = targets.length > 0 ? ['edit', 'create', 'read-only'] : ['create', 'read-only'];

    return {
        schemaVersion: 1,
        catalogId,
        revision: projectRevision,
        requestDigest,
        selection,
        unresolvedExplicitReferences,
        modes,
        targets,
        dimensions,
        constraints,
        creationSlots,
    };
}
