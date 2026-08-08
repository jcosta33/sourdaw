import { afterEach, describe, expect, it } from 'vitest';

import { clearSemanticContext, getSemanticContext, sessionState, setSemanticContext } from '../semanticChangeContext';

describe('semanticChangeContext', () => {
    afterEach(() => {
        clearSemanticContext();
    });

    it('starts with null context', () => {
        expect(sessionState.currentContext).toBeNull();
        expect(getSemanticContext()).toBeNull();
    });

    it('setSemanticContext stores the context and getSemanticContext returns it', () => {
        const ctx = { message: 'added track', actionKind: 'track.add', entityRefs: ['track-1'] };
        setSemanticContext(ctx);

        expect(sessionState.currentContext).toBe(ctx);
        expect(getSemanticContext()).toEqual(ctx);
    });

    it('setSemanticContext replaces a previous context', () => {
        setSemanticContext({ message: 'first', actionKind: 'a', entityRefs: [] });
        setSemanticContext({ message: 'second', actionKind: 'b', entityRefs: ['x'] });

        expect(getSemanticContext()?.message).toBe('second');
        expect(getSemanticContext()?.actionKind).toBe('b');
        expect(getSemanticContext()?.entityRefs).toEqual(['x']);
    });

    it('clearSemanticContext resets to null', () => {
        setSemanticContext({ message: 'temp', actionKind: 'x', entityRefs: [] });
        clearSemanticContext();

        expect(getSemanticContext()).toBeNull();
        expect(sessionState.currentContext).toBeNull();
    });
});
