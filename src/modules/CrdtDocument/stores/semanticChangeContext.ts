/**
 * Thread-local context for semantic change metadata.
 *
 * When `executeAppAction` runs a handler, it sets the semantic context
 * (label, action kind, entity refs) before the handler mutates stores.
 * When `AutomergeStorage.#writeToCrdt` fires, it reads this context and
 * passes it as the Automerge change message.
 *
 * Lives in `stores/` (not `useCases/`) because it is shared mutable state,
 * not a business operation. Moving it here lets `Command/useCases` reach it
 * without routing through `CrdtDocument/useCases` — which would re-create the
 * `Command → CrdtDocument → Command` barrel cycle.
 */

type SemanticContext = {
    message: string;
    actionKind: string;
    entityRefs: string[];
};

export const sessionState: { currentContext: SemanticContext | null } = {
    currentContext: null,
};

export const setSemanticContext = (ctx: SemanticContext): void => {
    sessionState.currentContext = ctx;
};

export const getSemanticContext = (): SemanticContext | null => {
    return sessionState.currentContext;
};

export const clearSemanticContext = (): void => {
    sessionState.currentContext = null;
};
