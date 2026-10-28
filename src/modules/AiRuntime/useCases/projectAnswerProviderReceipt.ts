import { type AnswerRequestAuthority } from '../models/AnswerInterpretation';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Called only after the genuine receipt passed its byte/status admission; never metric authority. */
export function projectAnswerProviderReceipt(
    receipt: ApplicationToolReceipt,
    authority: AnswerRequestAuthority
): ApplicationToolReceipt {
    if (receipt.status !== 'success' || !isRecord(receipt.data)) {
        return receipt;
    }
    const data = receipt.data;
    if (data.kind === authority.kind && data.catalogId === authority.catalogId && isRecord(data.range)) {
        const { sectionId: _sectionId, ...range } = data.range;
        return { ...receipt, data: { ...data, range } };
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
