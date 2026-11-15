import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { createCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track, trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { captureCreatedTrackGuards } from '../captureCreatedTrackGuards';
import { handleDiscardCreatedTracks } from '../discardCreatedTracks';

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

function guardedDiscard(trackIds: readonly string[]) {
    const generatedMidiStateGuards = captureCreatedTrackGuards(trackIds);
    expect(generatedMidiStateGuards).not.toBeNull();
    return {
        type: 'discardCreatedTracks' as const,
        payload: { trackIds, generatedMidiStateGuards: generatedMidiStateGuards! },
    };
}

function editTrack(trackId: string, edit: (track: Track) => Track): void {
    const state = trackStore.value!;
    trackStore.set({ ...state, tracks: state.tracks.map((track) => (track.id === trackId ? edit(track) : track)) });
}

function hostedTrack(id: string): Track {
    return TrackDummy.create({
        id,
        name: id,
        kind: 'audio',
        devices: [
            {
                id: `${id}-plugin`,
                name: 'Reverb',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-abc',
                externalInstanceId: `${id}-instance`,
                externalStateChunk: 'c2F2ZWQ=',
            },
        ],
    });
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
    describe('with the guards its creator finalized (issue #6817)', () => {
        it('removes every named track while each still matches its guard', () => {
            const action = guardedDiscard(['created-1', 'created-2']);

            const result = requireSynchronousResult(handleDiscardCreatedTracks.execute(action));

            expect(result.status).toBe('written');
            expect(liveTrackIds()).toEqual(['sibling']);
        });

        it('conflicts and removes nothing when any one created track was edited', () => {
            const action = guardedDiscard(['created-1', 'created-2']);
            editTrack('created-2', (track) => ({ ...track, name: 'Collaborator edit' }));

            expect(handleDiscardCreatedTracks.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
            expect(handleDiscardCreatedTracks.execute(action)).toEqual({ status: 'conflict' });
            expect(liveTrackIds()).toEqual(['sibling', 'created-1', 'created-2']);
        });

        it('conflicts when a created device setting changed', () => {
            trackStore.set({ tracks: [hostedTrack('created-1')], selectedTrackId: null, ghostClips: [] });
            const action = guardedDiscard(['created-1']);
            editTrack('created-1', (track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, bypassed: true })),
            }));

            expect(handleDiscardCreatedTracks.execute(action)).toEqual({ status: 'conflict' });
            expect(liveTrackIds()).toEqual(['created-1']);
        });

        it('still removes a track whose only change is a plugin state capture', () => {
            trackStore.set({ tracks: [hostedTrack('created-1')], selectedTrackId: null, ghostClips: [] });
            const action = guardedDiscard(['created-1']);
            editTrack('created-1', (track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, externalStateChunk: 'ZWRpdGVk' })),
            }));

            expect(handleDiscardCreatedTracks.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            const result = requireSynchronousResult(handleDiscardCreatedTracks.execute(action));
            expect(result.status).toBe('written');
            expect(liveTrackIds()).toEqual([]);
        });

        it.each([
            { drift: 'a clip rename', edit: { name: 'Renamed take' } },
            { drift: 'a clip move', edit: { startBeat: 1 } },
        ])('conflicts when a created clip drifted: $drift', ({ edit }) => {
            const clip = ClipDummy.create({ id: 'created-clip', trackId: 'created-1', startBeat: 0, endBeat: 4 });
            editTrack('created-1', (track) => ({ ...track, clips: [clip] }));
            const action = guardedDiscard(['created-1', 'created-2']);
            editTrack('created-1', (track) => ({ ...track, clips: [{ ...clip, ...edit }] }));

            expect(handleDiscardCreatedTracks.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
            expect(handleDiscardCreatedTracks.execute(action)).toEqual({ status: 'conflict' });
            expect(liveTrackIds()).toEqual(['sibling', 'created-1', 'created-2']);
        });

        it('refuses guards that do not name every track exactly once', () => {
            const complete = guardedDiscard(['created-1', 'created-2']);
            const action = {
                ...complete,
                payload: {
                    ...complete.payload,
                    generatedMidiStateGuards: [
                        complete.payload.generatedMidiStateGuards[0]!,
                        complete.payload.generatedMidiStateGuards[0]!,
                    ],
                },
            };

            expect(handleDiscardCreatedTracks.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
            expect(handleDiscardCreatedTracks.execute(action)).toEqual({ status: 'conflict' });
            expect(liveTrackIds()).toEqual(['sibling', 'created-1', 'created-2']);
        });

        it('keeps discarding by id alone for an entry recorded without guards', () => {
            editTrack('created-1', (track) => ({ ...track, name: 'Edited' }));
            const action = { type: 'discardCreatedTracks' as const, payload: { trackIds: ['created-1'] } };

            expect(handleDiscardCreatedTracks.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            expect(requireSynchronousResult(handleDiscardCreatedTracks.execute(action)).status).toBe('written');
            expect(liveTrackIds()).toEqual(['sibling', 'created-2']);
        });
    });
});
