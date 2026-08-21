import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { createCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { handleDiscardCreatedTracks } from '../discardCreatedTracks';

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

function liveTrackIds(): string[] {
    return trackStore.value?.tracks.map((track) => track.id) ?? [];
}

// `execute` is declared as possibly async on the shared contract even though this
// handler is certified `isolated-project` (synchronous) — narrow before touching
// handler-result fields.
function requireSynchronousResult(
    result: void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>
): HandlerExecutionResult {
    expect(result).not.toBeInstanceOf(Promise);
    if (!result || result instanceof Promise) {
        throw new Error('expected a synchronous handler result');
    }
    return result;
}

// Exercised against the real trackStore and the real (unmocked) `removeTrack` chain —
// through the singular `handleDiscardCreatedTrack` this handler delegates to — rather than
// a mocked delegate, so the surviving track list and the conflict guard are proven against
// actual store writes instead of asserted call arguments.
describe('handleDiscardCreatedTracks', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setArrangementEventBus(new NoopArrangementEventBus());
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'sibling', name: 'Sibling', kind: 'audio' }),
                TrackDummy.create({ id: 'created-1', name: 'Created 1', kind: 'audio' }),
                TrackDummy.create({ id: 'created-2', name: 'Created 2', kind: 'audio' }),
            ],
            selectedTrackId: 'sibling',
            ghostClips: [],
        });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('removes exactly the named tracks and leaves every sibling in place', () => {
        const result = requireSynchronousResult(
            handleDiscardCreatedTracks.execute({
                type: 'discardCreatedTracks',
                payload: { trackIds: ['created-1', 'created-2'] },
            })
        );

        expect(result.status).toBe('written');
        expect(liveTrackIds()).toEqual(['sibling']);
    });

    it('conflicts and writes nothing when a named track is already gone', () => {
        const result = handleDiscardCreatedTracks.execute({
            type: 'discardCreatedTracks',
            payload: { trackIds: ['created-1', 'already-removed'] },
        });

        expect(result).toEqual({ status: 'conflict' });
        // Nothing was removed: the still-present named track survives alongside its sibling.
        expect(liveTrackIds()).toEqual(['sibling', 'created-1', 'created-2']);
    });

    it('is an internal non-undoable compensation action', () => {
        expect(handleDiscardCreatedTracks.undoable).toBe(false);
    });
});
