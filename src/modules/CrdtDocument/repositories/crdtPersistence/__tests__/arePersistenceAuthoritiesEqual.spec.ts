import { describe, it, expect } from 'vitest';

import { arePersistenceAuthoritiesEqual } from '../arePersistenceAuthoritiesEqual';
import { type CrdtPersistenceAuthority } from '../persistenceAuthorityModel';

function auth(epoch: string, revision: number, rootLineage: string): CrdtPersistenceAuthority {
    return { epoch, revision, rootLineage };
}

describe('arePersistenceAuthoritiesEqual', () => {
    it('returns true for identical authorities', () => {
        const a = auth('e1', 5, 'main');
        expect(arePersistenceAuthoritiesEqual(a, auth('e1', 5, 'main'))).toBe(true);
    });

    it('returns false when epoch differs', () => {
        expect(arePersistenceAuthoritiesEqual(auth('e1', 5, 'main'), auth('e2', 5, 'main'))).toBe(false);
    });

    it('returns false when revision differs', () => {
        expect(arePersistenceAuthoritiesEqual(auth('e1', 5, 'main'), auth('e1', 6, 'main'))).toBe(false);
    });

    it('returns false when rootLineage differs', () => {
        expect(arePersistenceAuthoritiesEqual(auth('e1', 5, 'main'), auth('e1', 5, 'dev'))).toBe(false);
    });
});
