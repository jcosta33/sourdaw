import { type ToolSchema } from './ToolDefinitions';

export const WORKFLOW_METRIC_CAPABILITY_IDS = ['sidechain-routing', 'whole-project-vibe-mix'] as const;

export const WORKFLOW_CAPABILITY_IDS = [
    ...WORKFLOW_METRIC_CAPABILITY_IDS,
    'drum-routing',
    'drum-render-comparison',
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

export const WORKFLOW_CAPABILITY_ACTION_TOOL_NAMES = [
    'setTrackOutput',
    'removeDevice',
    'createBus',
    'addDevice',
    'addSend',
    'automateSendRanges',
    'renderProjectSections',
    'copyMidiArticulations',
    'addAdjustmentRegion',
    'removeShortMidiOverlaps',
    'createDrumPreviewBranches',
    'arpeggiate',
    'setTrackGain',
    'importStemSet',
    'addSidechainRoute',
    'removeSidechainRoute',
] as const;

/**
 * Every tool a selected workflow's action plan may call: the capability-bound
 * action tools plus the generic track and device actions any workflow plan can
 * need. Planning and inference must filter by this one set so the provider
 * schema list and the executable tool list cannot drift apart.
 */
export const WORKFLOW_ACTION_TOOL_NAMES: ReadonlySet<string> = new Set([
    ...WORKFLOW_CAPABILITY_ACTION_TOOL_NAMES,
    'automateTrackGainRange',
    'automateSendRange',
    'muteTrack',
    'setTrackPan',
    'removeTrack',
    'soloTrack',
    'setDeviceParameter',
]);

const workflowCapabilityDescriptions: Readonly<Record<WorkflowCapabilityId, string>> = {
    'sidechain-routing': 'Connect the exact application-published Kick to eligible Bass compressor sidechain inputs.',
    'whole-project-vibe-mix':
        'Preview the existing bounded section gain trajectory while preserving its protected objects.',
    'drum-routing': 'Route the complete semantic drum set to its existing drum bus while preserving its return.',
    'drum-render-comparison':
        'Build the bounded drum and parallel-compression routing graph, preserve the room route, apply the fixed gain change, and render the comparison sections.',
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
    availableCapabilityIds: readonly WorkflowCapabilityId[],
    intake?: { catalogId: unknown; metricIntent: unknown }
): ToolSchema {
    const schema: ToolSchema = {
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
                        oneOf: availableCapabilityIds
                            .filter(
                                (capabilityId) =>
                                    intake !== undefined ||
                                    !WORKFLOW_METRIC_CAPABILITY_IDS.some((id) => id === capabilityId)
                            )
                            .map((capabilityId) => ({
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
    if (intake !== undefined) {
        schema.function.parameters.properties.catalogId = intake.catalogId;
        schema.function.parameters.properties.metricIntent = intake.metricIntent;
        schema.function.parameters.required.push('catalogId', 'metricIntent');
        schema.function.description +=
            ' For initial whole-request intake, call alone with the published metric intent before any proposal. After generic intake, select execution with capabilityId alone; never replace its frozen intent.';
    }
    return schema;
}
