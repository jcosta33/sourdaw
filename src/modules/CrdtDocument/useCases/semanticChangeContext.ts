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

export const sessionState: { currentContext: SemanticContext | null } = {
    currentContext: null,
};

export function setSemanticContext(ctx: SemanticContext): void {
    sessionState.currentContext = ctx;
}

export function getSemanticContext(): SemanticContext | null {
    return sessionState.currentContext;
}

export function clearSemanticContext(): void {
    sessionState.currentContext = null;
}
