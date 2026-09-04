import { type ProductionBrief, type ProductionBriefScope } from '../models/ProductionBrief';

export type ProtectedBriefScope = {
    id: string;
    scope: ProductionBriefScope;
    source: 'lock' | 'decision';
    statement: string;
};

/**
 * Every scope the brief currently protects, with the entry that protects it.
 *
 * Single source of truth for "what does this brief guard": the batch admission
 * guard and the banner that explains a refusal must never disagree about which
 * decisions count as protecting and which do not.
 */
export function collectProtectedScopes(brief: ProductionBrief): readonly ProtectedBriefScope[] {
    return [
        ...brief.locks.map((lock) => ({
            id: lock.id,
            scope: lock.scope,
            source: 'lock' as const,
            statement: lock.statement,
        })),
        ...brief.decisions
            .filter((decision) => decision.status === 'locked')
            .map((decision) => ({
                id: decision.id,
                scope: decision.scope,
                source: 'decision' as const,
                statement: decision.statement,
            })),
    ];
}
