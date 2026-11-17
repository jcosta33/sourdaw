import { type ToolCallResult } from '../transformers/toolCallParser';

const workflowCommands = {
    'articulation-transfer': 'copyMidiArticulations',
    'midi-overlap-shortening': 'removeShortMidiOverlaps',
    'syncopated-arpeggio': 'arpeggiate',
    'drum-preview-branches': 'createDrumPreviewBranches',
} as const;

export type OfferedMusicalWorkflow = keyof typeof workflowCommands;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The bridge validates exact arguments and scope after this narrow admission. */
export function isOfferedMusicalWorkflow(
    calls: readonly ToolCallResult[],
    offered: readonly OfferedMusicalWorkflow[]
): boolean {
    if (
        calls.length !== 2 ||
        calls[0]?.name !== 'selectWorkflowCapability' ||
        calls[1]?.name !== 'command.batch.propose'
    ) {
        return false;
    }
    const selection = calls[0].arguments;
    const capability = selection.capabilityId;
    if (
        Object.keys(selection).length !== 1 ||
        typeof capability !== 'string' ||
        !offered.some((id) => id === capability)
    ) {
        return false;
    }
    const proposal = calls[1].arguments;
    if (
        proposal.list !== undefined ||
        proposal.compiledCallIds !== undefined ||
        !Array.isArray(proposal.commands) ||
        proposal.commands.length === 0
    ) {
        return false;
    }
    const commandName = workflowCommands[capability as OfferedMusicalWorkflow];
    return proposal.commands.every((command: unknown) => isRecord(command) && command.name === commandName);
}
