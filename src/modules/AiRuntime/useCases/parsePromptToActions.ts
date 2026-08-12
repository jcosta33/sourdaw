import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { markerStore } from '#/modules/Arrangement/stores';
import { getExecutableAppActionToolSchemas, requiresAppActionConfirmation } from '#/modules/Command/useCases';
import { doesProductionBriefAllowActionBatch } from '#/modules/Project/useCases';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import {
    ACTION_PLANNING_MODE_TOOL_NAME,
    type ActionPlanningMode,
    createActionPlanningModeToolSchema,
} from '../models/ActionPlanningMode';
import { type IntentResult } from '../models/IntentResult';
import { type RuntimeAction } from '../models/RuntimeAction';
import { type StemImportPromptScope } from '../models/StemImportCapability';
import {
    createWorkflowCapabilityToolSchema,
    isWorkflowCapabilityId,
    WORKFLOW_CAPABILITY_TOOL_NAME,
    WORKFLOW_CAPABILITY_IDS,
    type WorkflowCapabilityId,
} from '../models/WorkflowCapability';
import { buildLlmActionSystemPrompt, buildLlmActionUserMessage } from '../transformers/llmActionBridge';
import { findDeniedPromptIntent } from '../transformers/promptParser/findDeniedPromptIntent';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
} from '../transformers/promptParser/parsing';

import { bridgeGroundedLlmToolCalls } from './agentReference/bridgeGroundedLlmToolCalls';
import { bridgeStemImportPlan } from './agentReference/bridgeStemImportPlan';
import { getArticulationTransferPromptScope } from './agentReference/getArticulationTransferPromptScope';
import { getBackingVocalPlatePromptScope } from './agentReference/getBackingVocalPlatePromptScope';
import { getBassProcessingCopyPromptScope } from './agentReference/getBassProcessingCopyPromptScope';
import { getDrumPreviewBranchesPromptScope } from './agentReference/getDrumPreviewBranchesPromptScope';
import { getDrumRenderComparisonPromptScope } from './agentReference/getDrumRenderComparisonPromptScope';
import { getDrumRoutingPromptScope } from './agentReference/getDrumRoutingPromptScope';
import { getMidiOverlapTransformPromptScope } from './agentReference/getMidiOverlapTransformPromptScope';
import { getSharedVocalFxBusesPromptScope } from './agentReference/getSharedVocalFxBusesPromptScope';
import { getSidechainRoutingPromptScope } from './agentReference/getSidechainRoutingPromptScope';
import { getSyncopatedArpeggioPromptScope } from './agentReference/getSyncopatedArpeggioPromptScope';
import { getWholeProjectVibeMixScope } from './agentReference/getWholeProjectVibeMixScope';
import { materializeBatchLocalActionIdentities } from './agentReference/materializeBatchLocalActionIdentities';
import { type ProjectContext } from './getProjectContext';
import { generateToolPlanningOutcome } from './llmOrchestration/inference';
import { materializeActionStateGuards } from './materializeActionStateGuards';
import { recordResolvedAgentReferences } from './recordResolvedAgentReferences';
import { validateActions } from './validateActions';

type CreateFastPathResultInput = {
    actions: RuntimeAction[];
    context: ProjectContext;
    prompt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseReferenceResolutionRequest(reason: string): IntentResult['referenceResolutionRequest'] | null {
    const prefix = 'REFERENCE_RESOLUTION:';
    if (!reason.startsWith(prefix)) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(reason.slice(prefix.length));
        if (!isRecord(value)) {
            return null;
        }
        const record = value;
        if (
            (record.kind !== 'clarification' && record.kind !== 'preview') ||
            typeof record.argument !== 'string' ||
            !Array.isArray(record.candidates)
        ) {
            return null;
        }
        const candidates = record.candidates.flatMap((candidate) => {
            if (!isRecord(candidate)) {
                return [];
            }
            const candidateRecord = candidate;
            if (
                typeof candidateRecord.id !== 'string' ||
                typeof candidateRecord.confidence !== 'number' ||
                !Number.isFinite(candidateRecord.confidence) ||
                candidateRecord.confidence < 0 ||
                candidateRecord.confidence > 1 ||
                !Array.isArray(candidateRecord.evidence)
            ) {
                return [];
            }
            const evidence = candidateRecord.evidence.flatMap((item) => {
                if (!isRecord(item)) {
                    return [];
                }
                const evidenceRecord = item;
                if (typeof evidenceRecord.kind !== 'string' || typeof evidenceRecord.value !== 'string') {
                    return [];
                }
                return [{ kind: evidenceRecord.kind, value: evidenceRecord.value }];
            });
            return [{ id: candidateRecord.id, confidence: candidateRecord.confidence, evidence }];
        });
        if (candidates.length !== record.candidates.length) {
            return null;
        }
        return { kind: record.kind, argument: record.argument, candidates };
    } catch {
        return null;
    }
}

function formatReferenceResolutionRejection(request: NonNullable<IntentResult['referenceResolutionRequest']>): string {
    const heading = request.kind === 'clarification' ? 'Reference clarification required' : 'Explicit preview required';
    const candidates = request.candidates.map((candidate) => {
        const confidence = Math.round(candidate.confidence * 100);
        const evidence = candidate.evidence.map((item) => `${item.kind}: ${item.value}`).join(', ');
        return `- ${candidate.id} — ${confidence}% confidence (${evidence})`;
    });
    const response =
        request.kind === 'preview'
            ? 'Reply with the intended stable ID and request a preview.'
            : 'Reply with the intended stable ID.';
    return `${heading} for ${request.argument} before any command can run.\n${candidates.join('\n')}\n${response}`;
}

function createFastPathResult(input: CreateFastPathResultInput): IntentResult {
    const validated = validateActions(input.actions);
    if (validated.length !== input.actions.length) {
        const rejectedTypes = input.actions
            .filter((action) => !validated.includes(action))
            .map((action) => action.type)
            .join(', ');
        return {
            actions: [],
            rawText: input.prompt,
            requiresConfirmation: false,
            rejectionReason: `Recognized command failed runtime validation: ${rejectedTypes}`,
        };
    }

    const materialized = materializeActionStateGuards(validated, input.context);
    if (materialized.status === 'rejected') {
        return {
            actions: [],
            rawText: input.prompt,
            requiresConfirmation: false,
            rejectionReason: `Recognized command could not bind current project state: ${materialized.reason}`,
        };
    }
    if (!doesProductionBriefAllowActionBatch(materialized.actions)) {
        return {
            actions: [],
            rawText: input.prompt,
            requiresConfirmation: false,
            rejectionReason: 'Recognized command conflicts with locked production intent.',
        };
    }

    return {
        actions: materialized.actions,
        rawText: input.prompt,
        requiresConfirmation: requiresAppActionConfirmation(materialized.actions),
    };
}

/**
 * Prompt parsing order:
 * 1. Non-executable recognition for explicitly denied action intents
 * 2. Fast-path: fuzzy-match against executable preset action registry
 * 3. Parameterized fast-path: regex for commands that need values (tempo N, transpose N)
 * 4. Compound fast-path: multi-track creation etc.
 * 5. Provider-neutral LLM tool path: tool calls cross a strict app-owned action bridge
 */
export const parsePromptToActions = inject({ logger })(
    ({ logger }) =>
        async function parsePromptToActions(
            prompt: string,
            context: ProjectContext,
            signal?: AbortSignal,
            projectRevision?: string,
            stemImportScope?: StemImportPromptScope
        ): Promise<IntentResult> {
            const normalized = prompt.toLowerCase().trim();

            const deniedActionType = findDeniedPromptIntent(normalized);
            if (deniedActionType !== null) {
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    rejectionReason: `Action ${deniedActionType} cannot be executed by AI because it does not report completion.`,
                };
            }

            // 2. Try executable preset actions via fuzzy match
            const presetCtx = buildPresetContext(context);
            const presetResult = tryPresetMatch(normalized, presetCtx);
            if (presetResult.length > 0) {
                return createFastPathResult({ actions: presetResult, context, prompt });
            }

            // 3. Try parameterized patterns (need value extraction)
            const paramResult = tryParameterizedPath(normalized, context);
            if (paramResult.length > 0) {
                return createFastPathResult({ actions: paramResult, context, prompt });
            }

            // 4. Try compound fast path (multi-track creation etc.)
            const compoundResult = tryCompoundFastPath(normalized, context);
            if (compoundResult !== null) {
                return createFastPathResult({ actions: compoundResult, context, prompt });
            }

            if (signal?.aborted) {
                return { actions: [], rawText: prompt, requiresConfirmation: false };
            }

            // 5. Provider-neutral LLM path. This only proposes typed actions;
            // sendChatMessage remains responsible for confirmation and execution.
            try {
                const drumRoutingScope = getDrumRoutingPromptScope(context, projectRevision);
                const drumRenderComparisonScope = getDrumRenderComparisonPromptScope(context, projectRevision);
                const drumPreviewBranchesScope = getDrumPreviewBranchesPromptScope(context, projectRevision);
                const midiOverlapTransformScope = getMidiOverlapTransformPromptScope(context, projectRevision);
                const backingVocalPlateScope = getBackingVocalPlatePromptScope(context, projectRevision);
                const bassProcessingCopyScope = getBassProcessingCopyPromptScope(context, projectRevision);
                const articulationTransferScope = getArticulationTransferPromptScope(context, projectRevision);
                const articulationTransferCapability =
                    articulationTransferScope.status === 'request' ? articulationTransferScope.capability : undefined;
                const drumRoutingCapability =
                    drumRoutingScope.status === 'request' ? drumRoutingScope.capability : undefined;
                const drumRenderComparisonCapability =
                    drumRenderComparisonScope.status === 'request' ? drumRenderComparisonScope.capability : undefined;
                const drumPreviewBranchesCapability =
                    drumPreviewBranchesScope.status === 'request' ? drumPreviewBranchesScope.capability : undefined;
                const midiOverlapTransformCapability =
                    midiOverlapTransformScope.status === 'request' ? midiOverlapTransformScope.capability : undefined;
                const backingVocalPlateCapability =
                    backingVocalPlateScope.status === 'request' ? backingVocalPlateScope.capability : undefined;
                const bassProcessingCopyCapability =
                    bassProcessingCopyScope.status === 'request' ? bassProcessingCopyScope.capability : undefined;
                const sidechainRoutingScope = getSidechainRoutingPromptScope(prompt, context, projectRevision);
                const sidechainRoutingCapability =
                    sidechainRoutingScope.status === 'request' ? sidechainRoutingScope.capability : undefined;
                const sharedVocalFxBusesScope = getSharedVocalFxBusesPromptScope(context, projectRevision);
                const sharedVocalFxBusesCapability =
                    sharedVocalFxBusesScope.status === 'request' ? sharedVocalFxBusesScope.capability : undefined;
                const syncopatedArpeggioScope = getSyncopatedArpeggioPromptScope(context, projectRevision);
                const syncopatedArpeggioCapability =
                    syncopatedArpeggioScope.status === 'request' ? syncopatedArpeggioScope.capability : undefined;
                const wholeProjectVibeMixCapability = getWholeProjectVibeMixScope(
                    prompt,
                    context,
                    projectRevision
                )?.capability;
                const planningOutcome = await generateToolPlanningOutcome(
                    `${buildLlmActionSystemPrompt()}\nWhen a supplied specialized workflow semantically covers the complete request, call selectWorkflowCapability once before returning its ordered action plan. Match meaning rather than wording. Do not select a workflow for generic, partial, unrelated, or ambiguous requests. When the user explicitly asks to preview or inspect a proposed action before deciding, call selectActionPlanningMode with mode preview before executable action tools.`,
                    buildLlmActionUserMessage({
                        prompt,
                        context,
                        projectRevision,
                        articulationTransferCapability,
                        backingVocalPlateCapability,
                        bassProcessingCopyCapability,
                        drumRoutingCapability,
                        drumRenderComparisonCapability,
                        drumPreviewBranchesCapability,
                        midiOverlapTransformCapability,
                        sidechainRoutingCapability,
                        sharedVocalFxBusesCapability,
                        stemImportCapability: stemImportScope?.capability,
                        syncopatedArpeggioCapability,
                        wholeProjectVibeMixCapability,
                    }),
                    [
                        createWorkflowCapabilityToolSchema(WORKFLOW_CAPABILITY_IDS),
                        createActionPlanningModeToolSchema(),
                        ...getExecutableAppActionToolSchemas(),
                    ],
                    signal,
                    prompt
                );

                if (signal?.aborted) {
                    return { actions: [], rawText: prompt, requiresConfirmation: false };
                }

                if (planningOutcome.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: `Provider planning rejected: ${planningOutcome.reason}`,
                    };
                }
                const planningModeCalls = planningOutcome.toolCalls.filter(
                    (call) => call.name === ACTION_PLANNING_MODE_TOOL_NAME
                );
                if (planningModeCalls.length > 1) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: 'Provider selected more than one action planning mode.',
                    };
                }
                let actionPlanningMode: ActionPlanningMode = 'execute';
                const planningModeCall = planningModeCalls[0];
                if (planningModeCall) {
                    const firstExecutableCallIndex = planningOutcome.toolCalls.findIndex(
                        (call) =>
                            call.name !== ACTION_PLANNING_MODE_TOOL_NAME && call.name !== WORKFLOW_CAPABILITY_TOOL_NAME
                    );
                    const planningModeCallIndex = planningOutcome.toolCalls.indexOf(planningModeCall);
                    if (firstExecutableCallIndex !== -1 && planningModeCallIndex > firstExecutableCallIndex) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Provider must select preview mode before proposing actions.',
                        };
                    }
                    const keys = Object.keys(planningModeCall.arguments);
                    if (keys.length !== 1 || keys[0] !== 'mode' || planningModeCall.arguments.mode !== 'preview') {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Provider selected an unavailable action planning mode.',
                        };
                    }
                    actionPlanningMode = 'preview';
                }
                const workflowSelectionCalls = planningOutcome.toolCalls.filter(
                    (call) => call.name === WORKFLOW_CAPABILITY_TOOL_NAME
                );
                if (workflowSelectionCalls.length > 1) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: 'Provider selected more than one specialized workflow.',
                    };
                }
                let workflowCapabilityId: WorkflowCapabilityId | undefined;
                const workflowSelectionCall = workflowSelectionCalls[0];
                if (workflowSelectionCall) {
                    if (planningOutcome.toolCalls[0] !== workflowSelectionCall) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason:
                                'Provider must select a specialized workflow before proposing its actions.',
                        };
                    }
                    const keys = Object.keys(workflowSelectionCall.arguments);
                    const capabilityId = workflowSelectionCall.arguments.capabilityId;
                    if (keys.length !== 1 || keys[0] !== 'capabilityId' || !isWorkflowCapabilityId(capabilityId)) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Provider selected an unavailable specialized workflow.',
                        };
                    }
                    workflowCapabilityId = capabilityId;
                }
                const toolCalls = planningOutcome.toolCalls.filter(
                    (call) =>
                        call.name !== WORKFLOW_CAPABILITY_TOOL_NAME && call.name !== ACTION_PLANNING_MODE_TOOL_NAME
                );
                if (workflowCapabilityId === 'stem-import-starting-mix' && !stemImportScope) {
                    if (toolCalls.length > 0) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Stem files must be selected before the provider can plan their import.',
                        };
                    }
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        preparationRequest: 'stem-import',
                    };
                }
                if (stemImportScope && workflowCapabilityId === 'stem-import-starting-mix') {
                    const stemImport = bridgeStemImportPlan(toolCalls, stemImportScope);
                    if (stemImport.status === 'rejected') {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: `Provider action rejected: importStemSet: ${stemImport.reason}`,
                        };
                    }
                    if (validateActions([stemImport.providerAction]).length !== 1) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Provider action failed runtime validation: importStemSet',
                        };
                    }
                    if (!doesProductionBriefAllowActionBatch([stemImport.action])) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Provider action conflicts with locked production intent.',
                        };
                    }
                    return {
                        actions: [stemImport.action],
                        rawText: prompt,
                        requiresConfirmation: true,
                        executionMode: 'atomic',
                        workflowCapabilityId,
                    };
                }
                const markerSignatures = (markerStore.value?.markers ?? []).map((marker) => ({
                    beat: marker.beat,
                    color: marker.color,
                    markerId: marker.id,
                    name: marker.name,
                }));
                const sectionSignatures = (markerStore.value?.sections ?? []).map((section) => ({
                    endBeat: section.endBeat,
                    name: section.name,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                }));
                const bridged = bridgeGroundedLlmToolCalls({
                    calls: toolCalls,
                    context,
                    markerSignatures,
                    sectionSignatures,
                    prompt,
                    referenceResolutionMode: actionPlanningMode,
                    workflowCapabilityId,
                });
                for (const rejected of bridged.rejections) {
                    logger.warn(
                        `[AI] Rejected tool call ${String(rejected.index)} (${rejected.name}): ${rejected.reason}`
                    );
                }

                if (bridged.rejections.length > 0) {
                    const referenceResolutionRequest = bridged.rejections
                        .map((rejection) => parseReferenceResolutionRequest(rejection.reason))
                        .find((request) => request !== null);
                    const reason = bridged.rejections
                        .map((rejection) => `${rejection.name}: ${rejection.reason}`)
                        .join('; ');
                    let rejectionReason = `Provider action rejected: ${reason}`;
                    if (referenceResolutionRequest) {
                        rejectionReason = formatReferenceResolutionRejection(referenceResolutionRequest);
                    }
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...(referenceResolutionRequest ? { referenceResolutionRequest } : {}),
                        rejectionReason,
                    };
                }

                if (bridged.actions.length > 0) {
                    const validated = validateActions(bridged.actions);
                    if (validated.length !== bridged.actions.length) {
                        const rejectedTypes = bridged.actions
                            .filter((action) => !validated.includes(action))
                            .map((action) => action.type)
                            .join(', ');
                        logger.warn('[AI] Rejected LLM action batch because runtime validation removed an action');
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: `Provider action failed runtime validation: ${rejectedTypes}`,
                        };
                    }

                    const materialized = materializeBatchLocalActionIdentities(
                        validated,
                        bridged.batchLocalActionIdentities ?? []
                    );
                    if (materialized.status === 'rejected') {
                        logger.warn(`[AI] Rejected LLM action batch because ${materialized.reason}`);
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: `Provider action identity rejected: ${materialized.reason}`,
                        };
                    }

                    const guarded = materializeActionStateGuards(materialized.actions, context, {
                        appOwnedRenderTailSeconds: bridged.appOwnedRenderTailSeconds,
                        bassProcessingCopyScope: bridged.bassProcessingCopyScope,
                        midiOverlapTransformScope: bridged.midiOverlapTransformScope,
                        drumPreviewBranchesScope: bridged.drumPreviewBranchesScope,
                        syncopatedArpeggioScope: bridged.syncopatedArpeggioScope,
                    });
                    if (guarded.status === 'rejected') {
                        logger.warn(`[AI] Rejected LLM action batch because ${guarded.reason}`);
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: `Provider action state binding rejected: ${guarded.reason}`,
                        };
                    }
                    if (!doesProductionBriefAllowActionBatch(guarded.actions)) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: 'Provider action conflicts with locked production intent.',
                        };
                    }

                    recordResolvedAgentReferences(bridged.resolvedReferences ?? []);
                    return {
                        actions: guarded.actions,
                        rawText: prompt,
                        requiresConfirmation: requiresAppActionConfirmation(guarded.actions),
                        executionMode: 'atomic',
                        workflowCapabilityId,
                    };
                }

                if (toolCalls.length > 0) {
                    const reason = 'Provider planning returned tool calls that did not produce executable actions.';
                    logger.warn(`[AI] ${reason}`);
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: reason,
                    };
                }
            } catch (error) {
                if (isAiRuntimeConfigurationChangedError(error)) {
                    throw error;
                }
                if (signal?.aborted) {
                    return { actions: [], rawText: prompt, requiresConfirmation: false };
                }
                const reason = error instanceof Error ? error.message : String(error);
                logger.warn(`[AI] Provider tool planning failed: ${reason}`);
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    rejectionReason: `Provider planning failed: ${reason}`,
                };
            }

            // An empty provider plan is a no-op; there is no alternate mutation path.

            return { actions: [], rawText: prompt, requiresConfirmation: false };
        }
);
