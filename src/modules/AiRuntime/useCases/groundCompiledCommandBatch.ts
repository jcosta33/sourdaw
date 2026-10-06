import { logger } from '#/infra/logger/appLogger';
import { requiresAppActionConfirmation } from '#/modules/Command/useCases';
import { doesProductionBriefAllowActionBatch } from '#/modules/Project/useCases';

import { type AgentRunProviderProposal } from '../models/AgentRun';
import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type IntentResult } from '../models/IntentResult';
import { type PlanningOutcome } from '../models/PlanningOutcome';
import { type PlanningRejectionEvidence } from '../models/PlanningRejectionEvidence';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { type SemanticCommandListMatchSelectorRecord } from '../models/SemanticCommandList';
import { type WorkflowCapabilityId } from '../models/WorkflowCapability';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { bridgeGroundedLlmToolCalls } from './agentReference/bridgeGroundedLlmToolCalls';
import { composeVerifiedProviderProposalScope } from './agentReference/composeVerifiedProviderProposalScope';
import { materializeBatchLocalActionIdentities } from './agentReference/materializeBatchLocalActionIdentities';
import { type ArbitraryCommandListEvidence } from './compileArbitraryCommandList';
import { deriveMatchSelectorPredicates } from './deriveMatchSelectorPredicates';
import { type ProjectContext } from './getProjectContext';
import { materializeActionStateGuards } from './materializeActionStateGuards';
import { readPlanningMarkerSignatures } from './readPlanningMarkerSignatures';
import { validateActions } from './validateActions';

type GroundCompiledCommandBatchInput = {
    toolCalls: readonly ToolCallResult[];
    context: ProjectContext;
    prompt: string;
    projectRevision: string | undefined;
    workflowCapabilityId: WorkflowCapabilityId | undefined;
    compilerEvidence: ArbitraryCommandListEvidence | undefined;
    selectedCompilations: readonly RetainedCompilation[];
    transformCommands: readonly ToolCallResult[];
    transformTargetIds: readonly string[];
    creativeAuthority: CreativeRequestAuthority | undefined;
    providerProposal: AgentRunProviderProposal | null;
};

type GroundedFields = {
    actions: IntentResult['actions'];
    actionCommandGraph: IntentResult['actionCommandGraph'];
    requiresConfirmation: boolean;
    providerKnownTargetIds: string[] | undefined;
    matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[];
    providerProposal: AgentRunProviderProposal | null;
};

type GroundCompiledCommandBatchResult =
    | { status: 'rejected'; rejectionReason: string; rejectionEvidence?: PlanningRejectionEvidence }
    | { status: 'clarify'; planningOutcome: Extract<PlanningOutcome, { kind: 'clarify' }> }
    | { status: 'empty' }
    | ({ status: 'grounded' } & GroundedFields);

type Bridged = ReturnType<typeof bridgeGroundedLlmToolCalls>;
type Guarded = Extract<ReturnType<typeof materializeActionStateGuards>, { status: 'accepted' }>;

/**
 * The rejected fragment a correction attempt gets to see. Provider-authored content stays bounded
 * here; the context labels it untrusted where it is serialized.
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

/** What the adopted compilations were compiled against, which the bridge checks against this batch. */
function buildTransformProof(input: GroundCompiledCommandBatchInput) {
    if (input.selectedCompilations.length === 0) {
        return undefined;
    }
    return {
        revision: input.projectRevision ?? '',
        creativeAuthorityId: input.creativeAuthority?.authorityId ?? null,
        compilations: input.selectedCompilations,
    };
}

function bridgeCompiledCalls(
    input: GroundCompiledCommandBatchInput
): Bridged | Extract<GroundCompiledCommandBatchResult, { status: 'rejected' }> {
    const { markerSignatures, sectionSignatures } = readPlanningMarkerSignatures();
    const transformProof = buildTransformProof(input);
    const bridged = bridgeGroundedLlmToolCalls({
        calls: input.toolCalls,
        context: input.context,
        markerSignatures,
        sectionSignatures,
        prompt: input.prompt,
        compilerEvidence: input.compilerEvidence,
        transformProof,
        projectRevision: input.projectRevision,
        workflowCapabilityId: input.workflowCapabilityId,
        creativeAuthority: input.creativeAuthority,
    });
    for (const rejected of bridged.rejections) {
        logger.warn(`[AI] Rejected tool call ${String(rejected.index)} (${rejected.name}): ${rejected.reason}`);
    }

    if (bridged.rejections.length > 0) {
        const reason = bridged.rejections.map((rejection) => `${rejection.name}: ${rejection.reason}`).join('; ');
        // The correction gets one bounded, structured diagnostic for
        // the first failing item: which command, what the app
        // expects, and the provider's own rejected arguments.
        const firstRejection = bridged.rejections[0]!;
        const rejectedCall = input.toolCalls[firstRejection.index];
        const rejectionEvidence: PlanningRejectionEvidence = {
            kind: 'constraint',
            command: { index: firstRejection.index, name: firstRejection.name },
            reason: firstRejection.reason,
        };
        if (rejectedCall) {
            rejectionEvidence.rejectedFragment = boundedProviderFragment(rejectedCall.arguments);
        }
        return { status: 'rejected', rejectionReason: `Provider action rejected: ${reason}`, rejectionEvidence };
    }
    return bridged;
}

/** Runtime validation, batch-local identities, state guards and the production brief, in that order. */
function bindBridgedActions(
    bridged: Bridged,
    context: ProjectContext
): Guarded | Extract<GroundCompiledCommandBatchResult, { status: 'rejected' | 'clarify' }> {
    const validated = validateActions(bridged.actions, bridged.batchLocalActionIdentities);
    if (validated.length !== bridged.actions.length) {
        const rejectedTypes = bridged.actions
            .filter((action) => !validated.includes(action))
            .map((action) => action.type)
            .join(', ');
        logger.warn('[AI] Rejected LLM action batch because runtime validation removed an action');
        return { status: 'rejected', rejectionReason: `Provider action failed runtime validation: ${rejectedTypes}` };
    }

    const materialized = materializeBatchLocalActionIdentities(validated, bridged.batchLocalActionIdentities ?? []);
    if (materialized.status === 'rejected') {
        logger.warn(`[AI] Rejected LLM action batch because ${materialized.reason}`);
        return { status: 'rejected', rejectionReason: `Provider action identity rejected: ${materialized.reason}` };
    }

    const guarded = materializeActionStateGuards(materialized.actions, context, {
        appOwnedRenderTailSeconds: bridged.appOwnedRenderTailSeconds,
        bassProcessingCopyScope: bridged.bassProcessingCopyScope,
        midiOverlapTransformScope: bridged.midiOverlapTransformScope,
        drumPreviewBranchesScope: bridged.drumPreviewBranchesScope,
        syncopatedArpeggioScope: bridged.syncopatedArpeggioScope,
    });
    if (guarded.status === 'rejected' && guarded.questions !== undefined) {
        // Two sections answer the request equally: the request is
        // answerable, it only has to say which one it means.
        return {
            status: 'clarify',
            planningOutcome: { kind: 'clarify', reason: guarded.reason, questions: [...guarded.questions] },
        };
    }
    if (guarded.status === 'rejected') {
        logger.warn(`[AI] Rejected LLM action batch because ${guarded.reason}`);
        return { status: 'rejected', rejectionReason: `Provider action state binding rejected: ${guarded.reason}` };
    }
    if (!doesProductionBriefAllowActionBatch(guarded.actions)) {
        return { status: 'rejected', rejectionReason: 'Provider action conflicts with locked production intent.' };
    }
    return guarded;
}

function composeGroundedFields(
    input: GroundCompiledCommandBatchInput,
    bridged: Bridged,
    guarded: Guarded
): GroundedFields {
    const verifiedProviderProposalScope = composeVerifiedProviderProposalScope({
        actions: guarded.actions,
        compilerEvidence: input.compilerEvidence,
        appOwnedTargetIds: input.transformCommands.length === 0 ? undefined : input.transformTargetIds,
        context: input.context,
        prompt: input.prompt,
        workflowCapabilityId: input.workflowCapabilityId,
    });
    let effectiveProviderProposal = input.providerProposal;
    if (effectiveProviderProposal !== null && verifiedProviderProposalScope !== undefined) {
        effectiveProviderProposal = {
            ...effectiveProviderProposal,
            scope: verifiedProviderProposalScope,
        };
    }
    if (
        effectiveProviderProposal !== null &&
        bridged.actionCommandGraph !== undefined &&
        input.compilerEvidence === undefined
    ) {
        effectiveProviderProposal = {
            ...effectiveProviderProposal,
            scope: {
                ...effectiveProviderProposal.scope,
                targetIds: [
                    ...new Set([
                        ...effectiveProviderProposal.scope.targetIds,
                        ...(bridged.batchLocalActionIdentities ?? []).flatMap((identity) =>
                            identity.actionType === 'createBus' ? [identity.busId] : []
                        ),
                    ]),
                ],
            },
        };
    }

    const matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[] = deriveMatchSelectorPredicates(
        input.compilerEvidence,
        input.transformCommands.length
    );

    return {
        actions: guarded.actions,
        actionCommandGraph: bridged.actionCommandGraph,
        requiresConfirmation: requiresAppActionConfirmation(guarded.actions),
        providerKnownTargetIds: getProviderKnownTargetIds(input),
        matchSelectorPredicates,
        providerProposal: effectiveProviderProposal,
    };
}

/** The direct targets the compiled list and any adopted transform proved, or none without either. */
function getProviderKnownTargetIds(input: GroundCompiledCommandBatchInput): string[] | undefined {
    if (input.compilerEvidence === undefined && input.transformCommands.length === 0) {
        return undefined;
    }
    const compiledTargetIds = input.compilerEvidence?.providerKnownTargetIds ?? [];
    return [...new Set([...compiledTargetIds, ...input.transformTargetIds])];
}

/**
 * Grounds one compiled command batch against a project snapshot: the bridge, runtime validation,
 * batch-local identities, state guards, the production brief, and the application-verified scope.
 * The planner grounds a provider's first batch through it, and a run grounds each later batch of a
 * schedule through it again at the revision that batch is proposed against, so every batch crosses
 * the same gates whichever turn produced it.
 */
export function groundCompiledCommandBatch(input: GroundCompiledCommandBatchInput): GroundCompiledCommandBatchResult {
    const bridged = bridgeCompiledCalls(input);
    if ('status' in bridged) {
        return bridged;
    }
    if (bridged.actions.length === 0) {
        return { status: 'empty' };
    }
    const guarded = bindBridgedActions(bridged, input.context);
    if (guarded.status !== 'accepted') {
        return guarded;
    }
    return { status: 'grounded', ...composeGroundedFields(input, bridged, guarded) };
}
