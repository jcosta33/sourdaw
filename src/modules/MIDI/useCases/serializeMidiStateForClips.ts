import { midiStore } from '../stores/midiStore';

export function serializeMidiStateForClips(clipIds: readonly string[]): string {
    const state = midiStore.value;
    const clips: Record<string, unknown> = {};

    for (const clipId of clipIds) {
        clips[clipId] = {
            notes: state?.notesByClipId[clipId] ?? [],
            cc: state?.ccByClipId[clipId] ?? [],
            pitchBends: state?.pitchBendByClipId[clipId] ?? [],
            migrated: state?.migratedAbsoluteNoteClipIds?.includes(clipId) ?? false,
        };
    }

    return JSON.stringify(clips);
}
