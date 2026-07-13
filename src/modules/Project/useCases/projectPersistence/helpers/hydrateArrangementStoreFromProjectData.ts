import { type ProjectMidi } from '../../../models/ProjectData';
import { type ArrangementSnapshot, arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { hydrateArrangementTracks } from '../fileIO/hydrateArrangementTracks';
import { hydrateProjectMidi } from '../fileIO/hydrateProjectMidi';

import {
    type HydratableArrangementSnapshot,
    type HydratableProjectData,
    type HydratableProjectTrack,
} from './isHydratableProjectData';

type HydrateMidiWithInlineNotesInput = {
    midi: ProjectMidi | undefined;
    tracks: readonly HydratableProjectTrack[];
};

type HydrateMidiWithInlineNotesOutput = ArrangementSnapshot['midi'];

function hydrateMidiWithInlineNotes({
    midi,
    tracks,
}: HydrateMidiWithInlineNotesInput): HydrateMidiWithInlineNotesOutput {
    const arrangementMidi = midi
        ? hydrateProjectMidi(midi)
        : { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

    for (const track of tracks) {
        const clips = [...track.clips, ...(track.alternatives ?? []).flatMap((alternative) => alternative.clips)];
        for (const clip of clips) {
            if (!arrangementMidi.notesByClipId[clip.id] && clip.notes && clip.notes.length > 0) {
                arrangementMidi.notesByClipId[clip.id] = clip.notes;
            }
        }
    }

    return arrangementMidi;
}

type HydrateSavedArrangementInput = {
    data: HydratableProjectData;
    snapshot: HydratableArrangementSnapshot;
};

function hydrateSavedArrangement({ data, snapshot }: HydrateSavedArrangementInput): ArrangementSnapshot {
    const useActiveFallback = snapshot.id === data.activeArrangementId;
    const serializedTracks = snapshot.tracks?.tracks ?? (useActiveFallback ? data.arrangement.tracks : []);
    const midi = snapshot.midi ?? (useActiveFallback ? data.midi : undefined);

    return {
        id: snapshot.id,
        name: snapshot.name,
        tracks: {
            tracks: hydrateArrangementTracks(serializedTracks),
            selectedTrackId: snapshot.tracks?.selectedTrackId ?? null,
        },
        automation: snapshot.automation ?? (useActiveFallback ? data.automation : undefined) ?? { lanes: [] },
        midi: hydrateMidiWithInlineNotes({
            midi,
            tracks: serializedTracks,
        }),
        tempoMap: snapshot.tempoMap,
        timeSignatureMap: snapshot.timeSignatureMap,
        markers: snapshot.markers,
        takeLanes: snapshot.takeLanes,
    };
}

type HydrateArrangementStoreFromProjectDataInput = {
    data: HydratableProjectData;
    preserveSavedArrangements?: boolean;
};

export function hydrateArrangementStoreFromProjectData({
    data,
    preserveSavedArrangements = false,
}: HydrateArrangementStoreFromProjectDataInput): void {
    if (preserveSavedArrangements && data.arrangements && data.arrangements.length > 0) {
        const arrangements = data.arrangements.map((snapshot) => hydrateSavedArrangement({ data, snapshot }));

        if (arrangements.length > 0) {
            const requestedActiveArrangementId = data.activeArrangementId;
            const activeArrangementId =
                requestedActiveArrangementId &&
                arrangements.some((snapshot) => snapshot.id === requestedActiveArrangementId)
                    ? requestedActiveArrangementId
                    : arrangements[0]!.id;
            arrangementStore.set({ arrangements, activeArrangementId });
            return;
        }
    }

    const arrangementMidi = hydrateMidiWithInlineNotes({
        midi: data.midi,
        tracks: data.arrangement.tracks,
    });

    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: {
                    tracks: hydrateArrangementTracks(data.arrangement.tracks),
                    selectedTrackId: null,
                },
                automation: data.automation ?? { lanes: [] },
                midi: arrangementMidi,
            },
        ],
        activeArrangementId: defaultArrangementId,
    });
}
