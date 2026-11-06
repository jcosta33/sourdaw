import { type CreativeSelectionSnapshot } from './CreativeInterpretation';
import { type ProjectContext } from './ProjectContext';
import { type ToolSchema } from './ToolDefinitions';

export const ANSWER_INTERPRETATION_TOOL_NAME = 'selectAnswerInterpretation';
export const ANSWER_KINDS = ['measured-audio', 'project-facts', 'catalog-knowledge', 'source-onsets'] as const;
export const ANSWER_TOPICS = ['level', 'tone', 'dynamics', 'stereo', 'timing'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];
export type AnswerTopic = (typeof ANSWER_TOPICS)[number];
export type AnswerScopeCandidate = {
    candidateId: string;
    kind: 'master' | 'tracks' | 'buses' | 'clips';
    objectIds: string[];
    labels: string[];
};
export type AnswerRangeCandidate = {
    candidateId: string;
    label: string;
    startBeat: number;
    endBeat: number;
    sectionId: string | null;
};
export type AnswerInterpretationCatalog = {
    schemaVersion: 1;
    catalogId: string;
    requestDigest: string;
    revision: string;
    selection: CreativeSelectionSnapshot;
    scopes: AnswerScopeCandidate[];
    ranges: AnswerRangeCandidate[];
    /** Complete captured context, held only by the application. */
    context: ProjectContext;
};
export type AnswerRequestAuthority<MetricId extends string> = Readonly<{
    schemaVersion: 1;
    catalogId: string;
    requestDigest: string;
    revision: string;
    selection: CreativeSelectionSnapshot;
    kind: AnswerKind;
    topics: readonly AnswerTopic[];
    scopes: readonly AnswerScopeCandidate[];
    scopeCandidateIds: readonly string[];
    range: AnswerRangeCandidate | null;
    requiredMetrics: readonly MetricId[];
    context: ProjectContext;
}>;

export function createAnswerInterpretationToolSchema(catalog: AnswerInterpretationCatalog): ToolSchema {
    return {
        type: 'function',
        function: {
            name: ANSWER_INTERPRETATION_TOOL_NAME,
            description: `Interpret an information request, alone and once; this freezes read-only scope. Select measured-audio for acoustic questions, project-facts for metadata, catalog-knowledge for recipes, source-onsets for available source-buffer reads. Uncertainty clarifies. Candidate rows: scopes [id,kind,objectIds,labels], ranges [id,label,startBeat,endBeat]. Candidates: ${JSON.stringify(
                {
                    scopes: catalog.scopes.map((scope) => [
                        scope.candidateId,
                        scope.kind,
                        scope.objectIds,
                        scope.labels,
                    ]),
                    ranges: catalog.ranges.map((range) => [
                        range.candidateId,
                        range.label,
                        range.startBeat,
                        range.endBeat,
                    ]),
                }
            )}`,
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    catalogId: { const: catalog.catalogId },
                    kind: { enum: [...ANSWER_KINDS] },
                    topicIds: {
                        type: 'array',
                        uniqueItems: true,
                        maxItems: ANSWER_TOPICS.length,
                        items: { enum: [...ANSWER_TOPICS] },
                    },
                    scopeCandidateIds: {
                        type: 'array',
                        maxItems: 32,
                        uniqueItems: true,
                        items: { enum: catalog.scopes.map((scope) => scope.candidateId) },
                    },
                    rangeCandidateId: { enum: [null, ...catalog.ranges.map((range) => range.candidateId)] },
                    uncertainty: { enum: ['none', 'meaning', 'target', 'range'] },
                },
                required: ['catalogId', 'kind', 'topicIds', 'scopeCandidateIds', 'rangeCandidateId', 'uncertainty'],
            },
        },
    };
}
