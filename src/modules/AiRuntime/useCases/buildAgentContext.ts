import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../models/AgentContext';
import { type AgentRunBudgets, type AgentRunGrants } from '../models/AgentRun';
import { type ProjectContext } from '../models/ProjectContext';

const MAX_CONTEXT_TARGETS = 64;
const MAX_VALIDATION_FAILURES = 16;
const MAX_SELECTED_CLIPS = 16;
const MAX_IMPORTED_STRING_LENGTH = 512;
const MAX_RECEIPTS = 16;
const MAX_MEASUREMENTS = 16;

function isRelevantLock(
    lock: NonNullable<ProjectContext['productionBrief']>['locks'][number],
    context: ProjectContext
): boolean {
    if (lock.scope.kind === 'project') {
        return true;
    }
    if (lock.scope.kind === 'track') {
        return lock.scope.trackId === context.selectedTrackId;
    }
    if (lock.scope.kind === 'object') {
        return (
            lock.scope.objectId === context.selectedTrackId ||
            lock.scope.objectId === context.selectedClipId ||
            context.selectedClipIds.includes(lock.scope.objectId)
        );
    }
    return false;
}

type BuildAgentContextInput = {
    fixedPolicy: string;
    prompt: string;
    context: ProjectContext;
    projectRevision?: string;
    run?: { grants: AgentRunGrants; budgets: AgentRunBudgets };
    receipts?: Array<{ id: string; summary: string }>;
    capabilitySchemas?: Array<{ name: string; schemaVersion: number }>;
    capabilityData?: unknown;
    validationFailures?: Array<{ code: string }>;
    measurements?: Array<{ name: string; value: number; unit: string }>;
    priorEvidence?: AgentContextEvidence | null;
};

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function boundedString(value: string): { value: string; truncated: boolean } {
    return { value: value.slice(0, MAX_IMPORTED_STRING_LENGTH), truncated: value.length > MAX_IMPORTED_STRING_LENGTH };
}

function digest(value: unknown): string {
    const bytes = new TextEncoder().encode(canonicalJson(value));
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    new DataView(padded.buffer).setUint32(padded.length - 4, bytes.length * 8);
    const constants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
        0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
        0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        const view = new DataView(padded.buffer, offset, 64);
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getUint32(index * 4);
        }
        for (let index = 16; index < 64; index += 1) {
            const x = words[index - 15]!;
            const y = words[index - 2]!;
            words[index] =
                ((((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) +
                    words[index - 16]! +
                    (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) +
                    words[index - 7]!) >>>
                0;
        }
        let [a, b, c, d, e, f, g, h] = state;
        for (let index = 0; index < 64; index += 1) {
            const s1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7));
            const choose = (e! & f!) ^ (~e! & g!);
            const t1 = (h! + s1 + choose + constants[index]! + words[index]!) >>> 0;
            const s0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10));
            const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
            const t2 = (s0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d! + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        state[0] = (state[0]! + a!) >>> 0;
        state[1] = (state[1]! + b!) >>> 0;
        state[2] = (state[2]! + c!) >>> 0;
        state[3] = (state[3]! + d!) >>> 0;
        state[4] = (state[4]! + e!) >>> 0;
        state[5] = (state[5]! + f!) >>> 0;
        state[6] = (state[6]! + g!) >>> 0;
        state[7] = (state[7]! + h!) >>> 0;
    }
    return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function buildProjectData(context: ProjectContext) {
    const selectedTrack = context.tracks.find((track) => track.id === context.selectedTrackId) ?? null;
    const selectableTargets = context.tracks.slice(0, MAX_CONTEXT_TARGETS).map((track) => ({
        id: track.id,
        name: { trust: 'untrusted_imported_string', ...boundedString(track.name) },
        kind: track.kind,
        frozen: track.frozen ?? false,
    }));
    return {
        tempo: context.tempo,
        timeSignature: context.timeSignature,
        selectedTrack: selectedTrack
            ? {
                  id: selectedTrack.id,
                  name: { trust: 'untrusted_imported_string', ...boundedString(selectedTrack.name) },
                  kind: selectedTrack.kind,
                  frozen: selectedTrack.frozen ?? false,
                  clips: selectedTrack.clips.slice(0, MAX_SELECTED_CLIPS).map((clip) => ({
                      id: clip.id,
                      name: { trust: 'untrusted_imported_string', ...boundedString(clip.name) },
                      locked: clip.locked ?? false,
                      startBeat: clip.startBeat,
                      endBeat: clip.endBeat,
                  })),
                  omittedClipCount: Math.max(0, selectedTrack.clips.length - MAX_SELECTED_CLIPS),
              }
            : null,
        selectableTargets,
        targetCount: context.tracks.length,
        truncated: context.tracks.length > selectableTargets.length,
    };
}

function snapshotProjectData(projectData: ReturnType<typeof buildProjectData>) {
    const selectedTrack = projectData.selectedTrack
        ? { id: projectData.selectedTrack.id, digest: digest(projectData.selectedTrack) }
        : null;
    const selectableTargets = projectData.selectableTargets.map((target) => ({
        id: target.id,
        digest: digest(target),
    }));
    return {
        identity: digest({
            tempo: projectData.tempo,
            timeSignature: projectData.timeSignature,
            selectedTrack,
            selectableTargets,
            targetCount: projectData.targetCount,
            truncated: projectData.truncated,
        }),
        tempo: projectData.tempo,
        timeSignature: projectData.timeSignature,
        selectedTrack,
        selectableTargets,
        targetCount: projectData.targetCount,
        truncated: projectData.truncated,
    };
}

function buildRevisionPayload(input: {
    projectData: ReturnType<typeof buildProjectData>;
    snapshot: AgentContextEvidence['snapshot'];
    priorEvidence?: AgentContextEvidence | null;
    revision: string | null;
}) {
    const priorSnapshot = input.priorEvidence?.snapshot;
    const compatiblePrior =
        input.priorEvidence?.schemaVersion === AGENT_CONTEXT_SCHEMA_VERSION &&
        input.priorEvidence.revision !== null &&
        input.priorEvidence.revision !== input.revision &&
        priorSnapshot !== undefined &&
        !priorSnapshot.truncated &&
        !input.snapshot.truncated;
    if (!compatiblePrior) {
        return {
            delta: { mode: 'full' as const, baseRevision: null, currentRevision: input.revision },
            projectPayload: input.projectData,
        };
    }
    const priorTargets = new Map(priorSnapshot.selectableTargets.map((target) => [target.id, target.digest]));
    const changedTargets = input.projectData.selectableTargets.filter(
        (target) => priorTargets.get(target.id) !== digest(target)
    );
    const currentTargetIds = new Set(input.snapshot.selectableTargets.map((target) => target.id));
    const removedTargetIds = priorSnapshot.selectableTargets
        .filter((target) => !currentTargetIds.has(target.id))
        .map((target) => target.id);
    return {
        delta: {
            mode: 'delta' as const,
            baseRevision: input.priorEvidence!.revision,
            currentRevision: input.revision,
        },
        projectPayload: {
            ...(priorSnapshot.tempo === input.snapshot.tempo ? {} : { tempo: input.projectData.tempo }),
            ...(stableJson(priorSnapshot.timeSignature) === stableJson(input.snapshot.timeSignature)
                ? {}
                : { timeSignature: input.projectData.timeSignature }),
            ...(priorSnapshot.selectedTrack?.digest === input.snapshot.selectedTrack?.digest
                ? {}
                : { selectedTrack: input.projectData.selectedTrack }),
            ...(changedTargets.length === 0 ? {} : { selectableTargets: changedTargets }),
            ...(removedTargetIds.length === 0 ? {} : { removedTargetIds }),
        },
    };
}

export function buildAgentContext(input: BuildAgentContextInput): {
    authorityComplete: boolean;
    message: string;
    evidence: AgentContextEvidence;
} {
    const revision = input.projectRevision ?? null;
    const projectData = buildProjectData(input.context);
    const snapshot = snapshotProjectData(projectData);
    const revisionPayload = buildRevisionPayload({
        projectData,
        snapshot,
        priorEvidence: input.priorEvidence,
        revision,
    });
    const validationFailures = (input.validationFailures ?? []).slice(-MAX_VALIDATION_FAILURES);
    const receipts = (input.receipts ?? []).slice(-MAX_RECEIPTS).map((receipt) => ({
        id: boundedString(receipt.id).value,
        summary: boundedString(receipt.summary),
    }));
    const capabilitySchemas = (input.capabilitySchemas ?? []).slice(0, MAX_CONTEXT_TARGETS).map((schema) => ({
        name: boundedString(schema.name).value,
        schemaVersion: schema.schemaVersion,
    }));
    const measurements = (input.measurements ?? []).slice(-MAX_MEASUREMENTS).map((measurement) => ({
        name: boundedString(measurement.name).value,
        value: measurement.value,
        unit: boundedString(measurement.unit).value,
    }));
    const validationFailureEvidence = {
        total: input.validationFailures?.length ?? 0,
        retained: validationFailures.length,
        omitted: Math.max(0, (input.validationFailures?.length ?? 0) - validationFailures.length),
    };
    const evidence: AgentContextEvidence = {
        schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
        revision,
        selection: {
            trackId: input.context.selectedTrackId,
            clipId: input.context.selectedClipId,
            clipIds: [...input.context.selectedClipIds],
        },
        grants: input.run ? structuredClone(input.run.grants) : null,
        budgets: input.run ? structuredClone(input.run.budgets) : null,
        included: {
            receiptCount: receipts.length,
            capabilitySchemaCount: capabilitySchemas.length,
            validationFailures: validationFailureEvidence,
            measurementCount: measurements.length,
            trackCount: input.context.tracks.length,
        },
        snapshot,
        delta: revisionPayload.delta,
    };
    const productionBrief = input.context.productionBrief
        ? {
              id: input.context.productionBrief.id,
              revision: input.context.productionBrief.revision,
              vision: input.context.productionBrief.vision && boundedString(input.context.productionBrief.vision),
              locks: [...input.context.productionBrief.locks]
                  .sort(
                      (left, right) =>
                          Number(isRelevantLock(right, input.context)) - Number(isRelevantLock(left, input.context))
                  )
                  .slice(0, MAX_CONTEXT_TARGETS)
                  .map((lock) => ({
                      id: lock.id,
                      scope: lock.scope,
                      statement: boundedString(lock.statement),
                  })),
              omittedLockCount: Math.max(0, input.context.productionBrief.locks.length - MAX_CONTEXT_TARGETS),
              incompleteRelevantAuthority:
                  input.context.productionBrief.locks.filter((lock) => isRelevantLock(lock, input.context)).length >
                  MAX_CONTEXT_TARGETS,
          }
        : null;

    return {
        authorityComplete: productionBrief?.incompleteRelevantAuthority !== true,
        evidence,
        message: `fixed_policy:\n${input.fixedPolicy}\n\nrun_authority:\n${stableJson({ grants: evidence.grants, budgets: evidence.budgets })}\n\nuser_request:\n${stableJson({ trust: 'untrusted_user_string', ...boundedString(input.prompt) })}\n\nproduction_brief_and_locks:\n${stableJson({ trust: 'untrusted_project_data', value: productionBrief })}\n\nrevision_and_selection:\n${stableJson({ revision, selection: evidence.selection, delta: evidence.delta })}\n\nrelevant_evidence:\n${stableJson({ trust: 'untrusted_project_data', receipts, omitted: Math.max(0, (input.receipts?.length ?? 0) - receipts.length) })}\n\ncapability_schemas:\n${stableJson({ schemas: capabilitySchemas, omitted: Math.max(0, (input.capabilitySchemas?.length ?? 0) - capabilitySchemas.length), trust: 'untrusted_project_data', availableCapabilities: stableJson(input.capabilityData ?? null).slice(0, 8_192) })}\n\nvalidation_failures:\n${stableJson({ evidence: validationFailureEvidence, items: validationFailures.map((failure) => ({ code: boundedString(failure.code) })) })}\n\nmeasurements:\n${stableJson({ items: measurements, omitted: Math.max(0, (input.measurements?.length ?? 0) - measurements.length) })}\n\nuntrusted_project_data:\n${stableJson({ snapshotIdentity: snapshot.identity, mode: evidence.delta.mode, data: revisionPayload.projectPayload })}`,
    };
}
