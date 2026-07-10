export type NoteRepeatSession = {
    deviceId: string;
    padIndex: number;
    velocity: number;
    timeoutId: ReturnType<typeof setTimeout>;
    nextTriggerTime: number;
    intervalSec: number;
};

// Keyed by deviceId so two Toaster instances can each hold an independent
// note-repeat without one stealing or stopping the other's session.
export const activeNoteRepeatSessions = new Map<string, NoteRepeatSession>();

// If the timer wakes more than this many intervals late (e.g. the tab was
// suspended in the background), don't try to replay every missed trigger.
export const MAX_NOTE_REPEAT_CATCHUP_INTERVALS = 2;
