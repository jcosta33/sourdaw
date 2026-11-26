import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getStoredWarpState, trackStore, warpStateStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    isAppActionConflictError,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';

type SetClipWarpStateAction = Extract<AppAction, { type: 'setClipWarpState' }>;
type RawWarpRoot = { warpStates?: { states: Record<string, unknown> } };

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const MARKERS = [
    { id: 'warp-a', originalBeat: 1, warpedBeat: 1, origin: 'user' as const },
    { id: 'warp-b', originalBeat: 3, warpedBeat: 3.5, origin: 'user' as const },
];
const ENABLED_STATE = {
    enabled: true,
    markers: MARKERS,
    stretchMode: 'repitch' as const,
    originalTempo: null,
};

function setWarpAction(clipId: string, warpState: SetClipWarpStateAction['payload']['warpState']) {
    return { type: 'setClipWarpState', payload: { clipId, warpState } } satisfies AppAction;
}

function readRawState(clipId: string): unknown {
    return getCrdtDoc<RawWarpRoot>('root')?.warpStates?.states[clipId];
}

describe('handleSetClipWarpState atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip warp state atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        warpStateStore.set({ states: {} });
        const audioClip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 8 });
        const midiClip = ClipDummy.create({ id: 'clip-midi', startBeat: 0, endBeat: 8, type: 'midi' });
        const track = TrackDummy.create({ id: 'track-1', clips: [audioClip, midiClip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        warpStateStore.set({ states: {} });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('writes the warp state into the document and the store projection in one action', async () => {
        await executeAppAction(setWarpAction('clip-1', ENABLED_STATE));
        flushAutomergeStorageWrites();

        expect(getStoredWarpState('clip-1')).toEqual(ENABLED_STATE);
        expect(readRawState('clip-1')).toMatchObject({ enabled: true, markers: MARKERS });
    });

    it('describes an inverse that restores the previous state and a redo that restates the edit', () => {
        const handler = getArrangementHandlers().setClipWarpState;
        const action = setWarpAction('clip-1', ENABLED_STATE);

        const description = handler.describe(action);

        expect(description.label).toBe('Edit clip warp');
        expect(description.inverseAction).toMatchObject({
            type: 'setClipWarpState',
            payload: {
                clipId: 'clip-1',
                warpState: { enabled: false, markers: [] },
                expectedWarpState: { enabled: true, markers: MARKERS },
            },
        });
        expect(description.redoAction).toMatchObject({
            type: 'setClipWarpState',
            payload: { clipId: 'clip-1', warpState: { enabled: true, markers: MARKERS } },
        });
    });

    it('describes no inverse for a clip that is missing', () => {
        const handler = getArrangementHandlers().setClipWarpState;

        expect(handler.describe(setWarpAction('clip-missing', ENABLED_STATE)).inverseAction).toBeNull();
    });

    it('undo removes the state it created and redo re-applies it', async () => {
        await executeAppAction(setWarpAction('clip-1', ENABLED_STATE));

        await undo();
        flushAutomergeStorageWrites();
        expect(getStoredWarpState('clip-1')).toBeUndefined();
        expect(readRawState('clip-1')).toBeUndefined();

        await redo();
        flushAutomergeStorageWrites();
        expect(getStoredWarpState('clip-1')).toEqual(ENABLED_STATE);
        expect(readRawState('clip-1')).toMatchObject({ enabled: true, markers: MARKERS });
    });

    it('undo restores the exact earlier marker beats', async () => {
        await executeAppAction(setWarpAction('clip-1', ENABLED_STATE));
        const moved = { ...ENABLED_STATE, markers: [{ ...MARKERS[0]!, warpedBeat: 2 }, MARKERS[1]!] };
        await executeAppAction(setWarpAction('clip-1', moved));
        expect(getStoredWarpState('clip-1')?.markers[0]?.warpedBeat).toBe(2);

        await undo();

        expect(getStoredWarpState('clip-1')).toEqual(ENABLED_STATE);
    });

    it('refuses a clip that is missing and writes nothing', async () => {
        const refusal = await executeAppAction(setWarpAction('clip-missing', ENABLED_STATE)).catch(
            (error: unknown) => error
        );

        expect(isAppActionConflictError(refusal)).toBe(true);
        expect(getStoredWarpState('clip-missing')).toBeUndefined();
        expect(readRawState('clip-missing')).toBeUndefined();
    });

    it('refuses a MIDI clip and writes nothing', async () => {
        const refusal = await executeAppAction(setWarpAction('clip-midi', ENABLED_STATE)).catch(
            (error: unknown) => error
        );

        expect(isAppActionConflictError(refusal)).toBe(true);
        expect(getStoredWarpState('clip-midi')).toBeUndefined();
    });

    it('refuses to overwrite a warp state that no longer matches the expectation', async () => {
        await executeAppAction(setWarpAction('clip-1', ENABLED_STATE));
        const stale = {
            type: 'setClipWarpState',
            payload: {
                clipId: 'clip-1',
                warpState: { ...ENABLED_STATE, stretchMode: 'wsola' as const },
                expectedWarpState: { ...ENABLED_STATE, enabled: false },
            },
        } satisfies AppAction;

        const refusal = await executeAppAction(stale).catch((error: unknown) => error);

        expect(isAppActionConflictError(refusal)).toBe(true);
        expect(getStoredWarpState('clip-1')?.stretchMode).toBe('repitch');
    });

    it('a peer change with no pending local write reaches the store', () => {
        // Setup's deferred empty write is settled first; a peer change landing over a pending local write is tracked in #7454.
        flushAutomergeStorageWrites();
        mutateCrdtDoc<RawWarpRoot>({
            id: 'root',
            changeFn: (document) => {
                document.warpStates = { states: { 'clip-1': { ...ENABLED_STATE, markers: [...MARKERS] } } };
            },
        });
        warpStateStore.hydrate();

        expect(getStoredWarpState('clip-1')).toEqual(ENABLED_STATE);
    });
});
