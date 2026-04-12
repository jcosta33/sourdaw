import { beforeEach, describe, expect, it } from 'vitest';

import { clearSemanticContext, getSemanticContext, setSemanticContext } from '../semanticChangeContext';

describe('semanticChangeContext', () => {
    beforeEach(() => {
        clearSemanticContext();
    });

    it('returns null until context is set', () => {
        expect(getSemanticContext()).toBeNull();
    });

    it('round-trips the current semantic context', () => {
        const ctx = { message: 'm', actionKind: 'k', entityRefs: ['a'] };
        setSemanticContext(ctx);
        expect(getSemanticContext()).toBe(ctx);
    });

    it('clears the context', () => {
        setSemanticContext({ message: 'x', actionKind: 'y', entityRefs: [] });
        clearSemanticContext();
        expect(getSemanticContext()).toBeNull();
    });
});
