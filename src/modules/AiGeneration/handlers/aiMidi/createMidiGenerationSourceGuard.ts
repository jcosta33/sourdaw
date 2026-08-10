import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';

type MidiNote = ReturnType<typeof getNotesForClip>[number];

type MidiGenerationSourceGuard = {
    clip: {
        id: string;
        name: string;
        startBeat: number;
        endBeat: number;
        type: string;
    };
    trackId: string;
    notes: MidiNote[];
    isCurrent: () => boolean;
};

function areMidiNotesEqual(alpha: MidiNote, beta: MidiNote): boolean {
    return (
        alpha.id === beta.id &&
        alpha.pitch === beta.pitch &&
        alpha.startBeat === beta.startBeat &&
        alpha.duration === beta.duration &&
        alpha.velocity === beta.velocity &&
        alpha.probability === beta.probability &&
        alpha.pressure === beta.pressure &&
        alpha.slide === beta.slide &&
        alpha.pitchBend === beta.pitchBend &&
        alpha.pitchBendRangeSemitones === beta.pitchBendRangeSemitones &&
        alpha.channel === beta.channel &&
        alpha.articulation === beta.articulation
    );
}

export function createMidiGenerationSourceGuard(clipId: string): MidiGenerationSourceGuard | null {
    const state = getTrackStoreState();
    const track = state?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (!track || !clip || clip.type !== 'midi') {
        return null;
    }

    const clipSnapshot = {
        id: clip.id,
        name: clip.name,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        type: clip.type,
    };
    const noteSnapshot = getNotesForClip(clipId).map((note) => ({ ...note }));

    return {
        clip: clipSnapshot,
        trackId: track.id,
        notes: noteSnapshot,
        isCurrent: () => {
            const currentState = getTrackStoreState();
            const currentTrack = currentState?.tracks.find((candidate) => candidate.id === track.id);
            const currentClip = currentTrack?.clips.find((candidate) => candidate.id === clipId);
            if (
                !currentClip ||
                currentClip.name !== clipSnapshot.name ||
                currentClip.startBeat !== clipSnapshot.startBeat ||
                currentClip.endBeat !== clipSnapshot.endBeat ||
                currentClip.type !== clipSnapshot.type
            ) {
                return false;
            }

            const currentNotes = getNotesForClip(clipId);
            if (currentNotes.length !== noteSnapshot.length) {
                return false;
            }

            return currentNotes.every((note, index) => areMidiNotesEqual(note, noteSnapshot[index]!));
        },
    };
}
