/**
 * The whole-bar range a count-in or pre-roll may span. The Transport writers clamp into it, the saved
 * undo history admits only counts inside it, and the agent command schema publishes it, so all read
 * one definition.
 */
export const MIN_TRANSPORT_BARS = 1;
export const MAX_TRANSPORT_BARS = 8;
