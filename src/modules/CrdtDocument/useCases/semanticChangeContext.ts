/**
 * Thread-local context for semantic change metadata.
 *
 * When `executeAppAction` runs a handler, it sets the semantic context
 * (label, action kind, entity refs) before the handler mutates stores.
 * When `AutomergeStorage.#writeToCrdt` fires, it reads this context and
 * passes it as the Automerge change message.
 *
 * This avoids threading a `message` parameter through every store.set() call.
 */

type SemanticContext = {
    message: string;
    actionKind: string;
    entityRefs: string[];
};

let currentContext: SemanticContext | null = null;

export const setSemanticContext = (ctx: SemanticContext): void => {
    currentContext = ctx;
};

export const getSemanticContext = (): SemanticContext | null => {
    return currentContext;
};

export const clearSemanticContext = (): void => {
    currentContext = null;
};
