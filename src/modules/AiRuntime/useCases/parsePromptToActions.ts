import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { requiresAppActionConfirmation } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { doesProductionBriefAllowActionBatch } from '#/modules/Project/useCases';
import { canonicalJson, digest } from '#/utils/canonicalDigest';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { AGENT_CONTEXT_RECEIPT_EVIDENCE_MAX_CHARACTERS } from '../models/AgentContext';
import { REMOTE_EVIDENCE_AGENT_DATA_CATEGORIES } from '../models/AgentDataPolicy';
import { ANSWER_INTERPRETATION_TOOL_NAME, createAnswerInterpretationToolSchema } from '../models/AnswerInterpretation';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type CommandBatchDecline } from '../models/CommandBatchDecline';
import {
    CREATIVE_INTERPRETATION_TOOL_NAME,
    createCreativeInterpretationToolSchema,
    type CreativeRequestAuthority,
    getCreativeSelectionSnapshot,
} from '../models/CreativeInterpretation';
import { type IntentResult, type PlannedIntentResult } from '../models/IntentResult';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type MeasurementAdmitter } from '../models/MeasurementBudget';
import { type MetricNativeLiteralUse } from '../models/MetricGoalAdmission';
import { type ModelProviderResult, type ModelProviderStreamIdentity } from '../models/ModelProviderProtocol';
import { type PlanningOutcome } from '../models/PlanningOutcome';
import {
    type PlanningProfile,
    READONLY_ANSWER_MAX_OUTPUT_TOKENS,
    READONLY_ANSWER_TERMINAL_NAMES,
} from '../models/PlanningProfile';
import { type PlanningRejectionEvidence } from '../models/PlanningRejectionEvidence';
import { PRESET_ACTIONS, type PresetContext } from '../models/PresetActions/Registry';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { type RuntimeAction } from '../models/RuntimeAction';
import { type StemImportPromptScope } from '../models/StemImportCapability';
import { type ThreadContext } from '../models/ThreadContext';
import {
    isWorkflowCapabilityId,
    WORKFLOW_ACTION_TOOL_NAMES,
    WORKFLOW_CAPABILITY_TOOL_NAME,
    WORKFLOW_METRIC_CAPABILITY_IDS,
    type WorkflowCapabilityId,
} from '../models/WorkflowCapability';
import { getAvailablePresets } from '../services/fuzzySearch';
import { getPendingActionConfirmation } from '../stores/pendingActionConfirmationStore';
import { buildPlanningSystemPrompt } from '../transformers/buildPlanningSystemPrompt';
import { extractAgentPlanProposal, normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { findDeniedPromptIntent } from '../transformers/promptParser/findDeniedPromptIntent';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
} from '../transformers/promptParser/parsing';
import { type ToolCallResult } from '../transformers/toolCallParser';
import { admitProposalRefinement, validateRefinedProposalActions } from '../validators/admitProposalRefinement';
import { matchesJsonSchema } from '../validators/matchesJsonSchema';

import { admitAnswerInterpretation } from './admitAnswerInterpretation';
import { admitPerceptualGoalDecline } from './admitPerceptualGoalDecline';
import { admitPlanningInterpretation } from './admitPlanningInterpretation';
import { freezeWorkflowNativeLiteralUses } from './agentReference/bridgeBackingVocalPlatePlan';
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
import { proposalCommandShape } from './agentReference/proposalCommandShape';
import { proposalProtection } from './agentReference/proposalProtection';
import { readExplicitProtections } from './agentReference/readExplicitProtections';
import { readStoredCardRemoval } from './agentReference/readStoredCardRemoval';
import { agentRunLifecycle } from './agentRunLifecycle';
import {
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    ANALYSIS_REQUEST_TOOL_NAME,
    ANSWER_RESPOND_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from './agentToolCatalog';
import { resolveRawPresetActions } from './aiRuntimeQueries/resolvePresetActions';
import { ApplicationOwnedToolLoopRequestError, runApplicationOwnedToolLoop } from './applicationOwnedToolLoop';
import { buildAgentContext } from './buildAgentContext';
import { collectMetricGoalProof } from './collectMetricGoalProof';
import { type ArbitraryCommandListCompilation, compileArbitraryCommandList } from './compileArbitraryCommandList';
import { compilePreviewMeasurementProposal } from './compilePreviewMeasurementProposal';
import { createPlanningInterpretationToolSchema } from './createPlanningInterpretationToolSchema';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { executeAnalysisMeasure } from './executeAnalysisMeasure';
import { executeRecipeExpansion } from './executeRecipeExpansion';
import { executeReferenceMeasurement } from './executeReferenceMeasurement';
import { executeTransformCompile } from './executeTransformCompile';
import { executeTransientOnsetRead } from './executeTransientOnsetRead';
import { getCompiledTransformTargetIds } from './getCompiledTransformTargetIds';
import { getPlanningProviderToolSchemas } from './getPlanningProviderToolSchemas';
import { type ProjectContext } from './getProjectContext';
import { groundCompiledCommandBatch } from './groundCompiledCommandBatch';
import {
    generateToolPlanningOutcome,
    type ProviderAttemptAdmission,
    type ProviderAttemptAdmissionResult,
} from './llmOrchestration/inference';
import { materializeActionStateGuards } from './materializeActionStateGuards';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';
import { type MetricRequestAuthority, type MetricGoalState } from './metricGoalContractTypes';
import { metricGoalStateCodec } from './metricGoalStateCodec';
import { planLastCommitContinuation } from './planLastCommitContinuation';
import { prepareAnswerInterpretationCatalog } from './prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from './prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from './prepareMetricIntentCatalog';
import { projectDeclarativeTransformSnapshot } from './projectDeclarativeTransformSnapshot';
import { projectPlanningProviderToolSchemas, type PlanningAnswerPhase } from './projectPlanningProviderToolSchemas';
import { splitCompiledCommandList } from './splitCompiledCommandList';
import { validateActions } from './validateActions';
import {
    admitWorkflowMetricIntake,
    prepareWorkflowMetricScopes,
    projectWorkflowMetricToolSchemas,
} from './workflowMetricIntake';

type ParsePromptToActionsInput = {
    prompt: string;
    context: ProjectContext;
    preset?: { id: string; expectedContext: PresetContext };
    signal?: AbortSignal;
    projectRevision?: string;
    stemImportScope?: StemImportPromptScope;
    onProviderResult?: (result: ModelProviderResult) => void;
    streamIdentity?: Pick<ModelProviderStreamIdentity, 'runId' | 'requestId' | 'cancellationGeneration'>;
    onProviderAttempt?: (input: ProviderAttemptAdmission) => ProviderAttemptAdmissionResult;
    correction?: {
        creativeAuthority: CreativeRequestAuthority | null;
        rejectionEvidence?: PlanningRejectionEvidence;
    };
    providerPlanning?: 'enabled' | 'disabled';
    profile?: PlanningProfile;
    onMeasurementAttempt?: MeasurementAdmitter;
    /** The chat thread's earlier turns, which the planner reads as its `thread_context` section. */
    thread?: ThreadContext | null;
};

type CreateFastPathResultInput = {
    projectRevision?: string;
    actions: RuntimeAction[];
    context: ProjectContext;
    prompt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

/**
 * The rejected fragment a correction attempt gets to see. Provider-authored
 * content stays bounded here; the context labels it untrusted where it is
 * serialized.
 */
const MAX_REJECTED_FRAGMENT_LENGTH = 512;

function boundedProviderFragment(value: unknown): string | undefined {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? undefined : serialized.slice(0, MAX_REJECTED_FRAGMENT_LENGTH);
    } catch {
        return undefined;
    }
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
        if (commands.length === 0 || commands.length > MAX_LLM_ACTIONS_PER_BATCH) {
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

/**
 * The measured preview a proposal adopted. Whether its figures describe the batch that runs is
 * decided where that batch is persisted for approval, by content hash, because only there does
 * the final batch exist: anything the turn added beside the preview, or any grounding that came
 * out differently, changes the hash and drops the figures.
 */
function readAdoptedMeasuredPreview(selectedCompilations: readonly RetainedCompilation[]): MeasuredPreview | null {
    const adopted = selectedCompilations.find((compiled) => compiled.kind === 'preview');
    return adopted?.kind === 'preview' ? adopted.measuredPreview : null;
}

type AcceptedCompiledList = Extract<ArbitraryCommandListCompilation, { status: 'accepted' }>;

type ScheduledCompiledBatches =
    | { status: 'scheduled'; firstBatch: AcceptedCompiledList; batchSchedule?: IntentResult['batchSchedule'] }
    | { status: 'rejected'; reason: string };

/**
 * A list that expands past one batch runs as successive batches, each approved on its own. This
 * planning turn carries the first; the rest are kept serialized on the result until the run proposes
 * them. A list that fits one batch passes through untouched. Only a plain structured list can be
 * split: an adopted transform, recipe or measured preview, or a specialized workflow or other request
 * beside the list, describes one batch and is refused rather than cut apart.
 */
function scheduleCompiledBatches(input: {
    compiledList: AcceptedCompiledList;
    selectedCompilations: readonly RetainedCompilation[];
    providerProposal: IntentResult['providerProposal'] | null;
}): ScheduledCompiledBatches {
    const evidence = input.compiledList.compilerEvidence;
    if (evidence === undefined || evidence.commands.length <= MAX_LLM_ACTIONS_PER_BATCH) {
        return { status: 'scheduled', firstBatch: input.compiledList };
    }
    if (input.selectedCompilations.length > 0) {
        return {
            status: 'rejected',
            reason: 'An adopted transform, recipe or measured preview cannot run as successive batches.',
        };
    }
    if (input.compiledList.calls.some((call) => call.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME)) {
        return {
            status: 'rejected',
            reason: 'A list larger than one batch cannot share its turn with a specialized workflow or another request.',
        };
    }
    const split = splitCompiledCommandList({
        evidence,
        maxCommandsPerBatch: MAX_LLM_ACTIONS_PER_BATCH,
        setSelectors: input.compiledList.setSelectors,
    });
    if (split.status === 'rejected') {
        return split;
    }
    const first = split.slices[0]!;
    return {
        status: 'scheduled',
        firstBatch: {
            ...input.compiledList,
            compilerEvidence: first,
            calls: input.compiledList.calls.map((call) => ({
                name: call.name,
                arguments: { plan: call.arguments.plan, commands: structuredClone(first.commands) },
            })),
        },
        batchSchedule: {
            schemaVersion: 1,
            scheduleId: `batch-schedule-${crypto.randomUUID()}`,
            position: 1,
            total: split.slices.length,
            totalCommands: evidence.commands.length,
            serializedProviderProposal:
                input.providerProposal === null || input.providerProposal === undefined
                    ? null
                    : JSON.stringify(input.providerProposal),
            slices: split.slices.map((slice, index) => ({
                position: index + 1,
                commandCount: slice.commands.length,
                targetIds: [...slice.providerKnownTargetIds],
                serializedSlice: JSON.stringify(slice),
            })),
        },
    };
}

/**
 * Turns a provider decline into an outcome, or refuses it. `unsupported` is a claim about the whole
 * catalog, so it only stands when this run actually searched the command index; without that
 * receipt the provider is guessing from vocabulary rather than from evidence.
 */
function classifyProviderDecline(
    decline: CommandBatchDecline,
    receipts: readonly ApplicationToolReceipt[],
    searchedIntents: readonly string[]
): PlanningOutcome {
    const { kind, reason, questions } = decline;
    if (kind === 'clarify') {
        return questions.length === 0
            ? { kind: 'denied', reason: 'Provider asked for clarification without a question.' }
            : { kind: 'clarify', reason, questions };
    }
    const searchedCommandIndex = receipts.some(
        (receipt) => receipt.toolName === AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME && receipt.status === 'success'
    );
    return searchedCommandIndex
        ? { kind: 'unsupported', reason, searchedIntents: [...searchedIntents] }
        : { kind: 'denied', reason: 'Provider declined as unsupported without searching the command index.' };
}

/**
 * Every other return in the planner already says what happened through `actions` and
 * `rejectionReason`; this names it once so no caller has to re-derive it.
 */
function classifyPlannedIntentResult(result: IntentResult): PlanningOutcome {
    if (result.planningOutcome !== undefined) {
        return result.planningOutcome;
    }
    if (result.actions.length > 0) {
        return { kind: 'proposal' };
    }
    return result.rejectionReason === undefined
        ? { kind: 'no-match' }
        : { kind: 'denied', reason: result.rejectionReason };
}

/** The fields that say what the request was admitted to mean; `authorityId` is identity, not meaning. */
function creativeAuthorityMeaning(authority: CreativeRequestAuthority): string {
    return canonicalJson({
        catalogId: authority.catalogId,
        requestDigest: authority.requestDigest,
        revision: authority.revision,
        mode: authority.mode,
        targets: authority.targets,
        editDimensions: authority.editDimensions,
        prohibitions: authority.prohibitions,
        creationSlots: authority.creationSlots,
        uncertainty: authority.uncertainty,
    });
}

/**
 * A bounded correction re-runs the same request; it may not come back having decided that request
 * meant something else. The original record is reused unchanged, so downstream evidence stays bound
 * to the one authority the first attempt minted.
 */
function reconcileCorrectionCreativeAuthority(
    original: CreativeRequestAuthority | null,
    admitted: CreativeRequestAuthority | undefined
):
    | { status: 'reused'; creativeAuthority: CreativeRequestAuthority | undefined }
    | { status: 'rejected'; reason: string } {
    if (admitted === undefined) {
        return { status: 'reused', creativeAuthority: original ?? undefined };
    }
    if (original === null || creativeAuthorityMeaning(original) !== creativeAuthorityMeaning(admitted)) {
        return { status: 'rejected', reason: 'Provider correction changed the admitted creative authority.' };
    }
    return { status: 'reused', creativeAuthority: { ...admitted, authorityId: original.authorityId } };
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
        metricGoalState: JSON.stringify({
            schemaVersion: 1,
            authorities: [
                {
                    schemaVersion: 1,
                    authorityId: `literal-${digest(input.prompt)}`,
                    origin: 'complete-literal-parser',
                    callId: null,
                    turn: null,
                    catalogId: 'complete-literal-parser-v1',
                    requestDigest: digest(input.prompt.trim()),
                    revision: input.projectRevision ?? '',
                    projectId: captureProjectIdentity(),
                    selection: getCreativeSelectionSnapshot(input.context),
                    kind: 'literal',
                    goals: [],
                    creativeAuthority: null,
                },
            ],
            steps: [],
            proofs: [],
            binding: null,
        } satisfies MetricGoalState),
        rawText: input.prompt,
        requiresConfirmation: requiresAppActionConfirmation(materialized.actions),
    };
}

/**
 * The planned result of a request read against the thread's last commit, or `null` when it is no
 * such request and is planned as any other. A compiled continuation crosses the same validation,
 * state guards, production brief and risk policy as every application-compiled batch.
 */
function createLastCommitContinuationResult(
    prompt: string,
    context: ProjectContext,
    thread: ThreadContext | null,
    projectRevision?: string
): IntentResult | null {
    const continuation = planLastCommitContinuation({ prompt, context, thread });
    switch (continuation.status) {
        case 'none':
            return null;
        case 'actions':
            return createFastPathResult({ actions: continuation.actions, context, prompt, projectRevision });
        case 'revert':
            return {
                actions: [],
                rawText: prompt,
                requiresConfirmation: false,
                planningOutcome: {
                    kind: 'revert',
                    runId: continuation.runId,
                    revertGroupId: continuation.revertGroupId,
                },
            };
        case 'clarify':
            return {
                actions: [],
                rawText: prompt,
                requiresConfirmation: false,
                planningOutcome: { kind: 'clarify', reason: continuation.reason, questions: continuation.questions },
            };
        case 'denied':
            return {
                actions: [],
                rawText: prompt,
                requiresConfirmation: false,
                planningOutcome: { kind: 'denied', reason: continuation.reason },
            };
        default: {
            const exhaustive: never = continuation;
            throw new Error(`Unsupported last-commit continuation: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/**
 * Prompt parsing order:
 * 1. Non-executable recognition for explicitly denied action intents
 * 2. Fast-path: unique exact label or declared command alias in the preset registry
 * 3. Parameterized fast-path: regex for commands that need values (tempo N, transpose N)
 * 4. Compound fast-path: multi-track creation etc.
 * 5. Provider-neutral LLM tool path: tool calls cross a strict app-owned action bridge
 */
const planPromptIntent = inject({ logger })(
    ({ logger }) =>
        async function planPromptIntent({
            prompt,
            context,
            preset,
            signal,
            projectRevision,
            stemImportScope,
            onProviderResult,
            streamIdentity,
            onProviderAttempt,
            correction,
            providerPlanning = 'enabled',
            onMeasurementAttempt,
            thread,
            profile,
        }: ParsePromptToActionsInput): Promise<IntentResult> {
            const readonly = profile === 'readonly-answer';
            const normalized = prompt.toLowerCase().trim();
            const trimmedPrompt = prompt.trim();

            if (preset !== undefined) {
                const currentContext = buildPresetContext(context);
                const expected = preset?.expectedContext;
                const selected = PRESET_ACTIONS.find((candidate) => candidate.id === preset?.id);
                const selectionExists =
                    (currentContext.selectedTrackId === undefined ||
                        context.tracks.some((track) => track.id === currentContext.selectedTrackId)) &&
                    (currentContext.selectedClipId === undefined ||
                        context.tracks.some((track) =>
                            track.clips.some((clip) => clip.id === currentContext.selectedClipId)
                        ));
                if (
                    readonly ||
                    signal?.aborted ||
                    !selected ||
                    prompt !== selected.label ||
                    !expected ||
                    !selectionExists ||
                    expected.selectedTrackId !== currentContext.selectedTrackId ||
                    expected.selectedTrackKind !== currentContext.selectedTrackKind ||
                    expected.selectedClipId !== currentContext.selectedClipId ||
                    expected.selectedClipType !== currentContext.selectedClipType ||
                    expected.trackCount !== currentContext.trackCount ||
                    !getAvailablePresets(currentContext).includes(selected)
                ) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason:
                            'The selected preset no longer matches the complete request and current selection.',
                    };
                }
                const resolved = resolveRawPresetActions({ presetId: selected.id, context: currentContext });
                if (resolved === null) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: 'The selected preset is unavailable in the current project.',
                    };
                }
                const result = createFastPathResult({ actions: resolved.actions, context, prompt, projectRevision });
                return {
                    ...result,
                    requiresConfirmation: result.requiresConfirmation || selected.isDestructive === true,
                };
            }

            if (!readonly) {
                const deniedActionType = findDeniedPromptIntent(normalized);
                if (deniedActionType !== null) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: `Action ${deniedActionType} cannot be executed by AI because it does not report completion.`,
                    };
                }

                // A chat request that continues, re-targets or undoes the thread's last commit compiles from
                // the committed batch, never from a provider re-deriving its values.
                if (thread !== undefined) {
                    const continuation = createLastCommitContinuationResult(prompt, context, thread, projectRevision);
                    if (continuation !== null) {
                        return continuation;
                    }
                }

                // 2. Try complete executable preset commands via unique exact match
                const presetCtx = buildPresetContext(context);
                const presetResult = tryPresetMatch(normalized, presetCtx);
                if (presetResult.length > 0) {
                    return createFastPathResult({ actions: presetResult, context, prompt, projectRevision });
                }

                // 3. Try parameterized patterns (need value extraction)
                const paramResult = tryParameterizedPath(trimmedPrompt, context);
                if (paramResult.length > 0) {
                    return createFastPathResult({ actions: paramResult, context, prompt, projectRevision });
                }

                // 4. Try compound fast path (multi-track creation etc.)
                const compoundResult = tryCompoundFastPath(trimmedPrompt, context);
                if (compoundResult !== null) {
                    return createFastPathResult({ actions: compoundResult, context, prompt, projectRevision });
                }
            }

            if (signal?.aborted) {
                return { actions: [], rawText: prompt, requiresConfirmation: false };
            }

            if (providerPlanning === 'disabled') {
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    planningOutcome: {
                        kind: 'denied',
                        reason: 'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.',
                    },
                };
            }

            let applicationToolReceiptFields: { applicationToolReceipts?: IntentResult['applicationToolReceipts'] } =
                {};
            try {
                const drumRoutingScope = readonly ? null : getDrumRoutingPromptScope(context, projectRevision);
                const drumRenderComparisonScope = readonly
                    ? null
                    : getDrumRenderComparisonPromptScope(context, projectRevision);
                const drumPreviewBranchesScope = readonly
                    ? null
                    : getDrumPreviewBranchesPromptScope(context, projectRevision);
                const midiOverlapTransformScope = readonly
                    ? null
                    : getMidiOverlapTransformPromptScope(context, projectRevision);
                const backingVocalPlateScope = readonly
                    ? null
                    : getBackingVocalPlatePromptScope(context, projectRevision);
                const bassProcessingCopyScope = readonly
                    ? null
                    : getBassProcessingCopyPromptScope(context, projectRevision);
                const articulationTransferScope = readonly
                    ? null
                    : getArticulationTransferPromptScope(context, projectRevision);
                const articulationTransferCapability =
                    articulationTransferScope?.status === 'request' ? articulationTransferScope.capability : undefined;
                const drumRoutingCapability =
                    drumRoutingScope?.status === 'request' ? drumRoutingScope.capability : undefined;
                const drumRenderComparisonCapability =
                    drumRenderComparisonScope?.status === 'request' ? drumRenderComparisonScope.capability : undefined;
                const drumPreviewBranchesCapability =
                    drumPreviewBranchesScope?.status === 'request' ? drumPreviewBranchesScope.capability : undefined;
                const midiOverlapTransformCapability =
                    midiOverlapTransformScope?.status === 'request' ? midiOverlapTransformScope.capability : undefined;
                const backingVocalPlateCapability =
                    backingVocalPlateScope?.status === 'request' ? backingVocalPlateScope.capability : undefined;
                const bassProcessingCopyCapability =
                    bassProcessingCopyScope?.status === 'request' ? bassProcessingCopyScope.capability : undefined;
                const sidechainRoutingScope = readonly
                    ? null
                    : getSidechainRoutingPromptScope(prompt, context, projectRevision);
                const sidechainRoutingCapability =
                    sidechainRoutingScope?.status === 'request' ? sidechainRoutingScope.capability : undefined;
                const sharedVocalFxBusesScope = readonly
                    ? null
                    : getSharedVocalFxBusesPromptScope(context, projectRevision);
                const sharedVocalFxBusesCapability =
                    sharedVocalFxBusesScope?.status === 'request' ? sharedVocalFxBusesScope.capability : undefined;
                const syncopatedArpeggioScope = readonly
                    ? null
                    : getSyncopatedArpeggioPromptScope(context, projectRevision);
                const syncopatedArpeggioCapability =
                    syncopatedArpeggioScope?.status === 'request' ? syncopatedArpeggioScope.capability : undefined;
                const wholeProjectVibeMixScope = readonly
                    ? null
                    : getWholeProjectVibeMixScope(context, projectRevision);
                const wholeProjectVibeMixCapability = wholeProjectVibeMixScope?.capability;
                const workflowMetricScopes = prepareWorkflowMetricScopes({
                    sidechain: sidechainRoutingScope,
                    wholeProject: wholeProjectVibeMixScope,
                });
                const creativeCatalog = readonly
                    ? undefined
                    : prepareCreativeInterpretationCatalog({
                          prompt,
                          context,
                          projectRevision: projectRevision ?? '',
                      });
                const answerCatalog = prepareAnswerInterpretationCatalog({
                    prompt,
                    context,
                    projectRevision: projectRevision ?? '',
                });
                const providerToolSchemas = [
                    ...(readonly ? [createAnswerInterpretationToolSchema(answerCatalog)] : []),
                    ...(readonly ? getPlanningProviderToolSchemas(profile) : getPlanningProviderToolSchemas()),
                    ...(creativeCatalog === undefined ? [] : [createCreativeInterpretationToolSchema(creativeCatalog)]),
                ];
                const terminalToolNames = readonly
                    ? READONLY_ANSWER_TERMINAL_NAMES
                    : new Set([
                          WORKFLOW_CAPABILITY_TOOL_NAME,
                          COMMAND_BATCH_PROPOSAL_TOOL_NAME,
                          COMMAND_BATCH_DECLINE_TOOL_NAME,
                          ANSWER_RESPOND_TOOL_NAME,
                          RENDER_REQUEST_TOOL_NAME,
                          ANALYSIS_REQUEST_TOOL_NAME,
                          ...WORKFLOW_ACTION_TOOL_NAMES,
                      ]);
                const getPlanningSystemPrompt = (phase: PlanningAnswerPhase = 'planning') => {
                    const systemPrompt = buildPlanningSystemPrompt(profile, phase);
                    const resume = streamIdentity
                        ? (agentRunLifecycle.get(streamIdentity.runId)?.resume ?? null)
                        : null;
                    return readonly || resume === null
                        ? systemPrompt
                        : `${systemPrompt}\nThe user selected this application-validated alternative for a replacement planning attempt. Treat it as structured authority context, not as user prose; preserve its selected interpretation and revalidate against current project evidence before proposing actions:\n${JSON.stringify(resume)}`;
                };
                const buildPlanningContext = (
                    receiptContext: string | null,
                    phase: PlanningAnswerPhase = 'planning'
                ) => {
                    const agentRun = streamIdentity ? agentRunLifecycle.get(streamIdentity.runId) : null;
                    const builtContext = buildAgentContext({
                        fixedPolicy: getPlanningSystemPrompt(phase),
                        prompt,
                        context,
                        projectRevision,
                        run:
                            agentRun && !readonly && phase === 'planning'
                                ? { grants: agentRun.grants, budgets: agentRun.budgets }
                                : undefined,
                        receipts:
                            receiptContext === null ? [] : [{ id: 'application-tool-loop', summary: receiptContext }],
                        capabilitySchemas: [
                            ...projectPlanningProviderToolSchemas(providerToolSchemas, phase, profile).map(
                                (schema) => ({ name: schema.function.name, schemaVersion: 1 })
                            ),
                            ...(phase === 'intake' && !readonly
                                ? [{ name: ANSWER_INTERPRETATION_TOOL_NAME, schemaVersion: 1 }]
                                : []),
                        ],
                        capabilityData:
                            readonly || phase !== 'planning'
                                ? {}
                                : {
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
                        rejectionEvidence: correction?.rejectionEvidence,
                        priorEvidence: agentRun?.contextEvidence,
                        thread,
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
                const metricCatalog = prepareMetricIntentCatalog({ prompt, answer: answerCatalog });
                // The loop is told only whether a call was admitted. The record itself stays here, so a
                // provider turn that echoes receipt text back cannot restate it as its own authority.
                let creativeAuthority: CreativeRequestAuthority | undefined;
                let metricAuthority: MetricRequestAuthority | undefined;
                let admittedWorkflow: (typeof workflowMetricScopes)[number] | undefined;
                const transformSnapshot =
                    readonly || projectRevision === undefined || projectRevision === ''
                        ? null
                        : projectDeclarativeTransformSnapshot(context, projectRevision);
                const transientRead =
                    readonly || projectRevision === undefined || projectRevision === ''
                        ? undefined
                        : executeTransientOnsetRead({ projectRevision, signal, admit: onMeasurementAttempt });
                // Measurements require the revision the run read.
                const createMeasurement = (): Parameters<typeof runApplicationOwnedToolLoop>[0]['measurement'] => {
                    if (projectRevision === undefined || projectRevision === '') {
                        return undefined;
                    }
                    if (readonly) {
                        return {
                            toolName: ANALYSIS_MEASURE_TOOL_NAME,
                            revision: projectRevision,
                            execute: (call, { callId, turn, signal: loopSignal }) =>
                                executeAnalysisMeasure({
                                    call,
                                    callId,
                                    turn,
                                    projectRevision,
                                    sections: context.sections ?? [],
                                    signal: loopSignal,
                                    admit: onMeasurementAttempt,
                                }),
                        };
                    }
                    return {
                        toolName: ANALYSIS_MEASURE_TOOL_NAME,
                        // The reference comparison renders the project the same way, so it
                        // spends the same one measurement per turn.
                        companionToolNames: [ANALYSIS_COMPARE_REFERENCE_TOOL_NAME],
                        revision: projectRevision,
                        execute: (call, { callId, turn, signal: loopSignal, retainedCompilations }) => {
                            if (call.arguments.subject === 'preview' && metricAuthority === undefined) {
                                return Promise.resolve({
                                    commands: null,
                                    measuredPreview: null,
                                    receipt: {
                                        schema: 'sourdaw.application-tool-receipt' as const,
                                        schemaVersion: 1 as const,
                                        callId,
                                        toolName: call.name,
                                        turn,
                                        status: 'failure' as const,
                                        revision: projectRevision,
                                        data: null,
                                        warnings: [],
                                        summary: 'Positive whole-request metric intent is required before a preview.',
                                        error: {
                                            code: 'metric-intent-required',
                                            safeMessage:
                                                'Positive whole-request metric intent is required before a preview.',
                                            retryable: true,
                                        },
                                    },
                                });
                            }
                            let measurementCall = call;
                            const range = call.arguments.range;
                            if (
                                isRecord(range) &&
                                typeof range.startBeat === 'number' &&
                                typeof range.endBeat === 'number'
                            ) {
                                const namedRanges =
                                    metricAuthority?.goals.flatMap((goal) =>
                                        goal.range !== null &&
                                        goal.range.sectionId !== null &&
                                        goal.range.startBeat === range.startBeat &&
                                        goal.range.endBeat === range.endBeat
                                            ? [goal.range]
                                            : []
                                    ) ?? [];
                                const identities = [...new Set(namedRanges.map((entry) => entry.sectionId))];
                                const frozen = namedRanges[0];
                                if (
                                    identities.length === 1 &&
                                    frozen !== undefined &&
                                    context.sections?.some(
                                        (section) =>
                                            section.id === frozen.sectionId &&
                                            section.startBeat === frozen.startBeat &&
                                            section.endBeat === frozen.endBeat
                                    )
                                ) {
                                    measurementCall = {
                                        ...call,
                                        arguments: { ...call.arguments, range: { sectionId: frozen.sectionId } },
                                    };
                                }
                            }
                            if (call.name === ANALYSIS_COMPARE_REFERENCE_TOOL_NAME) {
                                return executeReferenceMeasurement({
                                    call: measurementCall,
                                    callId,
                                    turn,
                                    projectRevision,
                                    sections: context.sections ?? [],
                                    signal: loopSignal,
                                    admit: onMeasurementAttempt,
                                });
                            }
                            return executeAnalysisMeasure({
                                call: measurementCall,
                                callId,
                                turn,
                                projectRevision,
                                sections: context.sections ?? [],
                                signal: loopSignal,
                                admit: onMeasurementAttempt,
                                preview: {
                                    context,
                                    retainedCompilations,
                                    prompt,
                                    runId: streamIdentity?.runId ?? 'preview-measurement',
                                    readCreativeAuthority: () => creativeAuthority,
                                },
                            });
                        },
                    };
                };
                const planningOutcome = await runApplicationOwnedToolLoop({
                    ...(readonly ? {} : { requireWholeRequestIntake: true as const }),
                    transientOnsetRead: transientRead,
                    textReceiptCharacterBudget: AGENT_CONTEXT_RECEIPT_EVIDENCE_MAX_CHARACTERS,
                    loopId: `planning-${crypto.randomUUID()}`,
                    limits: {
                        maxCallsPerTurn: MAX_LLM_ACTIONS_PER_BATCH + 2,
                        maxTotalCalls: MAX_LLM_ACTIONS_PER_BATCH + 16,
                    },
                    terminalToolNames,
                    signal,
                    declineAdmission:
                        creativeCatalog === undefined
                            ? undefined
                            : (decline) =>
                                  admitPerceptualGoalDecline({
                                      decline,
                                      prompt,
                                      context,
                                      unresolvedExplicitReferences: creativeCatalog.unresolvedExplicitReferences,
                                  }),
                    transform:
                        transformSnapshot === null
                            ? undefined
                            : {
                                  toolName: TRANSFORM_COMPILE_TOOL_NAME,
                                  revision: transformSnapshot.revision,
                                  execute: (call, { callId, turn }) =>
                                      executeTransformCompile({
                                          call,
                                          callId,
                                          turn,
                                          snapshot: transformSnapshot,
                                      }),
                              },
                    // An expansion reads the same captured project and revision the transform
                    // compiler does, so what it expands is what the proposal is grounded against.
                    recipe:
                        transformSnapshot === null
                            ? undefined
                            : {
                                  toolName: RECIPE_EXPANSION_TOOL_NAME,
                                  revision: transformSnapshot.revision,
                                  execute: (call, { callId, turn, ordinal }) =>
                                      executeRecipeExpansion({
                                          call,
                                          callId,
                                          turn,
                                          ordinal,
                                          context,
                                          revision: transformSnapshot.revision,
                                      }),
                              },
                    interpretation:
                        creativeCatalog === undefined
                            ? undefined
                            : {
                                  toolName: CREATIVE_INTERPRETATION_TOOL_NAME,
                                  workflowToolName: WORKFLOW_CAPABILITY_TOOL_NAME,
                                  admit: (call, identity) => {
                                      if (call.name === WORKFLOW_CAPABILITY_TOOL_NAME) {
                                          const admission = admitWorkflowMetricIntake({
                                              call,
                                              turn: identity.turn,
                                              catalog: metricCatalog,
                                              scopes: workflowMetricScopes,
                                          });
                                          if (admission.status !== 'admitted') {
                                              return admission;
                                          }
                                          metricAuthority = admission.authority;
                                          admittedWorkflow = admission.scope;
                                          return {
                                              status: 'admitted',
                                              providerProjection: {
                                                  kind: 'metric-intent',
                                                  catalogId: metricCatalog.catalogId,
                                              },
                                              receipt: {
                                                  data: {
                                                      kind: 'metric-intent',
                                                      origin: 'admitted-workflow',
                                                      capabilityId: admission.scope.capabilityId,
                                                      catalogId: metricCatalog.catalogId,
                                                      intentKind: admission.authority.kind,
                                                      goals: admission.authority.goals,
                                                  },
                                                  summary:
                                                      'Finite workflow intent admitted; acoustic approval requires actual compatible proof.',
                                              },
                                          };
                                      }
                                      const admission = admitPlanningInterpretation({
                                          creative: creativeCatalog,
                                          answer: answerCatalog,
                                          metric: metricCatalog,
                                          turn: identity.turn,
                                          call,
                                          projectRevision: projectRevision ?? '',
                                      });
                                      if (admission.status !== 'admitted') {
                                          return admission;
                                      }
                                      if ('metricAuthority' in admission) {
                                          metricAuthority = admission.metricAuthority;
                                      }
                                      if (admission.kind === 'literal') {
                                          return {
                                              status: 'admitted',
                                              providerProjection: {
                                                  kind: 'metric-intent',
                                                  catalogId: metricCatalog.catalogId,
                                              },
                                              receipt: {
                                                  data: {
                                                      kind: 'metric-intent',
                                                      catalogId: metricCatalog.catalogId,
                                                      intentKind: 'literal',
                                                      goals: [],
                                                  },
                                                  summary:
                                                      'Whole-request literal intent admitted without creative mutation authority.',
                                              },
                                          };
                                      }
                                      if (admission.kind !== 'creative') {
                                          return {
                                              status: 'rejected',
                                              reason: 'Answer authority cannot become creative authority.',
                                          };
                                      }
                                      creativeAuthority = admission.authority;
                                      return {
                                          status: 'admitted',
                                          providerProjection:
                                              metricAuthority === undefined
                                                  ? undefined
                                                  : { kind: 'metric-intent', catalogId: metricCatalog.catalogId },
                                          receipt: {
                                              data: {
                                                  kind: 'metric-intent',
                                                  catalogId: metricCatalog.catalogId,
                                                  intentKind: metricAuthority?.kind ?? 'unverified',
                                                  goals: metricAuthority?.goals ?? [],
                                                  authorityId: admission.authority.authorityId,
                                                  mode: admission.authority.mode,
                                                  targets: admission.authority.targets,
                                                  editDimensions: admission.authority.editDimensions,
                                                  prohibitions: admission.authority.prohibitions,
                                                  creationSlots: admission.authority.creationSlots,
                                              },
                                              summary:
                                                  'Creative interpretation admitted; acoustic goals require actual compatible preview proof before approval.',
                                          },
                                      };
                                  },
                              },
                    answerInterpretation: {
                        jointToolName: readonly ? undefined : CREATIVE_INTERPRETATION_TOOL_NAME,
                        admit: (call) => {
                            if (call.name === CREATIVE_INTERPRETATION_TOOL_NAME && creativeCatalog !== undefined) {
                                const admission = admitPlanningInterpretation({
                                    creative: creativeCatalog,
                                    answer: answerCatalog,
                                    metric: metricCatalog,
                                    call,
                                    projectRevision: projectRevision ?? '',
                                });
                                return admission.status !== 'admitted' || admission.kind === 'answer'
                                    ? admission
                                    : {
                                          status: 'rejected',
                                          reason: 'Creative authority cannot become answer authority.',
                                      };
                            }
                            return admitAnswerInterpretation({
                                catalog: answerCatalog,
                                call,
                                projectRevision: projectRevision ?? '',
                            });
                        },
                    },
                    measurement: createMeasurement(),
                    requestTurn: async ({
                        receiptContext,
                        directive,
                        history,
                        budgetNote,
                        transientOnsetsDiscovered,
                        answerOnly,
                        answerIntakeOnly,
                        wholeRequestIntake,
                    }) => {
                        let phase: PlanningAnswerPhase = 'planning';
                        if (answerOnly) {
                            phase = 'answer';
                        } else if (answerIntakeOnly) {
                            phase = 'intake';
                        }
                        const planningContext =
                            receiptContext === null
                                ? initialPlanningContext
                                : buildPlanningContext(receiptContext, phase);
                        const turnSchemas = projectWorkflowMetricToolSchemas({
                            schemas: providerToolSchemas,
                            phase: wholeRequestIntake,
                            catalog: metricCatalog,
                            scopes: workflowMetricScopes,
                        });
                        const phaseSchemas = projectPlanningProviderToolSchemas(
                            [
                                ...turnSchemas.filter(
                                    (schema) => schema.function.name !== CREATIVE_INTERPRETATION_TOOL_NAME
                                ),
                                ...(phase === 'intake' && !readonly
                                    ? [createAnswerInterpretationToolSchema(answerCatalog)]
                                    : []),
                                ...(creativeCatalog === undefined
                                    ? []
                                    : [
                                          createPlanningInterpretationToolSchema({
                                              creative: creativeCatalog,
                                              answer: answerCatalog,
                                              binding: planningContext.planningBinding,
                                              metric: metricCatalog,
                                          }),
                                      ]),
                            ],
                            phase,
                            profile,
                            wholeRequestIntake
                        );
                        if (!planningContext.authorityComplete) {
                            throw new Error('Provider planning cannot continue with incomplete relevant authority.');
                        }
                        const turn = await generateToolPlanningOutcome(
                            getPlanningSystemPrompt(phase),
                            planningContext.message,
                            phaseSchemas,
                            signal,
                            prompt,
                            onProviderResult,
                            streamIdentity,
                            onProviderAttempt,
                            directive,
                            // A hosted turn repeats the run's first message unchanged and carries the
                            // receipts as its own earlier turns; only a local backend reads the text
                            // form above, which restates them inside the prompt.
                            {
                                ...(readonly ? { maxOutputTokens: READONLY_ANSWER_MAX_OUTPUT_TOKENS } : {}),
                                firstUserMessage: initialPlanningContext.message,
                                history,
                                budgetNote,
                                transientOnsetsDiscovered,
                                localReceiptContextComplete:
                                    receiptContext === null ||
                                    receiptContext.length <= AGENT_CONTEXT_RECEIPT_EVIDENCE_MAX_CHARACTERS,
                                // Measured deltas in the thread context are figures, which the
                                // hosted request declares as the evidence category it admits.
                                ...(initialPlanningContext.hostedThreadCarriesMeasurement
                                    ? { messageDataCategories: REMOTE_EVIDENCE_AGENT_DATA_CATEGORIES }
                                    : {}),
                            },
                            planningContext.localMessage
                        );
                        // Admit the complete turn before the loop can dispatch even its first safe read.
                        if (turn.status === 'complete' && (readonly || phase !== 'planning')) {
                            if (
                                turn.toolCalls.length === 0 ||
                                (turn.proposal !== undefined && turn.proposal !== null) ||
                                turn.toolCalls.some((call) => {
                                    const schema = phaseSchemas.find((tool) => tool.function.name === call.name);
                                    return (
                                        schema === undefined ||
                                        !matchesJsonSchema(call.arguments, schema.function.parameters)
                                    );
                                })
                            ) {
                                return {
                                    status: 'rejected',
                                    reason: readonly
                                        ? 'Explain refused a tool turn outside its read-only profile.'
                                        : 'Planning refused a tool turn outside its active phase.',
                                };
                            }
                        }
                        return turn;
                    },
                }).finally(() => transientRead?.dispose());
                // Admission can stage a record before its genuine receipt is bounded. A failed
                // control never enters the authority carried by a refusal or a correction.
                const successfulIntakeReceipts = planningOutcome.receipts.filter(
                    (receipt) =>
                        receipt.status === 'success' &&
                        (receipt.toolName === CREATIVE_INTERPRETATION_TOOL_NAME ||
                            (receipt.toolName === WORKFLOW_CAPABILITY_TOOL_NAME &&
                                isRecord(receipt.data) &&
                                receipt.data.origin === 'admitted-workflow' &&
                                receipt.data.capabilityId === admittedWorkflow?.capabilityId))
                );
                if (metricAuthority !== undefined) {
                    const staged = metricAuthority;
                    if (
                        !successfulIntakeReceipts.some(
                            (receipt) => receipt.callId === staged.callId && receipt.turn === staged.turn
                        )
                    ) {
                        metricAuthority = undefined;
                        admittedWorkflow = undefined;
                    }
                }
                if (creativeAuthority !== undefined) {
                    const staged = creativeAuthority;
                    if (
                        !successfulIntakeReceipts.some(
                            (receipt) => isRecord(receipt.data) && receipt.data.authorityId === staged.authorityId
                        )
                    ) {
                        creativeAuthority = undefined;
                    }
                }
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

                // What the run was admitted to mean travels with every outcome below, so a refusal
                // states the same authority the proposal it replaced would have carried.
                let creativeAuthorityFields = creativeAuthority === undefined ? {} : { creativeAuthority };

                if (correction !== undefined) {
                    const reused = reconcileCorrectionCreativeAuthority(
                        correction.creativeAuthority,
                        creativeAuthority
                    );
                    // The disputed record is the reason this run refused, so no outcome carries it.
                    if (reused.status === 'rejected') {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            rejectionReason: reused.reason,
                        };
                    }
                    creativeAuthority = reused.creativeAuthority;
                    creativeAuthorityFields = creativeAuthority === undefined ? {} : { creativeAuthority };
                }
                // Reconciliation decides which record this run is operating under, so a loop refusal
                // reported before it would name a freshly minted authority the run never adopted.
                if (planningOutcome.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        rejectionReason: `Provider planning rejected: ${planningOutcome.reason}`,
                    };
                }
                if (planningOutcome.decline) {
                    const outcome = classifyProviderDecline(
                        planningOutcome.decline,
                        planningOutcome.receipts,
                        planningOutcome.searchedIntents
                    );
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        ...(outcome.kind === 'denied' ? { rejectionReason: outcome.reason } : {}),
                        planningOutcome: outcome,
                    };
                }
                // The loop admitted the answer only as the sole call of its turn, with every cited
                // receipt resolved, so it reaches the caller as a reply with no batch beside it.
                if (planningOutcome.answer) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        planningOutcome: { kind: 'answer', ...planningOutcome.answer },
                    };
                }
                if (readonly) {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        rejectionReason: 'Explain requires an admitted answer or decline.',
                    };
                }
                const providerProposal =
                    planningOutcome.proposal ?? extractAgentPlanProposal(planningOutcome.toolCalls);
                const proposedBatch = planningOutcome.toolCalls.find(
                    (call) => call.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME
                );
                const refinement = admitProposalRefinement(proposedBatch?.arguments.refines, thread);
                if (refinement.status === 'refused') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        rejectionReason: `Provider action rejected: ${refinement.reason}`,
                        rejectionEvidence: {
                            kind: 'constraint',
                            argumentPath: 'refines',
                            reason: refinement.reason,
                            rejectedFragment: boundedProviderFragment(proposedBatch?.arguments.refines),
                        },
                    };
                }
                // A refinement replaces the pending card, so it is always put to the user, whatever the
                // risk policy would let a fresh batch of the same commands do on its own.
                const refinementFields =
                    refinement.status === 'refines'
                        ? { refines: refinement.confirmationId, requiresConfirmation: true }
                        : {};
                // The basis is read from the stored card, never from thread_context, which a provider
                // budget may have cut; a card no longer proposed is refused where the replacement persists.
                const refinedCard =
                    refinement.status === 'refines' ? getPendingActionConfirmation(refinement.confirmationId) : null;
                const refinedBasis =
                    refinedCard?.status === 'proposed' ? refinedCard.approvalSnapshot.groundingBasis : undefined;
                const refinedProtections =
                    refinedCard?.status === 'proposed' ? refinedCard.approvalSnapshot.protectionFacts : undefined;
                const selectedIds = proposedBatch?.arguments.compiledCallIds;
                const selectedCompilations = Array.isArray(selectedIds)
                    ? selectedIds.flatMap((callId) =>
                          planningOutcome.retainedCompilations.filter((compiled) => compiled.callId === callId)
                      )
                    : [];
                const adoptedRecipes = selectedCompilations.flatMap((compiled) =>
                    compiled.kind === 'recipe' ? [compiled.recipe] : []
                );
                const measuredPreview = readAdoptedMeasuredPreview(selectedCompilations);
                const inheritedMetricState = metricGoalStateCodec(refinedCard?.approvalSnapshot.metricGoalState);
                const authorities = [...(inheritedMetricState?.authorities ?? [])];
                const admittedMetricAuthority = metricAuthority;
                if (
                    admittedMetricAuthority !== undefined &&
                    !authorities.some((authority) => authority.authorityId === admittedMetricAuthority.authorityId)
                ) {
                    authorities.push(admittedMetricAuthority);
                }
                const metricProofs = collectMetricGoalProof({
                    authorities,
                    compilations: planningOutcome.retainedCompilations,
                    receipts: planningOutcome.receipts,
                });
                const serializeMetricGoalState = (
                    actions: IntentResult['actions'],
                    steps: MetricGoalState['steps'][number][] = [],
                    nativeLiteralUses: readonly MetricNativeLiteralUse[] = []
                ): string =>
                    serializePromptMetricState({
                        actions,
                        steps,
                        authorities,
                        metricProofs,
                        inheritedMetricState,
                        nativeLiteralUses,
                    });

                // The adopted compilations and the refined proposal are both read above, so the
                // compiler sees only the commands the batch states.
                const ordinaryProposalCalls = planningOutcome.toolCalls.map((call) => {
                    if (call !== proposedBatch) {
                        return call;
                    }
                    const argumentsWithoutReferences = Object.fromEntries(
                        Object.entries(call.arguments).filter(([key]) => key !== 'compiledCallIds' && key !== 'refines')
                    );
                    return { ...call, arguments: argumentsWithoutReferences };
                });
                const compiledList = compileArbitraryCommandList({
                    calls: ordinaryProposalCalls,
                    context,
                    revision: projectRevision ?? '',
                    ...creativeAuthorityFields,
                });
                if (compiledList.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        rejectionReason: `Provider action rejected: ${compiledList.reason}`,
                        rejectionEvidence: {
                            kind: compiledList.detail?.kind ?? 'schema',
                            reason: compiledList.reason,
                            ...(compiledList.detail
                                ? {
                                      itemId: compiledList.detail.itemId,
                                      candidateIds: compiledList.detail.candidateIds,
                                      resolution: {
                                          resolvedCount: compiledList.detail.resolvedCount,
                                          expectedCount: compiledList.detail.expectedCount,
                                      },
                                  }
                                : {}),
                            rejectedFragment: boundedProviderFragment(planningOutcome.toolCalls),
                        },
                    };
                }
                const scheduled = scheduleCompiledBatches({ compiledList, selectedCompilations, providerProposal });
                if (scheduled.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        rejectionReason: `Provider action rejected: ${scheduled.reason}`,
                    };
                }
                const { firstBatch, batchSchedule } = scheduled;
                const transformCommands = materializeTransformToolCalls(selectedCompilations);
                const transformTargetIds = getCompiledTransformTargetIds(transformCommands, context);
                const combinedProposalCalls = firstBatch.calls.map((call) => {
                    if (call.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME || transformCommands.length === 0) {
                        return call;
                    }
                    const commands: unknown = call.arguments.commands;
                    if (!isUnknownArray(commands)) {
                        return call;
                    }
                    return { ...call, arguments: { ...call.arguments, commands: [...transformCommands, ...commands] } };
                });
                const expandedProposal = expandCatalogProposals(combinedProposalCalls);
                if (expandedProposal.status === 'invalid') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        rejectionReason: `Provider action rejected: ${expandedProposal.reason}`,
                        rejectionEvidence: {
                            kind: 'schema',
                            reason: expandedProposal.reason,
                            rejectedFragment: boundedProviderFragment(providerProposal),
                        },
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
                        ...creativeAuthorityFields,
                        rejectionReason: 'Provider selected more than one specialized workflow.',
                    };
                }
                let workflowCapabilityId: WorkflowCapabilityId | undefined = admittedWorkflow?.capabilityId;
                const workflowSelectionCall = workflowSelectionCalls[0];
                if (workflowSelectionCall) {
                    if (admittedWorkflow !== undefined) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            rejectionReason: 'An admitted workflow cannot be selected again or replaced.',
                        };
                    }
                    if (providerToolCalls[0] !== workflowSelectionCall) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            ...creativeAuthorityFields,
                            rejectionReason:
                                'Provider must select a specialized workflow before proposing its actions.',
                        };
                    }
                    const keys = Object.keys(workflowSelectionCall.arguments);
                    const capabilityId = workflowSelectionCall.arguments.capabilityId;
                    if (
                        keys.length !== 1 ||
                        keys[0] !== 'capabilityId' ||
                        !isWorkflowCapabilityId(capabilityId) ||
                        WORKFLOW_METRIC_CAPABILITY_IDS.some((id) => id === capabilityId)
                    ) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            ...creativeAuthorityFields,
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
                            ...creativeAuthorityFields,
                            rejectionReason: 'Stem files must be selected before the provider can plan their import.',
                        };
                    }
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
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
                            ...creativeAuthorityFields,
                            rejectionReason: `Provider action rejected: importStemSet: ${stemImport.reason}`,
                        };
                    }
                    if (validateActions([stemImport.providerAction]).length !== 1) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            ...creativeAuthorityFields,
                            rejectionReason: 'Provider action failed runtime validation: importStemSet',
                        };
                    }
                    if (!doesProductionBriefAllowActionBatch([stemImport.action])) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            ...applicationToolReceiptFields,
                            ...creativeAuthorityFields,
                            rejectionReason: 'Provider action conflicts with locked production intent.',
                        };
                    }
                    if (refinement.status === 'refines') {
                        const pending = getPendingActionConfirmation(refinement.confirmationId);
                        const preservation = validateRefinedProposalActions({
                            pendingActions: pending?.status === 'proposed' ? pending.approvalSnapshot.actions : null,
                            actions: [stemImport.action],
                            prompt,
                            context,
                            createdObject: proposalCommandShape.createdObject,
                            readRemoval: readStoredCardRemoval,
                            ...(refinedProtections === undefined
                                ? {}
                                : {
                                      protection: {
                                          facts: refinedProtections,
                                          readTouchedObjectIds: (
                                              type: string,
                                              payload: Readonly<Record<string, unknown>>
                                          ) => proposalCommandShape.touchedObjectIds(type, payload, context),
                                          readControlOwnerIds: (
                                              type: string,
                                              payload: Readonly<Record<string, unknown>>
                                          ) => proposalCommandShape.controlOwnerIds(type, payload, context),
                                          readControlOperations: (
                                              type: string,
                                              payload: Readonly<Record<string, unknown>>,
                                              trackId: string
                                          ) => proposalCommandShape.controlOperations(type, payload, context, trackId),
                                      },
                                  }),
                        });
                        if (preservation.status === 'refused') {
                            return {
                                actions: [],
                                rawText: prompt,
                                requiresConfirmation: false,
                                ...applicationToolReceiptFields,
                                rejectionReason: `Provider action rejected: ${preservation.reason}`,
                            };
                        }
                    }
                    return {
                        metricGoalState: serializeMetricGoalState([stemImport.action]),
                        actions: [stemImport.action],
                        rawText: prompt,
                        requiresConfirmation: true,
                        ...refinementFields,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        executionMode: 'atomic',
                        workflowCapabilityId,
                        ...(providerProposal === null ? {} : { providerProposal }),
                    };
                }
                const grounded = groundCompiledCommandBatch({
                    toolCalls,
                    context,
                    prompt,
                    projectRevision,
                    workflowCapabilityId,
                    compilerEvidence: firstBatch.compilerEvidence,
                    selectedCompilations,
                    transformCommands,
                    transformTargetIds,
                    creativeAuthority,
                    providerProposal,
                    ...(refinedBasis === undefined ? {} : { refinementBasis: refinedBasis }),
                    ...(refinedProtections === undefined ? {} : { refinementProtections: refinedProtections }),
                });
                if (grounded.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        rejectionReason: grounded.rejectionReason,
                        ...(grounded.rejectionEvidence === undefined
                            ? {}
                            : { rejectionEvidence: grounded.rejectionEvidence }),
                    };
                }
                if (grounded.status === 'clarify') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        ...applicationToolReceiptFields,
                        ...creativeAuthorityFields,
                        planningOutcome: grounded.planningOutcome,
                    };
                }
                if (grounded.status === 'grounded') {
                    if (batchSchedule !== undefined && compiledList.compilerEvidence !== undefined) {
                        const changed = proposalProtection.findChange(
                            compiledList.compilerEvidence.commands.map((command) => ({
                                type: command.name,
                                payload: command.arguments,
                            })),
                            grounded.protectionFacts,
                            context
                        );
                        if (changed !== null) {
                            return {
                                actions: [],
                                rawText: prompt,
                                requiresConfirmation: false,
                                ...applicationToolReceiptFields,
                                rejectionReason: `Provider action rejected: scheduled request changes protected ${changed.name} (${changed.id}).`,
                            };
                        }
                    }
                    let scheduledProtections: IntentResult['batchSchedule'];
                    if (batchSchedule !== undefined) {
                        scheduledProtections = {
                            ...batchSchedule,
                            requestProtections: {
                                request: prompt,
                                facts: structuredClone(grounded.protectionFacts),
                                resolvedTrackClauses: readExplicitProtections(prompt, context).resolvedTrackClauses,
                            },
                        };
                    }
                    // Grounding against the card's basis already held every pending command to an
                    // explicit removal; only a card without one is checked against its stored batch.
                    if (refinement.status === 'refines' && grounded.refinement === undefined) {
                        const pending = getPendingActionConfirmation(refinement.confirmationId);
                        const preservation = validateRefinedProposalActions({
                            pendingActions: pending?.status === 'proposed' ? pending.approvalSnapshot.actions : null,
                            actions: grounded.actions,
                            prompt,
                            context,
                            createdObject: proposalCommandShape.createdObject,
                            readRemoval: readStoredCardRemoval,
                            protection: {
                                facts: grounded.protectionFacts,
                                readTouchedObjectIds: (type, payload) =>
                                    proposalCommandShape.touchedObjectIds(type, payload, context),
                                readControlOwnerIds: (type, payload) =>
                                    proposalCommandShape.controlOwnerIds(type, payload, context),
                                readControlOperations: (type, payload, trackId) =>
                                    proposalCommandShape.controlOperations(type, payload, context, trackId),
                            },
                        });
                        if (preservation.status === 'refused') {
                            return {
                                actions: [],
                                rawText: prompt,
                                requiresConfirmation: false,
                                ...applicationToolReceiptFields,
                                rejectionReason: `Provider action rejected: ${preservation.reason}`,
                            };
                        }
                    }
                    const steps: MetricGoalState['steps'][number][] = [];
                    // Frozen recipe obligations survive a terminal that adopts a complete semantic-list preview.
                    const usedRecipes = planningOutcome.retainedCompilations.filter(
                        (entry): entry is Extract<RetainedCompilation, { kind: 'recipe' }> => entry.kind === 'recipe'
                    );
                    const cumulativeRecipes: Extract<RetainedCompilation, { kind: 'recipe' }>[] = [];
                    for (const compilation of usedRecipes) {
                        const stepId = `recipe:${compilation.recipe.recipeId}:${compilation.recipe.targetId}`;
                        if (
                            compilation.metricRecipe === undefined ||
                            !authorities.some((authority) =>
                                authority.goals.some(
                                    (goal) =>
                                        goal.stepId === stepId &&
                                        goal.source.kind === 'recipe' &&
                                        goal.source.recipeDigest === compilation.metricRecipe?.recipeDigest
                                )
                            )
                        ) {
                            continue;
                        }
                        if (steps.some((step) => step.stepId === stepId)) {
                            continue;
                        }
                        cumulativeRecipes.push(compilation);
                        const prefix = compilePreviewMeasurementProposal({
                            callId: compilation.callId,
                            source: { retained: [...cumulativeRecipes] },
                            context,
                            prompt,
                            revision: projectRevision ?? '',
                            runId: streamIdentity?.runId ?? 'prompt-preview',
                            creativeAuthority,
                        });
                        if (prefix.status !== 'compiled') {
                            continue;
                        }
                        steps.push({
                            stepId,
                            commandCount: compilation.commands.length,
                            operationTypes: compilation.commands.map((command) => command.operation),
                            recipePrefixHash: digestCommandBatchContent(prefix.envelope),
                        });
                    }
                    return {
                        metricGoalState: serializeMetricGoalState(
                            grounded.actions,
                            steps,
                            freezeWorkflowNativeLiteralUses({
                                uses: grounded.nativeLiteralUses,
                                actions: grounded.actions,
                                authority: admittedMetricAuthority,
                                request: prompt,
                            })
                        ),
                        actions: grounded.actions,
                        ...(grounded.actionCommandGraph === undefined
                            ? {}
                            : { actionCommandGraph: grounded.actionCommandGraph }),
                        rawText: prompt,
                        requiresConfirmation: grounded.requiresConfirmation,
                        ...refinementFields,
                        ...applicationToolReceiptFields,
                        executionMode: 'atomic',
                        workflowCapabilityId,
                        ...(grounded.providerKnownTargetIds === undefined
                            ? {}
                            : { providerKnownTargetIds: grounded.providerKnownTargetIds }),
                        ...(grounded.matchSelectorPredicates.length === 0
                            ? {}
                            : { matchSelectorPredicates: grounded.matchSelectorPredicates }),
                        ...(adoptedRecipes.length === 0 ? {} : { adoptedRecipes }),
                        ...(measuredPreview === null ? {} : { measuredPreview }),
                        ...(grounded.providerProposal === null ? {} : { providerProposal: grounded.providerProposal }),
                        ...creativeAuthorityFields,
                        ...(scheduledProtections === undefined ? {} : { batchSchedule: scheduledProtections }),
                        ...(grounded.groundingBasis === undefined || scheduledProtections !== undefined
                            ? {}
                            : { groundingBasis: grounded.groundingBasis }),
                        protectionFacts: grounded.protectionFacts,
                        ...(grounded.refinement === undefined
                            ? {}
                            : {
                                  refinementProtectedUnchanged: grounded.refinement.protectedUnchanged,
                                  keptDirectionActionIndexes: grounded.refinement.keptDirectionActionIndexes,
                              }),
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
                        ...creativeAuthorityFields,
                        rejectionReason: reason,
                    };
                }

                // An empty provider plan is a no-op; there is no alternate mutation path.
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    ...applicationToolReceiptFields,
                    ...creativeAuthorityFields,
                };
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
        }
);

/**
 * The planner's public entry point. It classifies every result, so a caller never has to infer from
 * an empty action list whether the run refused, asked a question, or simply matched nothing.
 */
export async function parsePromptToActions(input: ParsePromptToActionsInput): Promise<PlannedIntentResult> {
    const result = await planPromptIntent(input);
    return { ...result, planningOutcome: classifyPlannedIntentResult(result) };
}

function serializePromptMetricState(input: {
    actions: IntentResult['actions'];
    steps: MetricGoalState['steps'][number][];
    authorities: MetricRequestAuthority[];
    metricProofs: MetricGoalState['proofs'];
    inheritedMetricState: MetricGoalState | null;
    nativeLiteralUses: readonly MetricNativeLiteralUse[];
}): string {
    const { actions, steps, authorities } = input;
    if (
        steps.length === 0 &&
        actions.length > 0 &&
        authorities.some((authority) => authority.goals.some((goal) => goal.stepId === 'overall'))
    ) {
        steps.push({
            stepId: 'overall',
            commandCount: actions.length,
            operationTypes: actions.map((action) => action.type),
            recipePrefixHash: null,
        });
    }
    const metricGoalState: MetricGoalState = {
        schemaVersion: 1,
        authorities,
        steps,
        proofs: input.metricProofs,
        nativeLiteralUses: [...(input.inheritedMetricState?.nativeLiteralUses ?? []), ...input.nativeLiteralUses],
        binding: null,
    };
    return JSON.stringify(metricGoalState);
}
