import { type ToolSchema } from '../models/ToolDefinitions';
import {
    isWorkflowCapabilityId,
    type LocalWorkflowGrounding,
    type WorkflowCapabilityId,
    WORKFLOW_CAPABILITY_TOOL_NAME,
} from '../models/WorkflowCapability';

/**
 * The one workflow selectable with no capability data: selecting it is what asks the user for the
 * stem files its capability is then prepared from.
 */
const STEM_IMPORT_KICKOFF_CAPABILITY_ID: WorkflowCapabilityId = 'stem-import-starting-mix';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Which workflows a local turn may select, and whether it needs the workflow action tools. A
 * workflow is groundable only when the local message kept its capability data, the stem import
 * kickoff aside, or when the run already admitted it. The action tools carry a workflow's plan, so
 * they are offered only when a workflow with capability data or an admitted one could be planned;
 * the stem import kickoff alone plans no action.
 */
export function readLocalWorkflowOffer(grounding: LocalWorkflowGrounding | undefined): {
    selectableCapabilityIds: ReadonlySet<WorkflowCapabilityId>;
    offersWorkflowActions: boolean;
} {
    const kept = grounding?.keptCapabilityIds ?? [];
    const admitted = grounding?.admittedCapabilityId;
    const selectableCapabilityIds = new Set<WorkflowCapabilityId>([...kept, STEM_IMPORT_KICKOFF_CAPABILITY_ID]);
    if (admitted !== undefined) {
        selectableCapabilityIds.add(admitted);
    }
    return { selectableCapabilityIds, offersWorkflowActions: kept.length > 0 || admitted !== undefined };
}

/**
 * The workflow selector as a local turn offers it: its `capabilityId` choices narrowed to the
 * groundable workflows, each choice kept word for word. A selector with no choice left is not
 * offered; one without choices (a consumed intake entry) is offered as it is.
 */
export function narrowWebLlmWorkflowSelector(
    tool: ToolSchema,
    selectableCapabilityIds: ReadonlySet<WorkflowCapabilityId>
): ToolSchema | null {
    if (tool.function.name !== WORKFLOW_CAPABILITY_TOOL_NAME) {
        return tool;
    }
    const { properties } = tool.function.parameters;
    const capabilityId = properties.capabilityId;
    if (!isRecord(capabilityId) || !Array.isArray(capabilityId.oneOf)) {
        return tool;
    }
    const choices = capabilityId.oneOf.filter(
        (choice) =>
            isRecord(choice) && isWorkflowCapabilityId(choice.const) && selectableCapabilityIds.has(choice.const)
    );
    if (choices.length === 0) {
        return null;
    }
    return {
        ...tool,
        function: {
            ...tool.function,
            parameters: {
                ...tool.function.parameters,
                properties: { ...properties, capabilityId: { ...capabilityId, oneOf: choices } },
            },
        },
    };
}
