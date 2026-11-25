import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';

// Real handler, dispatch, CRDT authority and undo history: enabling the loop on
// a project that has no loop region must leave a loopable region behind.

type RootDocument = {
    transport?: { loopStart: number; loopEnd: number; isLooping: boolean };
    tracks?: { tracks: Array<{ clips: Array<{ endBeat: number }> }> };
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const EMPTY = { loopStart: 0, loopEnd: 0, isLooping: false };

function loopTriple() {
    const state = transportStore.value;
    if (!state) {
        throw new Error('Expected transport state');
    }
    return { loopStart: state.loopStart, loopEnd: state.loopEnd, isLooping: state.isLooping };
}

describe('setLoopEnabled on a zero-length loop region', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('set loop enabled empty region');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        setNotificationEventBus(createEventBus<NotificationEvents>());
        clearUndoHistory();
        setTrackStoreState(defaultTrackState);
        timeSignatureMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, ...EMPTY });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        setTrackStoreState(defaultTrackState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('loops the first bar of an empty arrangement, and one undo and redo restore and reapply it', async () => {
        await executeAppAction({ type: 'setLoopEnabled', payload: { enabled: true } });

        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 4, isLooping: true });
        expect(getCrdtDoc<RootDocument>('root')?.transport).toMatchObject(loopTriple());
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(loopTriple()).toEqual(EMPTY);

        await redo();
        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 4, isLooping: true });
    });

    it('loops from the start to the last clip end when the arrangement holds clips', async () => {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-loop', name: 'Loop extent', kind: 'audio' })],
        });
        expect(
            addClip({ id: 'clip-eight', trackId: 'track-loop', name: 'Eight', startBeat: 0, endBeat: 8, type: 'audio' })
        ).not.toBeNull();
        await vi.waitFor(() => {
            expect(getCrdtDoc<RootDocument>('root')?.tracks?.tracks[0]?.clips).toEqual(
                expect.arrayContaining([expect.objectContaining({ endBeat: 8 })])
            );
        });

        await executeAppAction({ type: 'setLoopEnabled', payload: { enabled: true } });

        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 8, isLooping: true });

        await undo();
        expect(loopTriple()).toEqual(EMPTY);

        await redo();
        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 8, isLooping: true });
    });
});
