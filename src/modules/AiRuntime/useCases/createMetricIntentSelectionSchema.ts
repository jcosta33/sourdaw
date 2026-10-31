import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';

import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';

export function createMetricIntentSelectionSchema(metric?: MetricIntentCatalog) {
    const scopeCandidateIds = metric?.scopes.map((entry) => entry.candidateId) ?? [];
    const rangeCandidateIds = metric?.ranges.map((entry) => entry.candidateId) ?? [];
    return {
        anyOf: [
            { type: 'null' },
            {
                type: 'object',
                additionalProperties: false,
                properties: {
                    kind: { enum: ['literal', 'non-acoustic', 'perceptual', 'comparative'] },
                    uncertainty: { enum: ['none', 'meaning', 'target', 'range'] },
                    objectives: {
                        type: 'array',
                        maxItems: MAX_LLM_ACTIONS_PER_BATCH,
                        uniqueItems: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                objectiveId: { enum: metric?.objectives.map((entry) => entry.id) ?? [] },
                                scopeCandidateId: {
                                    enum: [null, ...scopeCandidateIds],
                                },
                                referenceScopeCandidateId: {
                                    enum: [null, ...scopeCandidateIds],
                                },
                                rangeCandidateId: {
                                    enum: [null, ...rangeCandidateIds],
                                },
                            },
                            required: [
                                'objectiveId',
                                'scopeCandidateId',
                                'referenceScopeCandidateId',
                                'rangeCandidateId',
                            ],
                        },
                    },
                },
                required: ['kind', 'objectives', 'uncertainty'],
            },
        ],
    };
}
