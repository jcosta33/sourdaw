import { type ProjectContext } from '../../models/ProjectContext';
import { type BulkSetRunWrittenFact } from '../../models/SemanticCommandList';
import { isRunWrittenValue } from '../../services/bulkSetSliceReplay';
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

/** What the run wrote to one fact: the last boolean it set, or every entry it added to an array fact. */
type RunWrite = { written: boolean | null; added: string[] };

type RunWrites = Map<string, Map<RunWrittenField, RunWrite>>;

/**
 * The candidate facts each command writes: on the object it targets, and on every candidate whose
 * owner track it targets, with the argument that carries what it writes. A command missing here
 * writes no fact a later batch accepts, so a later batch whose candidates it changed is refused
 * rather than assumed unaffected.
 */
const RUN_WRITTEN_FACTS_BY_COMMAND: Readonly<
    Record<
        string,
        {
            argument: string;
            valueArgument: string;
            ownFields: readonly RunWrittenField[];
            ownerFields: readonly RunWrittenField[];
        }
    >
> = {
    muteTrack: { argument: 'trackId', valueArgument: 'muted', ownFields: ['muted'], ownerFields: ['ownerMuted'] },
    muteClip: { argument: 'clipId', valueArgument: 'muted', ownFields: ['muted'], ownerFields: [] },
    lockClip: { argument: 'clipId', valueArgument: 'locked', ownFields: ['locked'], ownerFields: [] },
    bypassDevice: { argument: 'deviceId', valueArgument: 'bypassed', ownFields: ['bypassed'], ownerFields: [] },
    addDevice: {
        argument: 'trackId',
        valueArgument: 'deviceType',
        ownFields: [],
        ownerFields: ['ownerDeviceTypes', 'ownerTags'],
    },
};

function isArrayField(field: RunWrittenField): field is 'ownerDeviceTypes' | 'ownerTags' {
    return field === 'ownerDeviceTypes' || field === 'ownerTags';
}

/**
 * Records one write. A value of the wrong shape records nothing, so the fact it changed is not
 * accepted and the later batch is refused rather than trusting a write it cannot describe.
 */
function recordWrite(writes: RunWrites, candidateId: string, field: RunWrittenField, value: unknown): void {
    const fields = writes.get(candidateId) ?? new Map<RunWrittenField, RunWrite>();
    const write = fields.get(field) ?? { written: null, added: [] };
    if (isArrayField(field) && typeof value === 'string') {
        fields.set(field, { ...write, added: [...write.added, value] });
    } else if (!isArrayField(field) && typeof value === 'boolean') {
        fields.set(field, { ...write, written: value });
    }
    writes.set(candidateId, fields);
}

/** What the run's earlier batches wrote to which facts of which live candidates. */
function collectRunWrites(
    earlierCommands: readonly ToolCallResult[],
    candidates: readonly SemanticCommandListCandidate[]
): RunWrites {
    const writes: RunWrites = new Map();
    for (const command of earlierCommands) {
        const rule = RUN_WRITTEN_FACTS_BY_COMMAND[command.name];
        const target = rule === undefined ? undefined : command.arguments[rule.argument];
        if (rule === undefined || typeof target !== 'string') {
            continue;
        }
        const value = command.arguments[rule.valueArgument];
        for (const field of rule.ownFields) {
            recordWrite(writes, target, field, value);
        }
        const owned = rule.ownerFields.length === 0 ? [] : candidates.filter((c) => c.ownerTrackId === target);
        for (const candidate of owned) {
            for (const field of rule.ownerFields) {
                recordWrite(writes, candidate.id, field, value);
            }
        }
    }
    return writes;
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

function toRunWrittenFact(
    candidateId: string,
    field: RunWrittenField,
    compiled: unknown,
    write: RunWrite
): BulkSetRunWrittenFact | null {
    if (isArrayField(field)) {
        if (write.added.length === 0) {
            return null;
        }
        const strings = Array.isArray(compiled) && compiled.every((entry) => typeof entry === 'string');
        return { candidateId, field, value: strings ? compiled : null, added: [...write.added] };
    }
    if (write.written === null) {
        return null;
    }
    return { candidateId, field, value: typeof compiled === 'boolean' ? compiled : null, written: write.written };
}

function collectRunWrittenFacts(
    writes: RunWrites,
    recorded: ReadonlyMap<string, Record<string, unknown>>
): BulkSetRunWrittenFact[] {
    const facts: BulkSetRunWrittenFact[] = [];
    for (const [candidateId, fields] of writes) {
        const original = recorded.get(candidateId);
        if (original === undefined) {
            continue;
        }
        for (const [field, write] of fields) {
            const fact = toRunWrittenFact(candidateId, field, original[field], write);
            if (fact !== null) {
                facts.push(fact);
            }
        }
    }
    return facts;
}

/**
 * A precondition moves to the live candidate only when every fact the run wrote holds exactly the
 * run's own write and the candidate differs from the compiled one in nothing else. Any other
 * difference keeps the compiled fingerprint, which the evidence validator then refuses.
 */
function rebasePrecondition(
    precondition: Precondition,
    live: SemanticCommandListCandidate | undefined,
    facts: readonly BulkSetRunWrittenFact[],
    original: Record<string, unknown> | undefined
): Precondition {
    if (live === undefined || facts.length === 0 || original === undefined) {
        return precondition;
    }
    if (!facts.every((fact) => isRunWrittenValue(fact, live[fact.field]))) {
        return precondition;
    }
    const writtenFields = new Set<string>(facts.map((fact) => fact.field));
    const restored = Object.fromEntries(
        Object.entries(live).map(([key, value]) => [key, writtenFields.has(key) ? original[key] : value])
    );
    if (JSON.stringify(restored) !== precondition.fingerprint) {
        return precondition;
    }
    return { stableId: precondition.stableId, fingerprint: JSON.stringify(live) };
}

/**
 * Moves a later batch's compiled slice onto the revision it is now proposed at. A target the slice
 * names that is gone is refused outright. The facts the run's own earlier batches wrote — named by
 * the commands those batches carried, on the objects they targeted and the candidates those objects
 * own — are accepted only while each holds exactly the compiled value plus the run's own write: a
 * precondition differing in nothing else moves to the live candidate, and every selector replay
 * restores them to their compiled values. Every other fact, and a written fact anyone else changed
 * further, is compared as compiled, so that change still refuses the batch.
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
    const recorded = readRecordedCandidates(input.recordedFingerprints);
    const runWrittenFacts = collectRunWrittenFacts(collectRunWrites(input.earlierCommands, candidates), recorded);
    const rebased: ArbitraryCommandListEvidence = {
        ...structuredClone(input.evidence),
        snapshotRevision: input.revision,
        selectors: input.evidence.selectors.map((selector) => ({
            ...structuredClone(selector),
            preconditions: selector.preconditions.map((precondition) =>
                rebasePrecondition(
                    precondition,
                    candidatesById.get(precondition.stableId),
                    runWrittenFacts.filter((fact) => fact.candidateId === precondition.stableId),
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
