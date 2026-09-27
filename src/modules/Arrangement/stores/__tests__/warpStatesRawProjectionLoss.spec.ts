import { beforeEach, describe, expect, it } from 'vitest';

import {
    createAutomergeStorage,
    findAutomergeStorageRawProjectionLosses,
} from '#/infra/store/storage/createAutomergeStorage';

import { discard_warp_states_raw_keys, sanitizeWarpStateStoreState } from '../warpStates';

/**
 * Documents written before the ADR 0024 stretch-mode retirement carry legacy
 * ids (`complex`, `beats`, `texture`) the slot sanitizer maps onto the
 * canonical set. Undeclared, the raw projection-loss detector reads every such
 * row as unrecoverable content loss and holds the project in repair-required —
 * every edit and every save refused, including the save that would rewrite the
 * document with canonical ids.
 */

function legacyRow(stretchMode: string): Record<string, unknown> {
    return {
        enabled: true,
        markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 4, origin: 'user' }],
        stretchMode,
        originalTempo: 120,
    };
}

function findWarpStatesLosses(states: Record<string, unknown>): string[] {
    return findAutomergeStorageRawProjectionLosses({ docId: 'root', document: { warpStates: { states } } });
}

describe('warpStates slot legacy stretch modes', () => {
    beforeEach(() => {
        // The slot exactly as the store module registers it: same doc id, slot,
        // inbound sanitizer and declared discards.
        createAutomergeStorage('root', 'warpStates', {
            discardsRaw: discard_warp_states_raw_keys,
        }).registerInboundSanitizer?.(sanitizeWarpStateStoreState);
    });

    it('reports no loss for a row carrying the legacy complex mode', () => {
        expect(findWarpStatesLosses({ 'clip-1': legacyRow('complex') })).toEqual([]);
    });

    it('reports no loss for a row carrying the legacy texture mode', () => {
        expect(findWarpStatesLosses({ 'clip-1': legacyRow('texture') })).toEqual([]);
    });

    it('reports no loss for a document mixing legacy and canonical rows', () => {
        expect(
            findWarpStatesLosses({
                'clip-1': legacyRow('complex'),
                'clip-2': legacyRow('beats'),
                'clip-3': legacyRow('repitch'),
            })
        ).toEqual([]);
    });

    it('still reports a row whose stretch mode nothing decodes', () => {
        expect(findWarpStatesLosses({ 'clip-1': legacyRow('granular') })).toEqual(['warpStates']);
    });
});
