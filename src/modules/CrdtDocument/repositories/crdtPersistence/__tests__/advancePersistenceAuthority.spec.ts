import { describe, it, expect } from 'vitest';

import { advancePersistenceAuthority } from '../advancePersistenceAuthority';
import { type CrdtPersistenceAuthority } from '../persistenceAuthorityModel';

function auth(epoch: string, revision: number, rootLineage = 'main'): CrdtPersistenceAuthority {
    return { epoch, revision, rootLineage };
}

describe('advancePersistenceAuthority', () => {
    it('increments the revision by 1 and preserves epoch + rootLineage', () => {
        const advanced = advancePersistenceAuthority(auth('e1', 5));
        expect(advanced.revision).toBe(6);
        expect(advanced.epoch).toBe('e1');
        expect(advanced.rootLineage).toBe('main');
    });

    it('overrides the epoch when provided', () => {
        const advanced = advancePersistenceAuthority(auth('e1', 5), 'new-epoch');
        expect(advanced.epoch).toBe('new-epoch');
        expect(advanced.revision).toBe(6);
    });

    it('overrides the rootLineage when provided with a valid value', () => {
        const advanced = advancePersistenceAuthority(auth('e1', 5), 'e1', 'feature-branch');
        expect(advanced.rootLineage).toBe('feature-branch');
    });

    it('throws a TypeError for an invalid rootLineage', () => {
        expect(() => advancePersistenceAuthority(auth('e1', 5), 'e1', 'invalid lineage!')).toThrow(TypeError);
    });

    it('throws when the revision is at MAX_SAFE_INTEGER', () => {
        expect(() => advancePersistenceAuthority(auth('e1', Number.MAX_SAFE_INTEGER))).toThrow(
            'Persistence revision exhausted'
        );
    });

    it('produces distinct authorities on consecutive calls', () => {
        const base = auth('e1', 0);
        const first = advancePersistenceAuthority(base);
        const second = advancePersistenceAuthority(first);
        expect(first.revision).toBe(1);
        expect(second.revision).toBe(2);
        expect(first).not.toEqual(second);
    });
});
