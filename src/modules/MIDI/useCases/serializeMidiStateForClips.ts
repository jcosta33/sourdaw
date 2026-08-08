import { midiStore } from '../stores/midiStore';

export function serializeMidiStateForClips(clipIds: readonly string[]): string {
    const state = midiStore.value;
    const clips: Record<string, unknown> = {};

    for (const clipId of clipIds) {
        clips[clipId] = {
            notes: {
                present: Object.hasOwn(state?.notesByClipId ?? {}, clipId),
                value: state?.notesByClipId[clipId] ?? [],
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
