import { executeAppAction } from '#/modules/Command/useCases';

import { type ProductionBriefScope, type ProductionDecisionStatus } from '../models/ProductionBrief';
import { projectStore } from '../stores/projectStore';

type AcceptCreativeIntentInput = {
    statement: string;
    scope?: ProductionBriefScope;
    rationale?: string | null;
    status?: Exclude<ProductionDecisionStatus, 'superseded'>;
    sourceRunId?: string | null;
    relatedBatchId?: string | null;
};

export async function acceptCreativeIntent(input: AcceptCreativeIntentInput): Promise<string | null> {
    const project = projectStore.value;
    const statement = input.statement.trim();
    if (!project || statement.length === 0) {
        return null;
    }

    const brief = project.productionBrief;
    const decisionId = `decision-${crypto.randomUUID()}`;
    const createdAt = Math.max(Date.now(), brief.updatedAt);
    const sourceRunId = input.sourceRunId ?? null;
    const sourceRunLinks = sourceRunId ? [...new Set([...brief.sourceRunLinks, sourceRunId])] : brief.sourceRunLinks;
    const nextBrief = {
        ...structuredClone(brief),
        revision: brief.revision + 1,
        decisions: [
            ...brief.decisions,
            {
                id: decisionId,
                scope: structuredClone(input.scope ?? { kind: 'project' as const }),
                statement,
                rationale: input.rationale ?? null,
                status: input.status ?? 'accepted',
                sourceRunId,
                relatedBatchId: input.relatedBatchId ?? null,
                supersededByDecisionId: null,
                createdAt,
            },
        ],
        sourceRunLinks,
        updatedAt: createdAt,
    };

    await executeAppAction({
        type: 'setProductionBrief',
        payload: { expectedRevision: brief.revision, brief: nextBrief },
    });
    return decisionId;
}
