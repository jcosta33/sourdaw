import { describe, expect, it } from 'vitest';

import { decodePersistenceBundle } from '../decodePersistenceBundle';
import { PERSISTENCE_AUTHORITY_KEY } from '../persistenceAuthorityModel';

describe('decodePersistenceBundle', () => {
    it('decodes document bytes while excluding the persistence authority record', () => {
        const bundle = decodePersistenceBundle(
            ['root', PERSISTENCE_AUTHORITY_KEY, 'branch:feature'],
            [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]
        );

        expect(bundle).toEqual(
            new Map([
                ['root', new Uint8Array([1])],
                ['branch:feature', new Uint8Array([3])],
            ])
        );
    });

    it('rejects non-string persisted keys', () => {
        expect(() => decodePersistenceBundle([7], [new Uint8Array([1])])).toThrow(
            '[CrdtPersistence] Invalid persisted key at index 0'
        );
    });

    it('rejects persisted records that are not byte arrays', () => {
        expect(() => decodePersistenceBundle(['root'], [{ invalid: true }])).toThrow(
            '[CrdtPersistence] Invalid persisted record at index 0'
        );
    });
});
