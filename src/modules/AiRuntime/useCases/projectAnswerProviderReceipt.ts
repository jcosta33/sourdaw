import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

import { type AnswerRequestAuthority } from './answerContractTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Called only after the genuine receipt passed its byte/status admission; never metric authority. */
export function projectAnswerProviderReceipt(
    receipt: ApplicationToolReceipt,
    authority: Pick<AnswerRequestAuthority, 'kind' | 'catalogId'> | { kind: 'metric-intent'; catalogId: string }
): ApplicationToolReceipt {
    if (receipt.status !== 'success' || !isRecord(receipt.data)) {
        return receipt;
    }
    const data = receipt.data;
    if (data.kind === authority.kind && data.catalogId === authority.catalogId && isRecord(data.range)) {
        const { sectionId: _sectionId, ...range } = data.range;
        return { ...receipt, data: { ...data, range } };
    }
    if (data.kind === 'metric-intent' && data.catalogId === authority.catalogId && Array.isArray(data.goals)) {
        return {
            ...receipt,
            data: {
                ...data,
                goals: data.goals.map((goal: unknown) => {
                    if (!isRecord(goal)) {
                        return goal;
                    }
                    let range: unknown = goal.range;
                    if (isRecord(range)) {
                        const { sectionId: _sectionId, ...beats } = range;
                        range = beats;
                    }
                    let source: unknown = null;
                    if (isRecord(goal.source)) {
                        if (goal.source.kind === 'recipe') {
                            source = { kind: 'recipe', recipeId: goal.source.recipeId };
                        }
                        if (goal.source.kind === 'policy') {
                            source = { kind: 'policy', policyId: goal.source.policyId };
                        }
                        if (goal.source.kind === 'request-number') {
                            source = { kind: 'request-number', token: goal.source.token };
                        }
                        if (goal.source.kind === 'unsupported') {
                            source = { kind: 'unsupported' };
                        }
                    }
                    return {
                        metricId: goal.metricId,
                        band: goal.band,
                        targetIds: goal.targetIds,
                        referenceTargetIds: goal.referenceTargetIds,
                        range,
                        relation: goal.relation,
                        targetValue: goal.targetValue,
                        tolerance: goal.tolerance,
                        source,
                    };
                }),
            },
        };
    }
    if (
        authority.kind === 'metric-intent' &&
        data.schema === 'sourdaw.recipe-expansion' &&
        isRecord(data.metricExpectations)
    ) {
        const {
            catalogVersion: _catalogVersion,
            recipeDigest: _recipeDigest,
            ...expectations
        } = data.metricExpectations;
        return { ...receipt, data: { ...data, metricExpectations: expectations } };
    }
    if (data.kind === 'analysis-measurement' && isRecord(data.range)) {
        const { sectionId: _sectionId, ...range } = data.range;
        return { ...receipt, data: { ...data, range } };
    }
    if (data.schema === 'sourdaw.semantic-project-query' && data.queryType === 'section' && Array.isArray(data.items)) {
        return {
            ...receipt,
            data: {
                ...data,
                items: data.items.map((item: unknown) => {
                    if (!isRecord(item)) {
                        return item;
                    }
                    const { id: _id, ...section } = item;
                    return section;
                }),
            },
        };
    }
    return receipt;
}
