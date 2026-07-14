import { type ProjectMidi, type ProjectTempoMap, type ProjectTimeSignatureMap } from '../../../models/ProjectData';
import { type ArrangementSnapshot, arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { loadSnapshot } from '../../arrangement/loadSnapshot';
import { hydrateArrangementTracks } from '../fileIO/hydrateArrangementTracks';
import { hydrateProjectMidi } from '../fileIO/hydrateProjectMidi';

import {
    type HydratableArrangementSnapshot,
    type HydratableProjectData,
    type HydratableProjectTrack,
} from './isHydratableProjectData';
import { resolveActiveArrangementSnapshot } from './resolveActiveArrangementSnapshot';

type HydrateMidiWithInlineNotesInput = {
    midi: ProjectMidi | undefined;
    tracks: readonly HydratableProjectTrack[];
};

type HydrateMidiWithInlineNotesOutput = ArrangementSnapshot['midi'];

function hydrateInlineMidiNotes(notes: ProjectMidi['notesByClipId'][string]): ProjectMidi['notesByClipId'][string] {
    return notes.map((note) => ({
        ...note,
        probability: note.probability ?? 100,
        pressure: note.pressure ?? 0,
        slide: note.slide ?? 0,
        pitchBend: note.pitchBend ?? 0,
    }));
}

function hydrateTempoMap(tempoMap: ProjectTempoMap | undefined): ArrangementSnapshot['tempoMap'] {
    if (!tempoMap) {
        return undefined;
    }
    return {
        changes: tempoMap.changes.map((change, index) => ({
            id: change.id ?? `tempo-${index}-${change.beat}`,
            beat: change.beat,
            tempo: change.tempo,
            curve: change.curve ?? 'instant',
        })),
    };
}

function hydrateTimeSignatureMap(
    timeSignatureMap: ProjectTimeSignatureMap | undefined
): ArrangementSnapshot['timeSignatureMap'] {
    if (!timeSignatureMap) {
        return undefined;
    }
    return {
        changes: timeSignatureMap.changes.map((change, index) => ({
            id: change.id ?? `time-signature-${index}-${change.beat}`,
            beat: change.beat,
            numerator: change.numerator,
            denominator: change.denominator,
        })),
    };
}

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
                arrangementMidi.notesByClipId[clip.id] = hydrateInlineMidiNotes(clip.notes);
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
    const useActiveFallback = snapshot.id === resolveActiveArrangementSnapshot(data)?.id;
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
        tempoMap: snapshot.tempoMap ?? (useActiveFallback ? hydrateTempoMap(data.tempoMap) : undefined),
        timeSignatureMap:
            snapshot.timeSignatureMap ??
            (useActiveFallback ? hydrateTimeSignatureMap(data.timeSignatureMap) : undefined),
        markers: snapshot.markers ?? (useActiveFallback ? { markers: data.markers ?? [], sections: [] } : undefined),
        takeLanes: snapshot.takeLanes ?? (useActiveFallback ? data.takeLanes : undefined),
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

        const fallbackArrangement = arrangements[0];
        if (fallbackArrangement) {
            const effectiveActiveArrangementId = resolveActiveArrangementSnapshot(data)?.id;
            const activeArrangement =
                arrangements.find((snapshot) => snapshot.id === effectiveActiveArrangementId) ?? fallbackArrangement;
            arrangementStore.set({ arrangements, activeArrangementId: activeArrangement.id });
            loadSnapshot(activeArrangement);
            return;
        }
    }

    const arrangementMidi = hydrateMidiWithInlineNotes({
        midi: data.midi,
        tracks: data.arrangement.tracks,
    });

    const arrangement: ArrangementSnapshot = {
        id: defaultArrangementId,
        name: 'Arrangement 1',
        tracks: {
            tracks: hydrateArrangementTracks(data.arrangement.tracks),
            selectedTrackId: null,
        },
        automation: data.automation ?? { lanes: [] },
        midi: arrangementMidi,
        tempoMap: hydrateTempoMap(data.tempoMap),
        timeSignatureMap: hydrateTimeSignatureMap(data.timeSignatureMap),
        markers: { markers: data.markers ?? [], sections: [] },
        takeLanes: data.takeLanes,
    };
    arrangementStore.set({
        arrangements: [arrangement],
        activeArrangementId: defaultArrangementId,
    });
    loadSnapshot(arrangement);
}
