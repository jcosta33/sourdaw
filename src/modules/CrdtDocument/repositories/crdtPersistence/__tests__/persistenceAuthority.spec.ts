import { describe, expect, it } from 'vitest';

import { MAX_CRDT_ROOT_LINEAGE_LENGTH } from '../../../models/CrdtRootLineage';
import {
    decodePersistenceAuthority,
    EMPTY_PERSISTENCE_AUTHORITY,
    encodePersistenceAuthority,
} from '../persistenceAuthority';

describe('persistence authority', () => {
    it('migrates a version 1 authority to the conservative Main root lineage', () => {
        const legacyAuthority = new TextEncoder().encode(
            JSON.stringify({
                version: 1,
                epoch: 'legacy-project',
                revision: 7,
            })
        );

        const decoded = decodePersistenceAuthority(legacyAuthority);

        expect(decoded).toEqual({
            epoch: 'legacy-project',
            revision: 7,
            rootLineage: 'main',
        });
        expect(JSON.parse(new TextDecoder().decode(encodePersistenceAuthority(decoded)))).toEqual({
            version: 2,
            epoch: 'legacy-project',
            revision: 7,
            rootLineage: 'main',
        });
    });

    it('round-trips a validated version 2 branch lineage', () => {
        const authority = {
            epoch: 'project',
            revision: 9,
            rootLineage: 'feature_12.release-candidate',
        };

        expect(decodePersistenceAuthority(encodePersistenceAuthority(authority))).toEqual(authority);
    });

    it('rejects malformed or oversized persisted root lineages', () => {
        function encodeRawAuthority(rootLineage: string): Uint8Array {
            return new TextEncoder().encode(
                JSON.stringify({
                    version: 2,
                    epoch: 'project',
                    revision: 3,
                    rootLineage,
                })
            );
        }

        expect(decodePersistenceAuthority(encodeRawAuthority('feature/unsafe'))).toEqual(EMPTY_PERSISTENCE_AUTHORITY);
        expect(decodePersistenceAuthority(encodeRawAuthority('x'.repeat(MAX_CRDT_ROOT_LINEAGE_LENGTH + 1)))).toEqual(
            EMPTY_PERSISTENCE_AUTHORITY
        );
        expect(() =>
            encodePersistenceAuthority({ epoch: 'project', revision: 3, rootLineage: 'feature/unsafe' })
        ).toThrow('[CrdtPersistence] Invalid root lineage');
    });
});
