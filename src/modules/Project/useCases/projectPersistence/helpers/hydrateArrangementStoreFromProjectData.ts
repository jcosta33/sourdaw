import { type ProjectData } from '../../../models/ProjectData';
import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { hydrateArrangementTracks } from '../fileIO/hydrateArrangementTracks';
import { hydrateProjectMidi } from '../fileIO/hydrateProjectMidi';

export function hydrateArrangementStoreFromProjectData(data: ProjectData): void {
    const arrangementMidi = hydrateProjectMidi(data.midi);

    for (const track of data.arrangement.tracks) {
        const clips = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)];
        for (const clip of clips) {
            if (!arrangementMidi.notesByClipId[clip.id] && clip.notes && clip.notes.length > 0) {
                arrangementMidi.notesByClipId[clip.id] = clip.notes;
            }
        }
    }

    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: {
                    tracks: hydrateArrangementTracks(data.arrangement.tracks),
                    selectedTrackId: null,
                },
                automation: data.automation,
                midi: arrangementMidi,
            },
        ],
        activeArrangementId: defaultArrangementId,
    });
}
