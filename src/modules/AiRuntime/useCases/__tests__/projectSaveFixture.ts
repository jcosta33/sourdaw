import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';

/**
 * The project metadata and the one active arrangement a real project carries, written to the
 * document, so a later save only stamps its timestamp and copies the live slots into that entry.
 */
export function seedSavableProject(): void {
    projectStore.set(structuredClone(defaultProjectStoreState));
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
}

/**
 * The root writes `saveProject` performs, in its order: a fresh save timestamp, then
 * `buildProjectData`'s refresh of the active arrangement's entry from the live slots. Nothing a
 * musician edited moves.
 */
export async function writeProjectSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

/** A content edit: one track's fader moves and reaches the document. */
export function moveTrackFader(trackId: string, gain: number): void {
    const state = trackStore.value;
    if (state === null) {
        throw new Error('A fader edit needs a track list.');
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, gain } : track)),
    });
    flushAutomergeStorageWrites();
}
