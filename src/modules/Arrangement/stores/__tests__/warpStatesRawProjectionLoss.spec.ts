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

/** A row with no warp content of its own: whatever it decodes to, the slot
 *  sanitizer's `isDefaultWarpState` collapse removes it from the projection. */
function defaultCollapsingRow(stretchMode: string): Record<string, unknown> {
    return { enabled: false, markers: [], stretchMode, originalTempo: null };
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

    it('reports no loss for a bare legacy row the sanitizer collapses to default', () => {
        // A `texture` row with no content decodes onto the canonical default,
        // which the sanitizer stores as absent. Undeclared in the pre-image,
        // the detector reads the empty projection as losing the row and holds
        // the project in repair-required forever — the repair re-projects into
        // the same collapse and reports the same loss again.
        expect(findWarpStatesLosses({ 'clip-1': defaultCollapsingRow('texture') })).toEqual([]);
    });

    it('reports no loss when a default-collapsing legacy row sits beside a healthy row', () => {
        expect(
            findWarpStatesLosses({
                'clip-1': defaultCollapsingRow('beats'),
                'clip-2': legacyRow('complex'),
            })
        ).toEqual([]);
    });

    it('reports no loss for a canonical row that is default', () => {
        // The collapse is the `isDefaultWarpState` contract, not a side effect
        // of the legacy mapping: a canonical-mode row with no content is
        // dropped by the same rule and must leave the pre-image the same way.
        expect(findWarpStatesLosses({ 'clip-1': defaultCollapsingRow('repitch') })).toEqual([]);
    });

    it('still reports a row whose stretch mode nothing decodes', () => {
        expect(findWarpStatesLosses({ 'clip-1': legacyRow('granular') })).toEqual(['warpStates']);
    });
});
