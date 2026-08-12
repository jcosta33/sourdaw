import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { markerStore } from '#/modules/Arrangement/stores';
import { getExecutableAppActionToolSchemas, requiresAppActionConfirmation } from '#/modules/Command/useCases';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { type IntentResult } from '../models/IntentResult';
import { type RuntimeAction } from '../models/RuntimeAction';
import { buildLlmActionSystemPrompt, buildLlmActionUserMessage } from '../transformers/llmActionBridge';
import { findDeniedPromptIntent } from '../transformers/promptParser/findDeniedPromptIntent';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
} from '../transformers/promptParser/parsing';

import { bridgeGroundedLlmToolCalls } from './agentReference/bridgeGroundedLlmToolCalls';
import { getArticulationTransferPromptScope } from './agentReference/getArticulationTransferPromptScope';
import { getBackingVocalPlatePromptScope } from './agentReference/getBackingVocalPlatePromptScope';
import { getBassProcessingCopyPromptScope } from './agentReference/getBassProcessingCopyPromptScope';
import { getDrumPreviewBranchesPromptScope } from './agentReference/getDrumPreviewBranchesPromptScope';
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
import { validateActions } from './validateActions';

type CreateFastPathResultInput = {
    actions: RuntimeAction[];
    context: ProjectContext;
    prompt: string;
};

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
            projectRevision?: string
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
                const drumRoutingScope = getDrumRoutingPromptScope(prompt, context, projectRevision);
                const drumPreviewBranchesScope = getDrumPreviewBranchesPromptScope(prompt, context, projectRevision);
                const midiOverlapTransformScope = getMidiOverlapTransformPromptScope(prompt, context, projectRevision);
                const backingVocalPlateScope = getBackingVocalPlatePromptScope(prompt, context, projectRevision);
                const bassProcessingCopyScope = getBassProcessingCopyPromptScope(prompt, context, projectRevision);
                const articulationTransferScope = getArticulationTransferPromptScope(prompt, context, projectRevision);
                const articulationTransferCapability =
                    articulationTransferScope.status === 'request' ? articulationTransferScope.capability : undefined;
                const drumRoutingCapability =
                    drumRoutingScope.status === 'request' ? drumRoutingScope.capability : undefined;
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
                const sharedVocalFxBusesScope = getSharedVocalFxBusesPromptScope(prompt, context, projectRevision);
                const sharedVocalFxBusesCapability =
                    sharedVocalFxBusesScope.status === 'request' ? sharedVocalFxBusesScope.capability : undefined;
                const syncopatedArpeggioScope = getSyncopatedArpeggioPromptScope(prompt, context, projectRevision);
                const syncopatedArpeggioCapability =
                    syncopatedArpeggioScope.status === 'request' ? syncopatedArpeggioScope.capability : undefined;
                const wholeProjectVibeMixCapability = getWholeProjectVibeMixScope(
                    prompt,
                    context,
                    projectRevision
                )?.capability;
                const planningOutcome = await generateToolPlanningOutcome(
                    buildLlmActionSystemPrompt(),
                    buildLlmActionUserMessage({
                        prompt,
                        context,
                        projectRevision,
                        articulationTransferCapability,
                        backingVocalPlateCapability,
                        bassProcessingCopyCapability,
                        drumRoutingCapability,
                        drumPreviewBranchesCapability,
                        midiOverlapTransformCapability,
                        sidechainRoutingCapability,
                        sharedVocalFxBusesCapability,
                        syncopatedArpeggioCapability,
                        wholeProjectVibeMixCapability,
                    }),
                    getExecutableAppActionToolSchemas(),
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
                const toolCalls = planningOutcome.toolCalls;
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

                    return {
                        actions: guarded.actions,
                        rawText: prompt,
                        requiresConfirmation: requiresAppActionConfirmation(guarded.actions),
                        executionMode: 'atomic',
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
