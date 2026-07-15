import { describe, expect, it } from 'vitest';

import { encodePersistenceAuthority } from '../encodePersistenceAuthority';

describe('encodePersistenceAuthority', () => {
    it('rejects an invalid root lineage', () => {
        expect(() =>
            encodePersistenceAuthority({ epoch: 'project', revision: 3, rootLineage: 'feature/unsafe' })
        ).toThrow('[CrdtPersistence] Invalid root lineage');
    });
});
