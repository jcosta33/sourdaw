import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { setNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud/setNotesForClip';
import { type Clip } from '#/modules/Arrangement/models/Track';

export function createAlternativeClips(
    originalClipId: string,
    variationsData: Array<Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>>
): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let targetTrack: any = null;
    let originalClip: Clip | null = null;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === originalClipId);
        if (clip) {
            targetTrack = track;
            originalClip = clip;
            break;
        }
    }

    if (!targetTrack || !originalClip) {
        return;
    }

    const clipDuration = originalClip.endBeat - originalClip.startBeat;
    const newClips: Clip[] = [];

    let currentStart = originalClip.endBeat;
    for (const [index, variation] of variationsData.entries()) {
        const newClipId = `clip-var-${crypto.randomUUID().slice(0, 8)}`;

        const globalNotes = variation.map((n) => ({
            id: `note-${crypto.randomUUID().slice(0, 8)}`,
            pitch: n.pitch,
            startBeat: currentStart + n.startBeat,
            duration: n.duration,
            velocity: n.velocity,
            probability: 100,
        }));

        setNotesForClip(newClipId, globalNotes);

        newClips.push({
            ...originalClip,
            id: newClipId,
            name: `${originalClip.name} (Var ${index + 1})`,
            startBeat: currentStart,
            endBeat: currentStart + clipDuration,
            muted: true,
        });

        currentStart += clipDuration;
    }

    updateTrack(targetTrack.id, (t) => ({
        ...t,
        clips: [...t.clips, ...newClips],
    }));
}
