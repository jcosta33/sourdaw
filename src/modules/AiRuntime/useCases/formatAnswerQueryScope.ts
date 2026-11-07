import { type querySemanticProject } from '#/modules/Project/useCases';

import { quoteSourceData } from '../services/answerSourceFormat';

type QueryInput = Parameters<typeof querySemanticProject>[0];
type QueryFilterKey = keyof NonNullable<QueryInput['filters']>;
const QUERY_FILTER_KEYS = {
    stableId: true,
    exactName: true,
    fuzzyName: true,
    kind: true,
    tag: true,
    role: true,
    parentId: true,
    startBeat: true,
    endBeat: true,
    sectionId: true,
    selected: true,
    locked: true,
    muted: true,
    soloed: true,
    deviceType: true,
    deviceCategory: true,
    routeFromId: true,
    routeToId: true,
    hasAutomation: true,
    contentType: true,
    assetType: true,
    minInferredConfidence: true,
} satisfies Record<QueryFilterKey, true>;

export function formatAnswerQueryScope(input: QueryInput): string | null {
    const filters = input.filters;
    const keys = Object.keys(QUERY_FILTER_KEYS) as QueryFilterKey[];
    const entries = keys.flatMap((key) => {
        const value = filters?.[key];
        if (value === undefined) {
            return [];
        }
        if (typeof value === 'string') {
            if (/[\r\n]/.test(value)) {
                return [null];
            }
            return [`${key}: ${quoteSourceData(value)}`];
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            return [null];
        }
        return [`${key}: ${String(value)}`];
    });
    if (entries.includes(null) || (input.type === 'project-summary' && entries.length > 0)) {
        return null;
    }
    const scope = entries.length > 0 ? [`filters (${entries.join(', ')})`] : [];
    if (input.type === 'diff') {
        if (input.sinceRevision === undefined || /[\r\n]/.test(input.sinceRevision)) {
            return null;
        }
        scope.push(`sinceRevision: ${quoteSourceData(input.sinceRevision)}`);
    }
    if (input.page?.limit !== undefined) {
        scope.push(`limit: ${String(input.page.limit)}`);
    }
    if (input.page?.cursor !== undefined) {
        if (/[\r\n]/.test(input.page.cursor)) {
            return null;
        }
        scope.push(`cursor: ${quoteSourceData(input.page.cursor)}`);
    }
    return scope.length > 0 ? ` with ${scope.join('; ')}` : '';
}
