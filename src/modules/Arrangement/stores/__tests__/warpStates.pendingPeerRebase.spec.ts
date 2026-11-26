import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { type WarpState } from '../../models/WarpMarker';
import { warpStateStore } from '../warpStates';

type RawWarpRoot = { warpStates: { states: Record<string, WarpState> } };

function warpState(originalTempo: number, markerIds: readonly string[] = ['base']): WarpState {
    return {
        enabled: true,
        stretchMode: 'repitch',
        originalTempo,
        markers: markerIds.map((id, index) => ({ id, originalBeat: index + 1, warpedBeat: index + 2, origin: 'user' })),
    };
}

const STATE_A = warpState(100);
const STATE_B = warpState(110);
const STATE_C = warpState(120);

function readDocumentStates(): Record<string, WarpState> {
    const states = getCrdtDoc<RawWarpRoot>('root')?.warpStates.states;
    if (!states) {
        throw new Error('Expected the warp state slot');
    }
    return structuredClone(states);
}

function readStoreStates(): Record<string, WarpState> {
    return warpStateStore.value?.states ?? {};
}

/** A collaborator's change arriving in the shared document. */
function applyPeerChange(changeStates: (states: Record<string, WarpState>) => void): void {
    mutateCrdtDoc<RawWarpRoot>({ id: 'root', changeFn: (document) => changeStates(document.warpStates.states) });
}

/** `committed` lands in the document, then a local write of `pending` stays unflushed. */
function openPendingWrite(committed: Record<string, WarpState>, pending: Record<string, WarpState>): void {
    warpStateStore.set({ states: committed });
    flushAutomergeStorageWrites();
    warpStateStore.set({ states: pending });
    expect(countPendingAutomergeStorageWrites()).toBe(1);
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    warpStateStore.set({ states: {} });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('warpStateStore rebasing a pending write over a peer change', () => {
    it('shows and keeps a clip a peer adds while a local write adding another clip is pending', () => {
        openPendingWrite({ A: STATE_A }, { A: STATE_A, B: STATE_B });

        applyPeerChange((states) => {
            states.C = structuredClone(STATE_C);
        });
        warpStateStore.hydrate();

        expect(readStoreStates()).toEqual({ A: STATE_A, B: STATE_B, C: STATE_C });
        flushAutomergeStorageWrites();
        expect(readDocumentStates()).toEqual({ A: STATE_A, B: STATE_B, C: STATE_C });
        expect(readStoreStates()).toEqual({ A: STATE_A, B: STATE_B, C: STATE_C });
    });

    it('keeps removed a clip a peer removes that the pending write left untouched', () => {
        openPendingWrite({ A: STATE_A }, { A: STATE_A, B: STATE_B });

        applyPeerChange((states) => {
            delete states.A;
        });
        warpStateStore.hydrate();

        expect(readStoreStates()).toEqual({ B: STATE_B });
        flushAutomergeStorageWrites();
        expect(readDocumentStates()).toEqual({ B: STATE_B });
        expect(readStoreStates()).toEqual({ B: STATE_B });
    });

    it('lets the pending write win a field both sides changed and keeps the peer`s other edits', () => {
        openPendingWrite({ A: STATE_A, B: STATE_B }, { A: { ...STATE_A, originalTempo: 90 }, B: STATE_B });

        applyPeerChange((states) => {
            const peerA = states.A;
            if (!peerA) {
                throw new Error('Expected clip A in the document');
            }
            peerA.originalTempo = 140;
            peerA.stretchMode = 'wsola';
            states.B = structuredClone(STATE_C);
        });
        warpStateStore.hydrate();

        const expected = { A: { ...STATE_A, originalTempo: 90, stretchMode: 'wsola' }, B: STATE_C };
        expect(readStoreStates()).toEqual(expected);
        flushAutomergeStorageWrites();
        expect(readDocumentStates()).toEqual(expected);
        expect(readStoreStates()).toEqual(expected);
    });

    it('keeps both a local and a peer marker added to the same clip', () => {
        openPendingWrite({ A: STATE_A }, { A: warpState(100, ['base', 'local']) });

        applyPeerChange((states) => {
            states.A?.markers.push({ id: 'peer', originalBeat: 7, warpedBeat: 8, origin: 'user' });
        });
        warpStateStore.hydrate();

        const markerIds = (states: Record<string, WarpState>): string[] =>
            (states.A?.markers ?? []).map(({ id }) => id).sort();
        expect(markerIds(readStoreStates())).toEqual(['base', 'local', 'peer']);
        flushAutomergeStorageWrites();
        expect(markerIds(readDocumentStates())).toEqual(['base', 'local', 'peer']);
        expect(markerIds(readStoreStates())).toEqual(['base', 'local', 'peer']);
    });
});
