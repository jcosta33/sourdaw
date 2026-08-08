import { describe, expect, it } from 'vitest';

import { createCrdtPersistenceMembershipConflictError } from '../CrdtPersistenceMembershipConflictError';

describe('createCrdtPersistenceMembershipConflictError', () => {
    it('creates an error with tag CrdtPersistenceMembershipConflict', () => {
        const error = createCrdtPersistenceMembershipConflictError({
            localDocumentIds: ['doc-a'],
            durableDocumentIds: ['doc-b'],
        });

        expect(error._tag).toBe('CrdtPersistenceMembershipConflict');
        expect(error).toBeInstanceOf(Error);
    });

    it('copies localDocumentIds and durableDocumentIds as arrays', () => {
        const local = ['doc-1', 'doc-2'];
        const durable = ['doc-3'];
        const error = createCrdtPersistenceMembershipConflictError({
            localDocumentIds: local,
            durableDocumentIds: durable,
        });

        expect(error.localDocumentIds).toEqual(['doc-1', 'doc-2']);
        expect(error.durableDocumentIds).toEqual(['doc-3']);
        // Copies — not the same references.
        expect(error.localDocumentIds).not.toBe(local);
        expect(error.durableDocumentIds).not.toBe(durable);
    });

    it('the message mentions reload requirement', () => {
        const error = createCrdtPersistenceMembershipConflictError({
            localDocumentIds: [],
            durableDocumentIds: [],
        });

        expect(error.message).toContain('reload');
    });
});
