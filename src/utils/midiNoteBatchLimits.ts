/**
 * One `addNotes` command carries at most this many notes. The bound is a shared contract rather
 * than a planner convenience: it caps the schema the provider is shown, the bridge that admits a
 * provider call, and the owner that validates materialized arguments, so no route can accept a
 * batch the others would refuse. It lives here because the registry, the AI bridge, and the MIDI
 * owner all read it, and the two readers that are transformers may not import a use-case barrel.
 */
export const ADD_NOTES_MAX_NOTES_PER_COMMAND = 128;
