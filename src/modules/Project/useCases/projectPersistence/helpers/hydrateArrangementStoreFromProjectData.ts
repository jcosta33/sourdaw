import { type ProjectData, type ProjectMidi, type ProjectTrack } from '../../../models/ProjectData';
import { type ArrangementSnapshot, arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { hydrateArrangementTracks } from '../fileIO/hydrateArrangementTracks';
import { hydrateProjectMidi } from '../fileIO/hydrateProjectMidi';

type HydrateMidiWithInlineNotesInput = {
    midi: ProjectMidi | undefined;
    tracks: readonly ProjectTrack[];
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
        const clips = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)];
        for (const clip of clips) {
            if (!arrangementMidi.notesByClipId[clip.id] && clip.notes && clip.notes.length > 0) {
                arrangementMidi.notesByClipId[clip.id] = clip.notes;
            }
        }
    }

    return arrangementMidi;
}

type HydrateSavedArrangementOutput = ArrangementSnapshot | null;

function hydrateSavedArrangement(
    snapshot: NonNullable<ProjectData['arrangements']>[number]
): HydrateSavedArrangementOutput {
    if (!snapshot.tracks) {
        return null;
    }

    return {
        id: snapshot.id,
        name: snapshot.name,
        tracks: {
            tracks: hydrateArrangementTracks(snapshot.tracks.tracks),
            selectedTrackId: snapshot.tracks.selectedTrackId,
        },
        automation: snapshot.automation ?? { lanes: [] },
        midi: hydrateMidiWithInlineNotes({
            midi: snapshot.midi,
            tracks: snapshot.tracks.tracks,
        }),
        tempoMap: snapshot.tempoMap,
        timeSignatureMap: snapshot.timeSignatureMap,
        markers: snapshot.markers,
        takeLanes: snapshot.takeLanes,
    };
}

type HydratableProjectData = Omit<ProjectData, 'automation' | 'midi'> & {
    automation?: ProjectData['automation'];
    midi?: ProjectData['midi'];
};

type HydrateArrangementStoreFromProjectDataInput = {
    data: HydratableProjectData;
    preserveSavedArrangements?: boolean;
};

export function hydrateArrangementStoreFromProjectData({
    data,
    preserveSavedArrangements = false,
}: HydrateArrangementStoreFromProjectDataInput): void {
    if (preserveSavedArrangements && data.arrangements && data.arrangements.length > 0) {
        const arrangements = data.arrangements
            .map(hydrateSavedArrangement)
            .filter((snapshot): snapshot is ArrangementSnapshot => snapshot !== null);

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
