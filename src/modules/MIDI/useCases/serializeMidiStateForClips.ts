import { type MidiNote } from '../models/MidiNote';
import { midiStore } from '../stores/midiStore';

export function serializeMidiStateForClips(
    clipIds: readonly string[],
    projectedNotesByClipId?: Readonly<Record<string, readonly MidiNote[]>>
): string {
    const state = midiStore.value;
    const notesByClipId = projectedNotesByClipId ?? state?.notesByClipId ?? {};
    const clips: Record<string, unknown> = {};

    for (const clipId of clipIds) {
        clips[clipId] = {
            notes: {
                present: Object.hasOwn(notesByClipId, clipId),
                value: notesByClipId[clipId] ?? [],
            },
            cc: {
                present: Object.hasOwn(state?.ccByClipId ?? {}, clipId),
                value: state?.ccByClipId[clipId] ?? [],
            },
            pitchBends: {
                present: Object.hasOwn(state?.pitchBendByClipId ?? {}, clipId),
                value: state?.pitchBendByClipId[clipId] ?? [],
            },
            migrated: state?.migratedAbsoluteNoteClipIds?.includes(clipId) ?? false,
        };
    }

    return JSON.stringify(clips);
}
