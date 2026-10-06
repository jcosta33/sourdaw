import { type ProjectContext } from '../../models/ProjectContext';
import { type BulkSetRunWrittenFact } from '../../models/SemanticCommandList';
import {
    collectSemanticCommandListCandidates,
    type SemanticCommandListCandidate,
} from '../../services/semanticCommandListCandidates';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';
import { type ArbitraryCommandListEvidence } from '../compileArbitraryCommandList';

type RebasedSlice =
    { status: 'rebased'; evidence: ArbitraryCommandListEvidence } | { status: 'rejected'; reason: string };

type Precondition = ArbitraryCommandListEvidence['selectors'][number]['preconditions'][number];

type RunWrittenField = BulkSetRunWrittenFact['field'];

/**
 * The candidate facts each command writes: on the object it targets, and on every candidate whose
 * owner track it targets. A command missing here writes no fact a later batch accepts, so a later
 * batch whose candidates it changed is refused rather than assumed unaffected.
 */
const RUN_WRITTEN_FACTS_BY_COMMAND: Readonly<
    Record<string, { argument: string; ownFields: readonly RunWrittenField[]; ownerFields: readonly RunWrittenField[] }>
> = {
    muteTrack: { argument: 'trackId', ownFields: ['muted'], ownerFields: ['ownerMuted'] },
    muteClip: { argument: 'clipId', ownFields: ['muted'], ownerFields: [] },
    lockClip: { argument: 'clipId', ownFields: ['locked'], ownerFields: [] },
    bypassDevice: { argument: 'deviceId', ownFields: ['bypassed'], ownerFields: [] },
    addDevice: { argument: 'trackId', ownFields: [], ownerFields: ['ownerDeviceTypes', 'ownerTags'] },
};

function addWrittenField(written: Map<string, Set<RunWrittenField>>, candidateId: string, field: RunWrittenField) {
    const fields = written.get(candidateId) ?? new Set<RunWrittenField>();
    fields.add(field);
    written.set(candidateId, fields);
}

/** Which facts of which live candidates the run's earlier batches wrote. */
function collectRunWrittenFields(
    earlierCommands: readonly ToolCallResult[],
    candidates: readonly SemanticCommandListCandidate[]
): Map<string, Set<RunWrittenField>> {
    const written = new Map<string, Set<RunWrittenField>>();
    for (const command of earlierCommands) {
        const rule = RUN_WRITTEN_FACTS_BY_COMMAND[command.name];
        const target = rule === undefined ? undefined : command.arguments[rule.argument];
        if (rule === undefined || typeof target !== 'string') {
            continue;
        }
        for (const field of rule.ownFields) {
            addWrittenField(written, target, field);
        }
        const owned = rule.ownerFields.length === 0 ? [] : candidates.filter((c) => c.ownerTrackId === target);
        for (const candidate of owned) {
            for (const field of rule.ownerFields) {
                addWrittenField(written, candidate.id, field);
            }
        }
    }
    return written;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each recorded candidate as the list was compiled, read back from its fingerprint. */
function readRecordedCandidates(
    recordedFingerprints: ReadonlyMap<string, string>
): Map<string, Record<string, unknown>> {
    const recorded = new Map<string, Record<string, unknown>>();
    for (const [candidateId, fingerprint] of recordedFingerprints) {
        try {
            const parsed: unknown = JSON.parse(fingerprint);
            if (isRecord(parsed)) {
                recorded.set(candidateId, parsed);
            }
        } catch {
            // An unreadable fingerprint restores nothing, so that candidate is read live and refused on change.
        }
    }
    return recorded;
}

function toRunWrittenFact(candidateId: string, field: RunWrittenField, value: unknown): BulkSetRunWrittenFact {
    if (field === 'ownerDeviceTypes' || field === 'ownerTags') {
        const strings = Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
        return { candidateId, field, value: strings };
    }
    return { candidateId, field, value: typeof value === 'boolean' ? value : null };
}

function collectRunWrittenFacts(
    written: ReadonlyMap<string, ReadonlySet<RunWrittenField>>,
    recorded: ReadonlyMap<string, Record<string, unknown>>
): BulkSetRunWrittenFact[] {
    const facts: BulkSetRunWrittenFact[] = [];
    for (const [candidateId, fields] of written) {
        const original = recorded.get(candidateId);
        if (original === undefined) {
            continue;
        }
        for (const field of fields) {
            facts.push(toRunWrittenFact(candidateId, field, original[field]));
        }
    }
    return facts;
}

/**
 * A precondition moves to the live candidate only when the live candidate differs from the compiled
 * one in nothing but facts the run's earlier batches wrote. Any other difference keeps the compiled
 * fingerprint, which the evidence validator then refuses.
 */
function rebasePrecondition(
    precondition: Precondition,
    live: SemanticCommandListCandidate | undefined,
    writtenFields: ReadonlySet<RunWrittenField> | undefined,
    original: Record<string, unknown> | undefined
): Precondition {
    if (live === undefined || writtenFields === undefined || original === undefined) {
        return precondition;
    }
    const restored = Object.fromEntries(
        Object.entries(live).map(([key, value]) => [key, isWrittenField(writtenFields, key) ? original[key] : value])
    );
    if (JSON.stringify(restored) !== precondition.fingerprint) {
        return precondition;
    }
    return { stableId: precondition.stableId, fingerprint: JSON.stringify(live) };
}

function isWrittenField(writtenFields: ReadonlySet<RunWrittenField>, key: string): boolean {
    return [...writtenFields].some((field) => field === key);
}

/**
 * Moves a later batch's compiled slice onto the revision it is now proposed at. A target the slice
 * names that is gone is refused outright. The facts the run's own earlier batches wrote — named by
 * the commands those batches carried, on the objects they targeted and the candidates those objects
 * own — are accepted: a precondition differing only in them moves to the live candidate, and every
 * selector replay restores them to their compiled values. Every other fact is compared as compiled,
 * so a change anyone else made since still refuses the batch.
 */
export function rebaseBulkSetSliceEvidence(input: {
    evidence: ArbitraryCommandListEvidence;
    context: ProjectContext;
    revision: string;
    /** Every command the run's earlier, committed batches carried. */
    earlierCommands: readonly ToolCallResult[];
    /** Every candidate fingerprint the schedule's slices recorded at compile time, by candidate id. */
    recordedFingerprints: ReadonlyMap<string, string>;
}): RebasedSlice {
    const candidates = collectSemanticCommandListCandidates({
        context: input.context,
        roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
    });
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const missing = input.evidence.selectors
        .flatMap((selector) => selector.preconditions)
        .find((precondition) => !candidatesById.has(precondition.stableId));
    if (missing !== undefined) {
        return { status: 'rejected', reason: `Target ${missing.stableId} is no longer in the project.` };
    }
    const written = collectRunWrittenFields(input.earlierCommands, candidates);
    const recorded = readRecordedCandidates(input.recordedFingerprints);
    const runWrittenFacts = collectRunWrittenFacts(written, recorded);
    const rebased: ArbitraryCommandListEvidence = {
        ...structuredClone(input.evidence),
        snapshotRevision: input.revision,
        selectors: input.evidence.selectors.map((selector) => ({
            ...structuredClone(selector),
            preconditions: selector.preconditions.map((precondition) =>
                rebasePrecondition(
                    precondition,
                    candidatesById.get(precondition.stableId),
                    written.get(precondition.stableId),
                    recorded.get(precondition.stableId)
                )
            ),
        })),
    };
    if (runWrittenFacts.length > 0) {
        rebased.runWrittenFacts = runWrittenFacts;
    }
    return { status: 'rebased', evidence: rebased };
}
