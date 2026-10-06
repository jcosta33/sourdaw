/** A reference is one song, not a session: the file and its decoded length are bounded before they are measured. */
export const AGENT_REFERENCE_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const AGENT_REFERENCE_MAX_DURATION_SECONDS = 20 * 60;
/** The display name is bounded; the planner never reads it. */
export const AGENT_REFERENCE_MAX_NAME_LENGTH = 128;
