import { digest } from '#/utils/canonicalDigest';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { SEMANTIC_COMMAND_LIST_ROLE_FAMILIES } from '../models/SemanticCommandList';
import {
    SCHEDULED_VIBE_RUN_PLAN_MAX_BYTES,
    type ScheduledVibeRunBatch,
    type VibeRunInitialEvidence,
    type VibeRunInitialWitness,
    type VibeRunSilentRange,
    type VibeRunSilentTarget,
    type VibeRunVerificationRange,
    type ScheduledVibeRunPlan,
    type VibeRunBatchTarget,
    type VibeRunExpectedDelta,
} from '../models/VibeRunPlan';

import { recordedSilenceHolds } from './isSilentVibeRunCell';
import { readVibeRunInitialReceipt } from './readVibeRunInitialReceipt';

const DIRECTIONS: readonly VibeRunExpectedDelta['direction'][] = ['increase', 'decrease', 'hold'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function readTexts(value: unknown): string[] | null {
    return Array.isArray(value) && value.every(isText) && new Set(value).size === value.length ? [...value] : null;
}

function readEvery<Entry>(value: unknown, read: (entry: unknown) => Entry | null): Entry[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const entries: Entry[] = [];
    for (const candidate of value) {
        const entry = read(candidate);
        if (entry === null) {
            return null;
        }
        entries.push(entry);
    }
    return entries;
}

function readExpectedDelta(value: unknown): VibeRunExpectedDelta | null {
    if (!isRecord(value) || !isText(value.descriptor) || !isText(value.metric)) {
        return null;
    }
    const { band, direction: storedDirection } = value;
    const direction = DIRECTIONS.find((entry) => entry === storedDirection);
    if (direction === undefined || (band !== null && !isText(band))) {
        return null;
    }
    return { descriptor: value.descriptor, metric: value.metric, band, direction };
}

function readTarget(value: unknown): VibeRunBatchTarget | null {
    if (!isRecord(value) || !isText(value.targetId) || !isCount(value.commandCount)) {
        return null;
    }
    const recipeIds = readTexts(value.recipeIds);
    const expectedDeltas = readEvery(value.expectedDeltas, readExpectedDelta);
    if (recipeIds === null || recipeIds.length === 0 || expectedDeltas === null) {
        return null;
    }
    return { targetId: value.targetId, recipeIds, expectedDeltas, commandCount: value.commandCount };
}

function readBatch(value: unknown): ScheduledVibeRunBatch | null {
    if (
        !isRecord(value) ||
        !isText(value.id) ||
        !isCount(value.ordinal) ||
        !isCount(value.commandCount) ||
        value.commandCount > MAX_LLM_ACTIONS_PER_BATCH
    ) {
        return null;
    }
    const objective = isRecord(value.objective) ? value.objective : null;
    const descriptors = readTexts(objective?.descriptors);
    const role = SEMANTIC_COMMAND_LIST_ROLE_FAMILIES.find((family) => family === objective?.role);
    const targetIds = readTexts(value.targetIds);
    const targets = readEvery(value.targets, readTarget);
    if (
        descriptors === null ||
        role === undefined ||
        targetIds === null ||
        targets === null ||
        targets.length === 0 ||
        targets.length !== targetIds.length ||
        targets.some((target, index) => target.targetId !== targetIds[index]) ||
        targets.reduce((total, target) => total + target.commandCount, 0) !== value.commandCount
    ) {
        return null;
    }
    const extras = readBatchExtras(value, objective);
    if (extras === null) {
        return null;
    }
    return {
        id: value.id,
        ordinal: value.ordinal,
        objective: { descriptors, role, ...extras.objectiveExtras },
        ...extras.batchExtras,
        targetIds,
        targets,
        commandCount: value.commandCount,
    };
}

function readBatchExtras(value: Record<string, unknown>, objective: Record<string, unknown> | null) {
    const ranges = value.verificationRanges === undefined ? undefined : readEvery(value.verificationRanges, readRange);
    const witnessIds = value.witnessIds === undefined ? undefined : readTexts(value.witnessIds);
    const silentRanges = value.silentRanges === undefined ? undefined : readEvery(value.silentRanges, readSilentRange);
    const sections = objective?.sections === undefined ? undefined : readEvery(objective.sections, readSection);
    const sectionGoals =
        objective?.sectionGoals === undefined ? undefined : readEvery(objective.sectionGoals, readSectionGoal);
    if (ranges === null || witnessIds === null || silentRanges === null || sections === null || sectionGoals === null) {
        return null;
    }
    const objectiveExtras: { sections?: typeof sections; sectionGoals?: typeof sectionGoals } = {};
    if (sections !== undefined) {
        objectiveExtras.sections = sections;
    }
    if (sectionGoals !== undefined) {
        objectiveExtras.sectionGoals = sectionGoals;
    }
    const batchExtras: {
        verificationRanges?: typeof ranges;
        witnessIds?: typeof witnessIds;
        silentRanges?: typeof silentRanges;
    } = {};
    if (ranges !== undefined) {
        batchExtras.verificationRanges = ranges;
    }
    if (witnessIds !== undefined) {
        batchExtras.witnessIds = witnessIds;
    }
    if (silentRanges !== undefined) {
        batchExtras.silentRanges = silentRanges;
    }
    return { objectiveExtras, batchExtras };
}

function readSilentRange(value: unknown): VibeRunSilentRange | null {
    if (!isRecord(value) || !isText(value.targetId) || !isText(value.receiptCallId) || !isText(value.receiptDigest)) {
        return null;
    }
    const range = readRange(value.range);
    if (range === null) {
        return null;
    }
    return {
        targetId: value.targetId,
        range,
        receiptCallId: value.receiptCallId,
        receiptDigest: value.receiptDigest,
    };
}

function readRange(value: unknown): VibeRunVerificationRange | null {
    if (
        !isRecord(value) ||
        typeof value.startBeat !== 'number' ||
        !Number.isFinite(value.startBeat) ||
        value.startBeat < 0 ||
        typeof value.endBeat !== 'number' ||
        !Number.isFinite(value.endBeat) ||
        value.endBeat <= value.startBeat ||
        (value.sectionId !== null && !isText(value.sectionId))
    ) {
        return null;
    }
    return { startBeat: value.startBeat, endBeat: value.endBeat, sectionId: value.sectionId };
}
function readSection(value: unknown) {
    if (!isRecord(value) || !isText(value.id)) {
        return null;
    }
    const range = readRange({ ...value, sectionId: value.id });
    return range === null ? null : { id: value.id, startBeat: range.startBeat, endBeat: range.endBeat };
}
function readSectionGoal(value: unknown) {
    if (!isRecord(value) || !isText(value.sectionId) || !isText(value.statement)) {
        return null;
    }
    return { sectionId: value.sectionId, statement: value.statement };
}
function validInitialRoles(value: unknown, targetIds: readonly string[]): boolean {
    if (!Array.isArray(value) || value.length !== targetIds.length) {
        return false;
    }
    const ids = new Set<string>();
    for (const entry of value) {
        if (
            !isRecord(entry) ||
            !isText(entry.targetId) ||
            !targetIds.includes(entry.targetId) ||
            !isRecord(entry.canonicalRole) ||
            !isText(entry.canonicalRole.role) ||
            !isText(entry.canonicalRole.source) ||
            !isText(entry.canonicalRole.evidence) ||
            ids.has(entry.targetId)
        ) {
            return false;
        }
        ids.add(entry.targetId);
    }
    return true;
}

function readInitialTables(
    value: Record<string, unknown>,
    batches: readonly ScheduledVibeRunBatch[],
    sourceRevision: string
) {
    const sections = readEvery(value.sections, readSection);
    const arrangement = readRange(value.arrangementRange);
    const receipts = readEvery(value.receipts, readVibeRunInitialReceipt);
    const targetIds = batches.flatMap((batch) => batch.targetIds);
    const silentTargets = value.silentTargets === undefined ? [] : readEvery(value.silentTargets, readSilentTarget);
    const silentTargetIds = silentTargets?.map((target) => target.targetId) ?? [];
    if (
        silentTargets === null ||
        new Set(silentTargetIds).size !== silentTargetIds.length ||
        silentTargetIds.some((targetId) => targetIds.includes(targetId)) ||
        sections === null ||
        new Set(sections.map((section) => section.id)).size !== sections.length ||
        arrangement === null ||
        arrangement.sectionId !== null ||
        receipts === null ||
        receipts.length === 0 ||
        new Set(receipts.map((receipt) => receipt.callId)).size !== receipts.length ||
        new Set(targetIds).size !== targetIds.length ||
        !validInitialRoles(value.roles, targetIds)
    ) {
        return null;
    }
    const ranges = [
        arrangement,
        ...sections.map((section) => ({
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            sectionId: section.id,
        })),
    ];
    if (
        receipts.some(
            (receipt) =>
                receipt.revision !== value.sourceRevision ||
                receipt.data.sourceRevisionDigest !== value.sourceRevisionDigest ||
                !ranges.some((range) => sameRange(range, receipt.data.range)) ||
                receipt.data.targets.some(
                    (target) => !targetIds.includes(target.targetId) && !silentTargetIds.includes(target.targetId)
                )
        ) ||
        !silentTargets.every((target) => silentInEveryRange(target, ranges, receipts, sourceRevision))
    ) {
        return null;
    }
    // Every witness binds one of these receipts by digest; each is digested once, not once per witness.
    const receiptDigests = new Map(receipts.map((receipt) => [receipt.callId, digest(receipt)]));
    return { sections, arrangement, receipts, receiptDigests, targetIds, ranges, sourceRevision };
}

function readSilentTarget(value: unknown): VibeRunSilentTarget | null {
    if (!isRecord(value) || !isText(value.targetId)) {
        return null;
    }
    const metrics = readTexts(value.metrics);
    const silences = readEvery(value.silences, readSilentRange);
    if (metrics === null || metrics.length === 0 || silences === null) {
        return null;
    }
    return { targetId: value.targetId, metrics, silences };
}

/**
 * A target left out as silent everywhere carries the evidence a silent cell does, once per plan
 * range: each silence names that target and binds the receipt that reads it silent for its metrics.
 */
function silentInEveryRange(
    target: VibeRunSilentTarget,
    ranges: readonly VibeRunVerificationRange[],
    receipts: readonly NonNullable<ReturnType<typeof readVibeRunInitialReceipt>>[],
    sourceRevision: string
): boolean {
    const expectedDeltas = target.metrics.map((metric) => ({ metric }));
    return (
        target.silences.length === ranges.length &&
        ranges.every((range) => target.silences.filter((silence) => sameRange(silence.range, range)).length === 1) &&
        target.silences.every(
            (record) =>
                record.targetId === target.targetId &&
                recordedSilenceHolds({ record, expectedDeltas, receipts, sourceRevision })
        )
    );
}

type InitialTables = NonNullable<ReturnType<typeof readInitialTables>>;

function readWitnessIdentity(
    value: Record<string, unknown>
): Pick<
    VibeRunInitialWitness,
    'id' | 'targetId' | 'recipeId' | 'recipeDigest' | 'expectationIndex' | 'metric' | 'band'
> | null {
    if (
        !isText(value.id) ||
        !isText(value.targetId) ||
        !isText(value.recipeId) ||
        !isText(value.recipeDigest) ||
        !isCount(value.expectationIndex) ||
        !isText(value.metric) ||
        (value.band !== null && !isText(value.band))
    ) {
        return null;
    }
    return {
        id: value.id,
        targetId: value.targetId,
        recipeId: value.recipeId,
        recipeDigest: value.recipeDigest,
        expectationIndex: value.expectationIndex,
        metric: value.metric,
        band: value.band,
    };
}
function readWitnessScalar(value: unknown, band: string | null): unknown {
    if (band === null) {
        return value;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, band);
    if (descriptor !== undefined && 'value' in descriptor) {
        const scalar: unknown = descriptor.value;
        return scalar;
    }
    return undefined;
}

function readWitness(
    value: unknown,
    tables: InitialTables,
    batches: readonly ScheduledVibeRunBatch[]
): VibeRunInitialWitness | null {
    if (!isRecord(value)) {
        return null;
    }
    const identity = readWitnessIdentity(value);
    if (identity === null || !tables.targetIds.includes(identity.targetId)) {
        return null;
    }
    const range = readRange(value.range);
    const receipt = tables.receipts.find((receipt) => receipt.callId === value.receiptCallId);
    const receiptDigest = receipt === undefined ? undefined : tables.receiptDigests.get(receipt.callId);
    const target = receipt?.data.targets.find((target) => target.targetId === identity.targetId);
    const entry = target?.measurements[identity.metric];
    if (
        range === null ||
        receipt === undefined ||
        receiptDigest === undefined ||
        value.receiptDigest !== receiptDigest ||
        !sameRange(receipt.data.range, range) ||
        entry?.status !== 'measured' ||
        entry.metricVersion !== 1 ||
        !receipt.data.metrics.includes(identity.metric)
    ) {
        return null;
    }
    const scalar = readWitnessScalar(entry.value, identity.band);
    if (typeof scalar !== 'number' || !Number.isFinite(scalar)) {
        return null;
    }
    const targetId = identity.targetId;
    const recipeId = identity.recipeId;
    const batch = batches.find((batch) => batch.targetIds.includes(targetId));
    if (!batch?.targets.some((target) => target.targetId === targetId && target.recipeIds.includes(recipeId))) {
        return null;
    }
    return {
        id: identity.id,
        targetId,
        recipeId,
        recipeDigest: identity.recipeDigest,
        expectationIndex: identity.expectationIndex,
        metric: identity.metric,
        band: identity.band,
        range,
        receiptCallId: receipt.callId,
        receiptDigest,
    };
}

/**
 * Every silence record names a target of its batch over one of the plan's ranges, once, and still
 * reads silent at the receipt it binds; a target silent over every range belongs in no batch.
 */
function validSilentRanges(batch: ScheduledVibeRunBatch, tables: InitialTables): boolean {
    const records = batch.silentRanges ?? [];
    if (new Set(records.map((record) => digest([record.targetId, record.range]))).size !== records.length) {
        return false;
    }
    for (const record of records) {
        const target = batch.targets.find((candidate) => candidate.targetId === record.targetId);
        if (
            target === undefined ||
            !tables.ranges.some((range) => sameRange(range, record.range)) ||
            !recordedSilenceHolds({
                record,
                expectedDeltas: target.expectedDeltas,
                receipts: tables.receipts,
                sourceRevision: tables.sourceRevision,
            })
        ) {
            return false;
        }
    }
    return batch.targets.every(
        (target) => records.filter((record) => record.targetId === target.targetId).length < tables.ranges.length
    );
}

function completeBatchCoverage(
    batch: ScheduledVibeRunBatch,
    tables: InitialTables,
    witnesses: readonly VibeRunInitialWitness[]
): boolean {
    if (
        batch.verificationRanges === undefined ||
        digest(batch.verificationRanges) !== digest(tables.ranges) ||
        digest(batch.objective.sections) !== digest(tables.sections) ||
        batch.objective.sectionGoals === undefined ||
        batch.objective.sectionGoals.some(
            (goal) => !tables.sections.some((section) => section.id === goal.sectionId)
        ) ||
        batch.witnessIds === undefined
    ) {
        return false;
    }
    const expectedIds = witnesses
        .filter((witness) => batch.targetIds.includes(witness.targetId))
        .map((witness) => witness.id);
    if (digest(expectedIds) !== digest(batch.witnessIds)) {
        return false;
    }
    if (!validSilentRanges(batch, tables)) {
        return false;
    }
    for (const target of batch.targets) {
        for (const range of tables.ranges) {
            const standing = witnesses.filter(
                (witness) => witness.targetId === target.targetId && sameRange(witness.range, range)
            );
            const silent = (batch.silentRanges ?? []).some(
                (cell) => cell.targetId === target.targetId && sameRange(cell.range, range)
            );
            if (silent) {
                if (standing.length > 0) {
                    return false;
                }
                continue;
            }
            if (
                target.expectedDeltas.some(
                    (delta) =>
                        !standing.some((witness) => witness.metric === delta.metric && witness.band === delta.band)
                ) ||
                target.recipeIds.some((recipeId) => !standing.some((witness) => witness.recipeId === recipeId))
            ) {
                return false;
            }
        }
    }
    return true;
}

function initialEvidence(value: unknown, batches: readonly ScheduledVibeRunBatch[]): value is VibeRunInitialEvidence {
    if (
        !isRecord(value) ||
        value.origin !== 'vibe-run-initial-baselines' ||
        !isText(value.sourceRevision) ||
        value.sourceRevisionDigest !== digest(value.sourceRevision) ||
        !isText(value.projectId) ||
        !isText(value.runId) ||
        !isText(value.briefId) ||
        !isText(value.briefDigest) ||
        !isText(value.mixIntentDigest) ||
        !isCount(value.catalogVersion)
    ) {
        return false;
    }
    const tables = readInitialTables(value, batches, value.sourceRevision);
    if (tables === null) {
        return false;
    }
    const witnesses = readEvery(value.witnesses, (witness) => readWitness(witness, tables, batches));
    if (
        witnesses === null ||
        new Set(witnesses.map((witness) => witness.id)).size !== witnesses.length ||
        new Set(
            witnesses.map((witness) =>
                digest([witness.targetId, witness.recipeId, witness.expectationIndex, witness.range])
            )
        ).size !== witnesses.length
    ) {
        return false;
    }
    return batches.every((batch) => completeBatchCoverage(batch, tables, witnesses));
}
function sameRange(left: VibeRunVerificationRange | null, right: VibeRunVerificationRange): boolean {
    return (
        left !== null &&
        left.startBeat === right.startBeat &&
        left.endBeat === right.endBeat &&
        left.sectionId === right.sectionId
    );
}

function deepFreeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

/**
 * The last plan text read and what it read as. The run store re-reads its stored plan on every run
 * update, and validating a whole run's initial evidence digests every receipt it holds, so one run
 * of a few dozen targets would otherwise re-digest the same text hundreds of times. The verdict is
 * a pure function of the text, and the plan it returns is frozen, so every caller can share it.
 */
let lastRead: { serialized: string; plan: ScheduledVibeRunPlan | null } | null = null;

/**
 * The plan a `vibe-run` schedule stored, read whole or not at all: its batches must run 1..N in order
 * and each must state its own targets, recipes and the commands they expand to, or a later batch could
 * be grounded from a plan nobody made.
 */
export function readScheduledVibeRunPlan(serialized: string): ScheduledVibeRunPlan | null {
    if (lastRead?.serialized !== serialized) {
        lastRead = { serialized, plan: deepFreeze(parseScheduledVibeRunPlan(serialized)) };
    }
    return lastRead.plan;
}

function parseScheduledVibeRunPlan(serialized: string): ScheduledVibeRunPlan | null {
    if (
        serialized.length === 0 ||
        new TextEncoder().encode(serialized).byteLength > SCHEDULED_VIBE_RUN_PLAN_MAX_BYTES
    ) {
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return null;
    }
    if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || !isCount(value.briefRevision)) {
        return null;
    }
    const batches = readEvery(value.batches, readBatch);
    if (batches === null || batches.length === 0 || batches.some((batch, index) => batch.ordinal !== index + 1)) {
        return null;
    }
    if (new Set(batches.map((batch) => batch.id)).size !== batches.length) {
        return null;
    }
    if (value.schemaVersion === 1) {
        return { schemaVersion: 1, briefRevision: value.briefRevision, batches };
    }
    if (
        !initialEvidence(value.initial, batches) ||
        value.initialDigest !== digest(value.initial) ||
        value.planDigest !== digest({ briefRevision: value.briefRevision, batches, initialDigest: value.initialDigest })
    ) {
        return null;
    }
    return {
        schemaVersion: 2,
        briefRevision: value.briefRevision,
        batches,
        initial: value.initial,
        initialDigest: value.initialDigest,
        planDigest: value.planDigest,
    };
}
