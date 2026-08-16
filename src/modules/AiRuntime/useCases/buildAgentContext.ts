import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../models/AgentContext';
import { type AgentRunBudgets, type AgentRunGrants } from '../models/AgentRun';
import { type ProjectContext } from '../models/ProjectContext';

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

function buildProjectData(context: ProjectContext) {
    const selectedTrack = context.tracks.find((track) => track.id === context.selectedTrackId) ?? null;
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
        selectableTargets: context.tracks.map((track) => ({
            id: track.id,
            name: { trust: 'untrusted_imported_string', value: track.name },
            kind: track.kind,
            frozen: track.frozen ?? false,
        })),
    };
}

export function buildAgentContext(input: BuildAgentContextInput): { message: string; evidence: AgentContextEvidence } {
    const revision = input.projectRevision ?? null;
    const compatiblePrior =
        input.priorEvidence?.schemaVersion === AGENT_CONTEXT_SCHEMA_VERSION &&
        input.priorEvidence.revision !== null &&
        input.priorEvidence.revision !== revision;
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
            validationFailureCount: input.validationFailures?.length ?? 0,
            measurementCount: input.measurements?.length ?? 0,
            trackCount: input.context.tracks.length,
        },
        delta: compatiblePrior
            ? { mode: 'delta', baseRevision: input.priorEvidence!.revision }
            : { mode: 'full', baseRevision: null },
    };
    const projectData = buildProjectData(input.context);
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
        message: `fixed_policy:\n${input.fixedPolicy}\n\nrun_authority:\n${stableJson({ grants: evidence.grants, budgets: evidence.budgets })}\n\nuser_request:\n${stableJson({ trust: 'untrusted_user_string', value: input.prompt })}\n\nproduction_brief_and_locks:\n${stableJson({ trust: 'untrusted_project_data', value: productionBrief })}\n\nrevision_and_selection:\n${stableJson({ revision, selection: evidence.selection, delta: evidence.delta })}\n\nrelevant_evidence:\n${stableJson({ trust: 'untrusted_project_data', receipts: input.receipts ?? [] })}\n\ncapability_schemas:\n${stableJson({ schemas: input.capabilitySchemas ?? [], trust: 'untrusted_project_data', availableCapabilities: input.capabilityData ?? null })}\n\nvalidation_failures:\n${stableJson(input.validationFailures ?? [])}\n\nmeasurements:\n${stableJson(input.measurements ?? [])}\n\nuntrusted_project_data:\n${stableJson(projectData)}`,
    };
}
