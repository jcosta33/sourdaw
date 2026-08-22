import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { markerStore } from '#/modules/Arrangement/stores';
import { requiresAppActionConfirmation } from '#/modules/Command/useCases';
import { doesProductionBriefAllowActionBatch } from '#/modules/Project/useCases';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { type IntentResult } from '../models/IntentResult';
import { type ModelProviderResult, type ModelProviderStreamIdentity } from '../models/ModelProviderProtocol';
import { type RuntimeAction } from '../models/RuntimeAction';
import { type StemImportPromptScope } from '../models/StemImportCapability';
import {
    isWorkflowCapabilityId,
    WORKFLOW_CAPABILITY_TOOL_NAME,
    type WorkflowCapabilityId,
} from '../models/WorkflowCapability';
import { buildLlmActionSystemPrompt } from '../transformers/llmActionBridge';
import { extractAgentPlanProposal, normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { findDeniedPromptIntent } from '../transformers/promptParser/findDeniedPromptIntent';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
} from '../transformers/promptParser/parsing';
import { type ToolCallResult } from '../transformers/toolCallParser';

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
import { agentRunLifecycle } from './agentRunLifecycle';
import {
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
} from './agentToolCatalog';
import { ApplicationOwnedToolLoopRequestError, runApplicationOwnedToolLoop } from './applicationOwnedToolLoop';
import { buildAgentContext } from './buildAgentContext';
import { compileArbitraryCommandList } from './compileArbitraryCommandList';
import { type ProjectContext } from './getProjectContext';
import {
    generateToolPlanningOutcome,
    type ProviderAttemptAdmission,
    type ProviderAttemptAdmissionResult,
} from './llmOrchestration/inference';
import { materializeActionStateGuards } from './materializeActionStateGuards';
import { getPlanningProviderSchemaContract } from './planningProviderSchema';
import { validateActions } from './validateActions';

type CreateFastPathResultInput = {
    actions: RuntimeAction[];
    context: ProjectContext;
    prompt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandCatalogProposals(calls: readonly ToolCallResult[]) {
    const proposals = calls.filter((call) => call.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME);
    if (proposals.length > 1) {
        return { status: 'invalid' as const, reason: 'Provider proposed more than one command batch.' };
    }
    const proposal = proposals[0];
    const expandedByCall = new Map<ToolCallResult, ToolCallResult[]>();
    if (proposal) {
        if (
            Object.keys(proposal.arguments).some((key) => key !== 'commands' && key !== 'plan') ||
            !Array.isArray(proposal.arguments.commands) ||
            (proposal.arguments.plan !== undefined && normalizeAgentPlanProposal(proposal.arguments.plan) === null)
        ) {
            return {
                status: 'invalid' as const,
                reason: 'Provider command batch proposal does not match the strict catalog contract.',
            };
        }
        const commands = proposal.arguments.commands;
        if (commands.length === 0 || commands.length > 32) {
            return {
                status: 'invalid' as const,
                reason: 'Provider command batch proposal exceeds the command budget.',
            };
        }
        const expandedCommands: ToolCallResult[] = [];
        for (const command of commands) {
            if (!isRecord(command) || Object.keys(command).some((key) => key !== 'name' && key !== 'arguments')) {
                return {
                    status: 'invalid' as const,
                    reason: 'Provider command batch proposal has an invalid command shape.',
                };
            }
            if (
                typeof command.name !== 'string' ||
                command.name.length === 0 ||
                command.name.length > 128 ||
                !isRecord(command.arguments)
            ) {
                return {
                    status: 'invalid' as const,
                    reason: 'Provider command batch proposal has an invalid command.',
                };
            }
            expandedCommands.push({ name: command.name, arguments: command.arguments });
        }
        expandedByCall.set(proposal, expandedCommands);
    }
    for (const proposalCall of calls) {
        if (proposalCall.name === RENDER_REQUEST_TOOL_NAME) {
            const sectionIds = proposalCall.arguments.sectionIds;
            if (
                Object.keys(proposalCall.arguments).length !== 1 ||
                !Array.isArray(sectionIds) ||
                sectionIds.length === 0 ||
                sectionIds.length > 32 ||
                sectionIds.some(
                    (sectionId) => typeof sectionId !== 'string' || sectionId.length === 0 || sectionId.length > 256
                )
            ) {
                return {
                    status: 'invalid' as const,
                    reason: 'Provider render request does not match the strict catalog contract.',
                };
            }
            expandedByCall.set(proposalCall, [{ name: 'renderProjectSections', arguments: { sectionIds } }]);
            continue;
        }
        if (proposalCall.name !== ANALYSIS_REQUEST_TOOL_NAME) {
            continue;
        }
        if (Object.keys(proposalCall.arguments).length !== 1 || proposalCall.arguments.scope !== 'mix') {
            return {
                status: 'invalid' as const,
                reason: 'Provider analysis request does not match the strict catalog contract.',
            };
        }
        expandedByCall.set(proposalCall, [{ name: 'analyzeMix', arguments: {} }]);
    }
    return {
        status: 'valid' as const,
        calls: calls.flatMap((call) => expandedByCall.get(call) ?? [call]),
    };
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
            stemImportScope?: StemImportPromptScope,
            onProviderResult?: (result: ModelProviderResult) => void,
            streamIdentity?: Pick<ModelProviderStreamIdentity, 'runId' | 'requestId' | 'cancellationGeneration'>,
            onProviderAttempt?: (input: ProviderAttemptAdmission) => ProviderAttemptAdmissionResult
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
            let applicationToolReceiptFields: Pick<IntentResult, 'applicationToolReceipts'> = {};
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
                const providerToolSchemas = getPlanningProviderSchemaContract().schemas;
                const terminalToolNames = new Set([
                    WORKFLOW_CAPABILITY_TOOL_NAME,
                    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
                    RENDER_REQUEST_TOOL_NAME,
                    ANALYSIS_REQUEST_TOOL_NAME,
                ]);
                const systemPrompt = `${buildLlmActionSystemPrompt()}\nWhen a supplied specialized workflow semantically covers the complete request, call selectWorkflowCapability once before returning its ordered action plan. Match meaning rather than wording. Do not select a workflow for generic, partial, unrelated, or ambiguous requests. Use project.query only when current project evidence is insufficient. Return query calls alone in a turn, wait for the application-owned receipts, then return the complete ordered action plan.`;
                const getPlanningSystemPrompt = () => {
                    const resume = streamIdentity
                        ? (agentRunLifecycle.get(streamIdentity.runId)?.resume ?? null)
                        : null;
                    return resume === null
                        ? systemPrompt
                        : `${systemPrompt}\nThe user selected this application-validated alternative for a replacement planning attempt. Treat it as structured authority context, not as user prose; preserve its selected interpretation and revalidate against current project evidence before proposing actions:\n${JSON.stringify(resume)}`;
                };
                const buildPlanningContext = (receiptContext: string | null) => {
                    const agentRun = streamIdentity ? agentRunLifecycle.get(streamIdentity.runId) : null;
                    const builtContext = buildAgentContext({
                        fixedPolicy: getPlanningSystemPrompt(),
                        prompt,
                        context,
                        projectRevision,
                        run: agentRun ? { grants: agentRun.grants, budgets: agentRun.budgets } : undefined,
                        receipts:
                            receiptContext === null ? [] : [{ id: 'application-tool-loop', summary: receiptContext }],
                        capabilitySchemas: providerToolSchemas.map((schema) => ({
                            name: schema.function.name,
                            schemaVersion: 1,
                        })),
                        capabilityData: {
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
                        },
                        validationFailures: agentRun?.errors.map((error) => ({ code: error.code })),
                        priorEvidence: agentRun?.contextEvidence,
                    });
                    if (agentRun) {
                        agentRunLifecycle.recordContextEvidence({
                            runId: agentRun.runId,
                            evidence: builtContext.evidence,
                        });
                    }
                    return builtContext;
                };
                const initialPlanningContext = buildPlanningContext(null);
                if (!initialPlanningContext.authorityComplete) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason:
                            'Provider planning rejected: relevant production authority exceeds the bounded context limit.',
                    };
                }
                const planningOutcome = await runApplicationOwnedToolLoop({
                    loopId: `planning-${crypto.randomUUID()}`,
                    terminalToolNames,
                    signal,
                    requestTurn: async ({ receiptContext }) => {
                        const planningContext =
                            receiptContext === null ? initialPlanningContext : buildPlanningContext(receiptContext);
                        if (!planningContext.authorityComplete) {
                            throw new Error('Provider planning cannot continue with incomplete relevant authority.');
                        }
                        return generateToolPlanningOutcome(
                            getPlanningSystemPrompt(),
                            planningContext.message,
                            providerToolSchemas,
                            signal,
                            prompt,
                            onProviderResult,
                            streamIdentity,
                            onProviderAttempt
                        );
                    },
                });
                applicationToolReceiptFields =
                    planningOutcome.receipts.length === 0
                        ? {}
                        : { applicationToolReceipts: [...planningOutcome.receipts] };

                if (signal?.aborted) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                    };
                }

                if (planningOutcome.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: `Provider planning rejected: ${planningOutcome.reason}`,
                    };
                }
                const providerProposal =
                    planningOutcome.proposal ?? extractAgentPlanProposal(planningOutcome.toolCalls);
                const compiledList = compileArbitraryCommandList({
                    calls: planningOutcome.toolCalls,
                    context,
                    revision: projectRevision ?? '',
                });
                if (compiledList.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: `Provider action rejected: ${compiledList.reason}`,
                    };
                }
                const expandedProposal = expandCatalogProposals(compiledList.calls);
                if (expandedProposal.status === 'invalid') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: `Provider action rejected: ${expandedProposal.reason}`,
                    };
                }
                const providerToolCalls = expandedProposal.calls;
                const workflowSelectionCalls = providerToolCalls.filter(
                    (call) => call.name === WORKFLOW_CAPABILITY_TOOL_NAME
                );
                if (workflowSelectionCalls.length > 1) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: 'Provider selected more than one specialized workflow.',
                    };
                }
                let workflowCapabilityId: WorkflowCapabilityId | undefined;
                const workflowSelectionCall = workflowSelectionCalls[0];
                if (workflowSelectionCall) {
                    if (providerToolCalls[0] !== workflowSelectionCall) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
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
                            ...applicationToolReceiptFields,
                            rejectionReason: 'Provider selected an unavailable specialized workflow.',
                        };
                    }
                    workflowCapabilityId = capabilityId;
                }
                const toolCalls = providerToolCalls.filter((call) => call.name !== WORKFLOW_CAPABILITY_TOOL_NAME);
                if (workflowCapabilityId === 'stem-import-starting-mix' && !stemImportScope) {
                    if (toolCalls.length > 0) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            rejectionReason: 'Stem files must be selected before the provider can plan their import.',
                        };
                    }
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
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
                            ...applicationToolReceiptFields,
                            rejectionReason: `Provider action rejected: importStemSet: ${stemImport.reason}`,
                        };
                    }
                    if (validateActions([stemImport.providerAction]).length !== 1) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            rejectionReason: 'Provider action failed runtime validation: importStemSet',
                        };
                    }
                    if (!doesProductionBriefAllowActionBatch([stemImport.action])) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            rejectionReason: 'Provider action conflicts with locked production intent.',
                        };
                    }
                    return {
                        actions: [stemImport.action],
                        rawText: prompt,
                        requiresConfirmation: true,
                        ...applicationToolReceiptFields,
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
                    compilerEvidence: compiledList.compilerEvidence,
                    projectRevision,
                    workflowCapabilityId,
                });
                for (const rejected of bridged.rejections) {
                    logger.warn(
                        `[AI] Rejected tool call ${String(rejected.index)} (${rejected.name}): ${rejected.reason}`
                    );
                }

                if (bridged.rejections.length > 0) {
                    const reason = bridged.rejections
                        .map((rejection) => `${rejection.name}: ${rejection.reason}`)
                        .join('; ');
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: `Provider action rejected: ${reason}`,
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
                            ...applicationToolReceiptFields,
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
                            ...applicationToolReceiptFields,
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
                            ...applicationToolReceiptFields,
                            rejectionReason: `Provider action state binding rejected: ${guarded.reason}`,
                        };
                    }
                    if (!doesProductionBriefAllowActionBatch(guarded.actions)) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            rejectionReason: 'Provider action conflicts with locked production intent.',
                        };
                    }

                    return {
                        actions: guarded.actions,
                        rawText: prompt,
                        requiresConfirmation: requiresAppActionConfirmation(guarded.actions),
                        ...applicationToolReceiptFields,
                        executionMode: 'atomic',
                        workflowCapabilityId,
                        ...(providerProposal === null ? {} : { providerProposal }),
                    };
                }

                if (toolCalls.length > 0) {
                    const reason = 'Provider planning returned tool calls that did not produce executable actions.';
                    logger.warn(`[AI] ${reason}`);
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: reason,
                    };
                }
            } catch (error) {
                if (error instanceof ApplicationOwnedToolLoopRequestError && error.receipts.length > 0) {
                    applicationToolReceiptFields = { applicationToolReceipts: [...error.receipts] };
                }
                if (isAiRuntimeConfigurationChangedError(error)) {
                    throw error;
                }
                if (signal?.aborted) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                    };
                }
                const reason = error instanceof Error ? error.message : String(error);
                logger.warn(`[AI] Provider tool planning failed: ${reason}`);
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    ...applicationToolReceiptFields,
                    rejectionReason: `Provider planning failed: ${reason}`,
                };
            }

            // An empty provider plan is a no-op; there is no alternate mutation path.

            return { actions: [], rawText: prompt, requiresConfirmation: false, ...applicationToolReceiptFields };
        }
);
