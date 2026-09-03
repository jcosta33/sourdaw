/**
 * One `addNotes` command carries at most this many notes. The bound is a shared contract rather
 * than a planner convenience: it caps the schema the provider is shown, the bridge that admits a
 * provider call, and the owner that validates materialized arguments, so no route can accept a
 * batch the others would refuse. It lives here because the registry, the AI bridge, and the MIDI
 * owner all read it, and the two readers that are transformers may not import a use-case barrel.
 */
export const ADD_NOTES_MAX_NOTES_PER_COMMAND = 128;

/**
 * The shortest note a caller may ask for, in beats — a 64th note at common time. The same three
 * readers share it for the same reason they share the count bound: the schema the provider is
 * shown, the bridge that admits a provider call, and the owner that validates materialized
 * arguments must agree, or a note one route admits is a note another silently rewrites.
 */
export const MIDI_NOTE_MIN_DURATION_BEATS = 0.0625;
