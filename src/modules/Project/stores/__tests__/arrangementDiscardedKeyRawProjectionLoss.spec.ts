import { beforeEach, describe, expect, it } from 'vitest';

import {
    createAutomergeStorage,
    findAutomergeStorageRawProjectionLosses,
} from '#/infra/store/storage/createAutomergeStorage';

import {
    defaultArrangementId,
    discard_arrangements_raw_keys,
    sanitize_arrangement_store_state,
} from '../arrangementStore';

/**
 * Documents saved before #3533 carry snapshot keys this store rebuilds away:
 * `ghostClips`, the assistant's transient proposals that `takeSnapshot` copied
 * out of the live track store, and the retired `virginTerritory` lane flag.
 * Undeclared, each one reads as unrecoverable content loss and holds the
 * project in repair-required — every edit and every save refused, including the
 * save that would rewrite the document without the key.
 */

type SnapshotOverrides = {
    tracksExtras?: Record<string, unknown>;
    laneExtras?: Record<string, unknown>;
    extraLanes?: readonly Record<string, unknown>[];
};

function document({ tracksExtras = {}, laneExtras = {}, extraLanes = [] }: SnapshotOverrides): Record<string, unknown> {
    return {
        arrangements: {
            activeArrangementId: defaultArrangementId,
            arrangements: [
                {
                    id: defaultArrangementId,
                    name: 'Arrangement 1',
                    tracks: { tracks: [], selectedTrackId: null, ...tracksExtras },
                    automation: {
                        lanes: [
                            { id: 'lane-1', trackId: 'track-1', parameterId: 'gain', points: [], ...laneExtras },
                            ...extraLanes,
                        ],
                    },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
        },
    };
}

function findArrangementLosses(overrides: SnapshotOverrides): string[] {
    return findAutomergeStorageRawProjectionLosses({ docId: 'root', document: document(overrides) });
}

describe('arrangement snapshot discarded keys', () => {
    beforeEach(() => {
        // The slot exactly as the store module registers it: same doc id, slot,
        // inbound sanitizer and declared discards.
        createAutomergeStorage('root', 'arrangements', {
            discardsRaw: discard_arrangements_raw_keys,
        }).registerInboundSanitizer?.(sanitize_arrangement_store_state);
    });

    it('reports no loss for a snapshot carrying transient ghost clips', () => {
        expect(findArrangementLosses({ tracksExtras: { ghostClips: [] } })).toEqual([]);
    });

    it('reports no loss for a lane carrying the retired virgin-territory flag', () => {
        expect(findArrangementLosses({ laneExtras: { virginTerritory: true } })).toEqual([]);
    });

    it('reports no loss for a document carrying both', () => {
        expect(
            findArrangementLosses({ tracksExtras: { ghostClips: [] }, laneExtras: { virginTerritory: true } })
        ).toEqual([]);
    });

    it('still reports a tracks key nothing declared as discarded', () => {
        expect(findArrangementLosses({ tracksExtras: { foo: 'unreadable' } })).toEqual(['arrangements']);
    });

    it('still reports an undeclared key beside a declared one', () => {
        expect(findArrangementLosses({ tracksExtras: { ghostClips: [], foo: 'unreadable' } })).toEqual([
            'arrangements',
        ]);
    });

    it('keeps an unknown lane key: the store preserves lanes it can identify, so nothing is lost', () => {
        expect(findArrangementLosses({ laneExtras: { unreadable: true } })).toEqual([]);
    });

    it('still reports a lane the store drops for want of an identity', () => {
        expect(findArrangementLosses({ extraLanes: [{ trackId: 'track-1', points: [] }] })).toEqual(['arrangements']);
    });
});
