import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type WorkflowCapabilityId } from '../../../models/WorkflowCapability';
import { getArticulationTransferPromptScope } from '../getArticulationTransferPromptScope';
import { getDrumRoutingPromptScope } from '../getDrumRoutingPromptScope';
import { getSidechainRoutingPromptScope } from '../getSidechainRoutingPromptScope';

import {
    createGroundingAdmissionStrategyRegistry,
    type GroundingAdmissionStrategyDefinition,
} from './createGroundingAdmissionStrategyRegistry';
import { type ActionPromptScope } from './promptScope';

export const workflowShortcutScopeActionNames = [
    'setTrackOutput',
    'copyMidiArticulations',
    'addSidechainRoute',
] as const;

export type WorkflowShortcutScopeActionName = (typeof workflowShortcutScopeActionNames)[number];

export type WorkflowShortcutScopeInput = {
    actionName: string;
    context: ProjectContext;
    prompt: string;
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[];
    sameActionCallCount: number;
    workflowCapabilityId?: WorkflowCapabilityId;
};

/** `null` leaves the caller's remaining scope resolution untouched. */
export type WorkflowShortcutScopeResult = ActionPromptScope | null;

export type WorkflowShortcutScopeStrategyDefinition<Name extends WorkflowShortcutScopeActionName> =
    GroundingAdmissionStrategyDefinition<
        Name,
        Omit<WorkflowShortcutScopeInput, 'actionName'>,
        WorkflowShortcutScopeResult
    >;

const workflowShortcutScopeLabel = 'workflow shortcut scope';

export const workflowShortcutScopeStrategyDefinitions = [
    {
        name: 'setTrackOutput',
        transform: ({ context, prompt, sameActionAssertedArguments, sameActionCallCount, workflowCapabilityId }) => {
            if (workflowCapabilityId === 'drum-routing') {
                const drumRoutingScope = getDrumRoutingPromptScope(context);
                if (
                    drumRoutingScope.status === 'request' &&
                    sameActionCallCount === drumRoutingScope.targetIds.length &&
                    sameActionAssertedArguments.every(
                        (arguments_) =>
                            typeof arguments_.trackId === 'string' &&
                            drumRoutingScope.targetIds.includes(arguments_.trackId) &&
                            arguments_.outputId === drumRoutingScope.busId
                    )
                ) {
                    return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'route' };
                }
            }
            return null;
        },
    },
    {
        name: 'copyMidiArticulations',
        transform: ({ context, prompt, sameActionAssertedArguments, sameActionCallCount, workflowCapabilityId }) => {
            if (workflowCapabilityId === 'articulation-transfer') {
                const articulationScope = getArticulationTransferPromptScope(context);
                if (
                    articulationScope.status === 'request' &&
                    sameActionCallCount === articulationScope.clipPairs.length &&
                    sameActionAssertedArguments.every((arguments_) =>
                        articulationScope.clipPairs.some(
                            (pair) =>
                                pair.sourceClipId === arguments_.sourceClipId &&
                                pair.targetClipId === arguments_.targetClipId
                        )
                    )
                ) {
                    return {
                        text: prompt,
                        masked: prompt,
                        directional: false,
                        matchedIntentPhrase: 'copy articulation',
                    };
                }
            }
            return null;
        },
    },
    {
        name: 'addSidechainRoute',
        transform: ({ context, prompt, sameActionAssertedArguments, sameActionCallCount }) => {
            const sidechainRoutingScope = getSidechainRoutingPromptScope(prompt, context);
            if (
                sidechainRoutingScope.status === 'request' &&
                sameActionCallCount === sidechainRoutingScope.routes.length &&
                sameActionAssertedArguments.every((arguments_) =>
                    sidechainRoutingScope.routes.some(
                        (route) =>
                            route.sourceTrackId === arguments_.sourceTrackId &&
                            route.targetTrackId === arguments_.targetTrackId &&
                            route.targetDeviceId === arguments_.targetDeviceId
                    )
                )
            ) {
                return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'create sidechain' };
            }
            return null;
        },
    },
] satisfies readonly WorkflowShortcutScopeStrategyDefinition<WorkflowShortcutScopeActionName>[];

const workflowShortcutScopeStrategyRegistry = createGroundingAdmissionStrategyRegistry<
    WorkflowShortcutScopeActionName,
    Omit<WorkflowShortcutScopeInput, 'actionName'>,
    WorkflowShortcutScopeResult
>(
    workflowShortcutScopeLabel,
    workflowShortcutScopeStrategyDefinitions,
    getExecutableAppActionGroundingCatalog(),
    workflowShortcutScopeActionNames
);

function isWorkflowShortcutScopeActionName(actionName: string): actionName is WorkflowShortcutScopeActionName {
    return workflowShortcutScopeActionNames.some((expectedActionName) => expectedActionName === actionName);
}

export function resolveWorkflowShortcutScope(input: WorkflowShortcutScopeInput): WorkflowShortcutScopeResult {
    if (!isWorkflowShortcutScopeActionName(input.actionName)) {
        return null;
    }
    const strategy = workflowShortcutScopeStrategyRegistry.get(input.actionName);
    if (!strategy) {
        throw new Error(`Missing ${workflowShortcutScopeLabel} strategy: ${input.actionName}`);
    }
    return strategy({
        context: input.context,
        prompt: input.prompt,
        sameActionAssertedArguments: input.sameActionAssertedArguments,
        sameActionCallCount: input.sameActionCallCount,
        workflowCapabilityId: input.workflowCapabilityId,
    });
}
