import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '../../../../CrdtDocument/useCases';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore, type Track } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { handleDiscardImportedStemSet } from '../handleImportStemSet';

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

function importedTracks(): Track[] {
    const folder = TrackDummy.create({ id: 'folder-imported', name: 'Imported Stems', kind: 'folder' });
    const kick = TrackDummy.create({ id: 'track-kick', name: 'Kick', kind: 'audio', parentId: folder.id });
    const bass = TrackDummy.create({ id: 'track-bass', name: 'Bass', kind: 'audio', parentId: folder.id });
    return [folder, kick, bass];
}

function actionFor(tracks: readonly Track[]): Extract<AppAction, { type: 'discardImportedStemSet' }> {
    return {
        type: 'discardImportedStemSet',
        payload: {
            folderId: 'folder-imported',
            stemTrackIds: ['track-kick', 'track-bass'],
            guards: tracks.map((track) => ({
                trackId: track.id,
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify(track),
                    midiByClipIdJson: serializeMidiStateForClips(track.clips.map((clip) => clip.id)),
                },
            })),
        },
    };
}

function liveTrackIds(): string[] {
    return trackStore.value?.tracks.map((track) => track.id) ?? [];
}

describe('handleDiscardImportedStemSet', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setArrangementEventBus(new NoopArrangementEventBus());
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('removes exactly the guarded imported children and their folder', () => {
        const tracks = importedTracks();
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
        const action = actionFor(tracks);

        expect(handleDiscardImportedStemSet.validate(action, {})).toBe(true);
        expect(handleDiscardImportedStemSet.canReapplyAfterDivergence?.(action)).toBe(true);
        expect(handleDiscardImportedStemSet.execute(action)).toMatchObject({ status: 'written' });
        expect(liveTrackIds()).toEqual([]);
    });

    it.each([
        [
            'incomplete',
            (action: Extract<AppAction, { type: 'discardImportedStemSet' }>) => {
                action.payload.guards.pop();
            },
        ],
        [
            'duplicate',
            (action: Extract<AppAction, { type: 'discardImportedStemSet' }>) => {
                action.payload.guards[2] = structuredClone(action.payload.guards[1]!);
            },
        ],
        [
            'divergent',
            () => {
                const track = trackStore.value?.tracks.find(({ id }) => id === 'track-bass');
                if (!track || !trackStore.value) {
                    throw new Error('Expected imported bass track');
                }
                trackStore.set({
                    ...trackStore.value,
                    tracks: trackStore.value.tracks.map((candidate) =>
                        candidate.id === track.id ? { ...candidate, name: 'Bass edited by collaborator' } : candidate
                    ),
                });
            },
        ],
    ] as const)('conflicts and preserves every track for %s guards', (_label, invalidate) => {
        const tracks = importedTracks();
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
        const action = actionFor(tracks);

        invalidate(action);

        expect(handleDiscardImportedStemSet.validate(action, {})).toBe(false);
        expect(handleDiscardImportedStemSet.execute(action)).toEqual({ status: 'conflict' });
        expect(liveTrackIds()).toEqual(['folder-imported', 'track-kick', 'track-bass']);
    });
});
