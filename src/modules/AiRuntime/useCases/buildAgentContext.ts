import { digest } from '#/utils/canonicalDigest';

import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../models/AgentContext';
import { type AgentRunBudgets, type AgentRunGrants } from '../models/AgentRun';
import { type ProjectContext } from '../models/ProjectContext';
import { buildLlmActionUserMessage, type LlmActionCapabilityData } from '../transformers/llmActionBridge';

const MAX_CONTEXT_TARGETS = 64;
const MAX_VALIDATION_FAILURES = 16;
const MAX_SELECTED_CLIPS = 16;
const MAX_IMPORTED_STRING_LENGTH = 512;
const MAX_RECEIPTS = 16;
/**
 * Receipt summaries carry application-owned tool evidence, not imported project or prompt text, so
 * they hold their own budget instead of the general imported-string bound. The budget is the total
 * across every retained receipt, which keeps the worst-case message contribution identical to the
 * previous MAX_RECEIPTS * MAX_IMPORTED_STRING_LENGTH aggregate while letting a single receipt spend
 * the whole allowance. This constant is the only owner of that budget: callers pass whole summaries
 * and read the reported `truncated` flag.
 */
const MAX_RECEIPT_EVIDENCE_LENGTH = 8_192;
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
    capabilityData?: LlmActionCapabilityData;
    validationFailures?: Array<{ code: string }>;
    measurements?: Array<{ name: string; value: number; unit: string }>;
    priorEvidence?: AgentContextEvidence | null;
};

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

function boundedTo(value: string, maxLength: number): { value: string; truncated: boolean } {
    return { value: value.slice(0, maxLength), truncated: value.length > maxLength };
}

function boundedString(value: string): { value: string; truncated: boolean } {
    return boundedTo(value, MAX_IMPORTED_STRING_LENGTH);
}

function buildProjectData(context: ProjectContext) {
    const selectedTrack = context.tracks.find((track) => track.id === context.selectedTrackId) ?? null;
    const selectableTargets = context.tracks.slice(0, MAX_CONTEXT_TARGETS).map((track) => ({
        id: track.id,
        name: { trust: 'untrusted_imported_string' as const, ...boundedString(track.name) },
        kind: track.kind,
        frozen: track.frozen ?? false,
    }));
    const sections = (context.sections ?? []).slice(0, MAX_CONTEXT_TARGETS).map((section) => ({
        id: section.id,
        name: { trust: 'untrusted_imported_string' as const, ...boundedString(section.name) },
        startBeat: section.startBeat,
        endBeat: section.endBeat,
    }));
    return {
        tempo: context.tempo,
        timeSignature: context.timeSignature,
        selectedTrack: selectedTrack
            ? {
                  id: selectedTrack.id,
                  name: { trust: 'untrusted_imported_string' as const, ...boundedString(selectedTrack.name) },
                  kind: selectedTrack.kind,
                  frozen: selectedTrack.frozen ?? false,
                  clips: selectedTrack.clips.slice(0, MAX_SELECTED_CLIPS).map((clip) => ({
                      id: clip.id,
                      name: { trust: 'untrusted_imported_string' as const, ...boundedString(clip.name) },
                      locked: clip.locked ?? false,
                      startBeat: clip.startBeat,
                      endBeat: clip.endBeat,
                  })),
                  omittedClipCount: Math.max(0, selectedTrack.clips.length - MAX_SELECTED_CLIPS),
              }
            : null,
        selectableTargets,
        sections,
        targetCount: context.tracks.length,
        truncated:
            context.tracks.length > selectableTargets.length || (context.sections?.length ?? 0) > sections.length,
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
    const sections = projectData.sections.map((section) => ({
        id: section.id,
        digest: digest(section),
    }));
    return {
        identity: digest({
            tempo: projectData.tempo,
            timeSignature: projectData.timeSignature,
            selectedTrack,
            selectableTargets,
            sections,
            targetCount: projectData.targetCount,
            truncated: projectData.truncated,
        }),
        tempo: projectData.tempo,
        timeSignature: projectData.timeSignature,
        selectedTrack,
        selectableTargets,
        sections,
        targetCount: projectData.targetCount,
        truncated: projectData.truncated,
    };
}

// Section identity stays in the stored evidence snapshot for delta diffing. The
// provider-bound payload grounds sections by name and beat range only, so raw
// internal section ids never enter a provider request.
function toProviderBoundSection(section: ReturnType<typeof buildProjectData>['sections'][number]) {
    return { name: section.name, startBeat: section.startBeat, endBeat: section.endBeat };
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
            projectPayload: { ...input.projectData, sections: input.projectData.sections.map(toProviderBoundSection) },
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
    const priorSections = new Map((priorSnapshot.sections ?? []).map((section) => [section.id, section.digest]));
    const changedSections = input.projectData.sections.filter(
        (section) => priorSections.get(section.id) !== digest(section)
    );
    const currentSectionIds = new Set((input.snapshot.sections ?? []).map((section) => section.id));
    const removedSectionIds = (priorSnapshot.sections ?? [])
        .filter((section) => !currentSectionIds.has(section.id))
        .map((section) => section.id);
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
            ...(changedSections.length === 0 ? {} : { sections: changedSections.map(toProviderBoundSection) }),
            ...(removedSectionIds.length === 0 ? {} : { removedSectionIds }),
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
    const retainedReceipts = (input.receipts ?? []).slice(-MAX_RECEIPTS);
    const receiptSummaryBudget =
        retainedReceipts.length === 0
            ? MAX_RECEIPT_EVIDENCE_LENGTH
            : Math.floor(MAX_RECEIPT_EVIDENCE_LENGTH / retainedReceipts.length);
    const receipts = retainedReceipts.map((receipt) => ({
        id: boundedString(receipt.id).value,
        summary: boundedTo(receipt.summary, receiptSummaryBudget),
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

    const userMessage = buildLlmActionUserMessage({
        prompt: input.prompt,
        context: input.context,
        projectRevision: input.projectRevision,
        ...input.capabilityData,
    });

    const suffix = evidence.delta.mode === 'delta' ? '' : `\n\n${userMessage}`;

    return {
        authorityComplete: productionBrief?.incompleteRelevantAuthority !== true,
        evidence,
        message: `fixed_policy:\n${input.fixedPolicy}\n\nrun_authority:\n${stableJson({ grants: evidence.grants, budgets: evidence.budgets })}\n\nuser_request:\n${stableJson({ trust: 'untrusted_user_string', ...boundedString(input.prompt) })}\n\nproduction_brief_and_locks:\n${stableJson({ trust: 'untrusted_project_data', value: productionBrief })}\n\nrevision_and_selection:\n${stableJson({ revision, selection: evidence.selection, delta: evidence.delta })}\n\nrelevant_evidence:\n${stableJson({ trust: 'untrusted_project_data', receipts, omitted: Math.max(0, (input.receipts?.length ?? 0) - receipts.length) })}\n\ncapability_schemas:\n${stableJson({ schemas: capabilitySchemas, omitted: Math.max(0, (input.capabilitySchemas?.length ?? 0) - capabilitySchemas.length), trust: 'untrusted_project_data', availableCapabilities: stableJson(input.capabilityData ?? null).slice(0, 8_192) })}\n\nvalidation_failures:\n${stableJson({ evidence: validationFailureEvidence, items: validationFailures.map((failure) => ({ code: boundedString(failure.code) })) })}\n\nmeasurements:\n${stableJson({ items: measurements, omitted: Math.max(0, (input.measurements?.length ?? 0) - measurements.length) })}\n\nuntrusted_project_data:\n${stableJson({ snapshotIdentity: snapshot.identity, mode: evidence.delta.mode, data: revisionPayload.projectPayload })}${suffix}`,
    };
}
