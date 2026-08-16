import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../models/AgentContext';
import { type AgentRunBudgets, type AgentRunGrants } from '../models/AgentRun';
import { type ProjectContext } from '../models/ProjectContext';

const MAX_CONTEXT_TARGETS = 64;
const MAX_VALIDATION_FAILURES = 16;

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

function digest(value: unknown): string {
    let hash = 2_166_136_261;
    for (const character of stableJson(value)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildProjectData(context: ProjectContext) {
    const selectedTrack = context.tracks.find((track) => track.id === context.selectedTrackId) ?? null;
    const selectableTargets = context.tracks.slice(0, MAX_CONTEXT_TARGETS).map((track) => ({
        id: track.id,
        name: { trust: 'untrusted_imported_string', value: track.name },
        kind: track.kind,
        frozen: track.frozen ?? false,
    }));
    return {
        tempo: context.tempo,
        timeSignature: context.timeSignature,
        selectedTrack: selectedTrack
            ? {
                  id: selectedTrack.id,
                  name: { trust: 'untrusted_imported_string', value: selectedTrack.name },
                  kind: selectedTrack.kind,
                  frozen: selectedTrack.frozen ?? false,
                  clips: selectedTrack.clips.map((clip) => ({
                      id: clip.id,
                      name: { trust: 'untrusted_imported_string', value: clip.name },
                      locked: clip.locked ?? false,
                      startBeat: clip.startBeat,
                      endBeat: clip.endBeat,
                  })),
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

export function buildAgentContext(input: BuildAgentContextInput): { message: string; evidence: AgentContextEvidence } {
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
            receiptCount: input.receipts?.length ?? 0,
            capabilitySchemaCount: input.capabilitySchemas?.length ?? 0,
            validationFailures: validationFailureEvidence,
            measurementCount: input.measurements?.length ?? 0,
            trackCount: input.context.tracks.length,
        },
        snapshot,
        delta: revisionPayload.delta,
    };
    const productionBrief = input.context.productionBrief
        ? {
              id: input.context.productionBrief.id,
              revision: input.context.productionBrief.revision,
              vision: input.context.productionBrief.vision,
              locks: input.context.productionBrief.locks,
          }
        : null;

    return {
        evidence,
        message: `fixed_policy:\n${input.fixedPolicy}\n\nrun_authority:\n${stableJson({ grants: evidence.grants, budgets: evidence.budgets })}\n\nuser_request:\n${stableJson({ trust: 'untrusted_user_string', value: input.prompt })}\n\nproduction_brief_and_locks:\n${stableJson({ trust: 'untrusted_project_data', value: productionBrief })}\n\nrevision_and_selection:\n${stableJson({ revision, selection: evidence.selection, delta: evidence.delta })}\n\nrelevant_evidence:\n${stableJson({ trust: 'untrusted_project_data', receipts: input.receipts ?? [] })}\n\ncapability_schemas:\n${stableJson({ schemas: input.capabilitySchemas ?? [], trust: 'untrusted_project_data', availableCapabilities: input.capabilityData ?? null })}\n\nvalidation_failures:\n${stableJson({ evidence: validationFailureEvidence, items: validationFailures })}\n\nmeasurements:\n${stableJson(input.measurements ?? [])}\n\nuntrusted_project_data:\n${stableJson({ snapshotIdentity: snapshot.identity, mode: evidence.delta.mode, data: revisionPayload.projectPayload })}`,
    };
}
