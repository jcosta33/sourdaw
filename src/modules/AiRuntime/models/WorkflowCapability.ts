import { type ToolSchema } from './ToolDefinitions';

export const WORKFLOW_CAPABILITY_IDS = [
    'drum-routing',
    'backing-vocal-plate',
    'articulation-transfer',
    'bass-processing-copy',
    'midi-overlap-shortening',
    'drum-preview-branches',
    'syncopated-arpeggio',
    'shared-vocal-fx-buses',
    'stem-import-starting-mix',
] as const;

export type WorkflowCapabilityId = (typeof WORKFLOW_CAPABILITY_IDS)[number];

export const WORKFLOW_CAPABILITY_TOOL_NAME = 'selectWorkflowCapability';

const workflowCapabilityDescriptions: Readonly<Record<WorkflowCapabilityId, string>> = {
    'drum-routing': 'Route the complete semantic drum set to its existing drum bus while preserving its return.',
    'backing-vocal-plate':
        'Consolidate backing-vocal reverbs on one filtered plate bus with chorus automation and renders.',
    'articulation-transfer':
        'Copy MIDI articulation between matching chorus clips without copying other note properties.',
    'bass-processing-copy':
        'Copy bass processing between chorus sections while preserving target distortion automation.',
    'midi-overlap-shortening': 'Shorten only selected MIDI overlaps below the application-defined threshold.',
    'drum-preview-branches': 'Create isolated drum preview branches while preserving and varying the bounded roles.',
    'syncopated-arpeggio': 'Create the bounded syncopated arpeggio while preserving voicing and harmonic rhythm.',
    'shared-vocal-fx-buses': 'Move eligible inline vocal delay and reverb to shared buses while preserving balance.',
    'stem-import-starting-mix':
        'Import, tempo-align, classify, group, and establish a starting mix for selected stems.',
};

export function isWorkflowCapabilityId(value: unknown): value is WorkflowCapabilityId {
    return typeof value === 'string' && WORKFLOW_CAPABILITY_IDS.some((candidate) => candidate === value);
}

export function createWorkflowCapabilityToolSchema(
    availableCapabilityIds: readonly WorkflowCapabilityId[]
): ToolSchema {
    return {
        type: 'function',
        function: {
            name: WORKFLOW_CAPABILITY_TOOL_NAME,
            description:
                'Select one application-provided specialized workflow when it semantically covers the complete request. Call this before that workflow actions. Do not call it for generic, partial, unrelated, or ambiguous requests.',
            parameters: {
                type: 'object',
                properties: {
                    capabilityId: {
                        type: 'string',
                        oneOf: availableCapabilityIds.map((capabilityId) => ({
                            const: capabilityId,
                            description: workflowCapabilityDescriptions[capabilityId],
                        })),
                        description: 'The application-provided workflow capability to use.',
                    },
                },
                required: ['capabilityId'],
                additionalProperties: false,
            },
        },
    };
}
