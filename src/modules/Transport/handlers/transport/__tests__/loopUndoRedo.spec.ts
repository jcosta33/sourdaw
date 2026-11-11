import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeUserAppAction, redo, undo } from '#/modules/Command/useCases';
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

import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';
import { projectEngineTransportMaps } from '../../../useCases/tempoMap/projectEngineTransportMaps';
import { setLoopRegion } from '../../../useCases/transportControls/setLoopRegion';

type RootDocument = {
    transport?: { loopStart: number; loopEnd: number; isLooping: boolean };
    tracks?: { tracks: Array<{ clips: Array<{ endBeat: number }> }> };
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

function loopTriple() {
    const state = transportStore.value;
    if (!state) {
        throw new Error('Expected transport state');
    }
    return { loopStart: state.loopStart, loopEnd: state.loopEnd, isLooping: state.isLooping };
}

describe('loop command undo and redo', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('loop command undo redo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        setNotificationEventBus(createEventBus<NotificationEvents>());
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, loopStart: 0, loopEnd: 0, isLooping: false });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits one valid triple and replays the captured endpoints after arrangement changes', async () => {
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

        await executeUserAppAction({ type: 'toggleLoop' });

        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 8, isLooping: true });
        expect(getCrdtDoc<RootDocument>('root')?.transport).toMatchObject(loopTriple());
        expect(projectEngineTransportMaps().loopRegion).toEqual({ enabled: true, startSeconds: 0, endSeconds: 4 });
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 0, isLooping: false });

        expect(
            addClip({
                id: 'clip-sixteen',
                trackId: 'track-loop',
                name: 'Sixteen',
                startBeat: 8,
                endBeat: 16,
                type: 'audio',
            })
        ).not.toBeNull();
        await vi.waitFor(() => {
            expect(getCrdtDoc<RootDocument>('root')?.tracks?.tracks[0]?.clips).toEqual(
                expect.arrayContaining([expect.objectContaining({ endBeat: 16 })])
            );
        });
        await redo();

        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 8, isLooping: true });
    });

    it('refuses undo after a collaborator changes the loop triple', async () => {
        await executeUserAppAction({ type: 'toggleLoop' });
        setLoopRegion(2, 12, false);
        await vi.waitFor(() => {
            expect(getCrdtDoc<RootDocument>('root')?.transport).toMatchObject({
                loopStart: 2,
                loopEnd: 12,
                isLooping: true,
            });
        });

        await undo();

        expect(loopTriple()).toEqual({ loopStart: 2, loopEnd: 12, isLooping: true });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(getCrdtDoc<RootDocument>('root')?.transport).toMatchObject(loopTriple());
    });

    it('refuses redo after a collaborator changes the loop triple', async () => {
        await executeUserAppAction({ type: 'toggleLoop' });
        await undo();
        setLoopRegion(2, 12, false);
        await vi.waitFor(() => {
            expect(getCrdtDoc<RootDocument>('root')?.transport).toMatchObject({
                loopStart: 2,
                loopEnd: 12,
                isLooping: false,
            });
        });

        await redo();

        expect(loopTriple()).toEqual({ loopStart: 2, loopEnd: 12, isLooping: false });
        expect(undoStore.value?.future).toHaveLength(1);
        expect(getCrdtDoc<RootDocument>('root')?.transport).toMatchObject(loopTriple());
    });

    it('keeps setLoopRegion undo and redo guarded by its captured loop triple', async () => {
        transportStore.set({ ...defaultTransportState, loopStart: 0, loopEnd: 8, isLooping: false });
        await executeUserAppAction({ type: 'setLoopRegion', payload: { startBeat: 4, endBeat: 12 } });
        expect(loopTriple()).toEqual({ loopStart: 4, loopEnd: 12, isLooping: false });

        await undo();
        expect(loopTriple()).toEqual({ loopStart: 0, loopEnd: 8, isLooping: false });

        await redo();
        expect(loopTriple()).toEqual({ loopStart: 4, loopEnd: 12, isLooping: false });
    });
});
