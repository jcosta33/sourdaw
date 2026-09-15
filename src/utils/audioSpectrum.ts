/**
 * The audible spectrum: the 20 Hz…20 kHz bounds of average human hearing.
 * Shared by analysis and display code that maps audio content or frequency bins
 * onto a human-hearing scale. Device panels adopt these in a later wave; this
 * file is the single home they will adopt from.
 */

/** Lowest frequency average human hearing resolves, in hertz. */
export const MIN_AUDIBLE_FREQ_HZ = 20;

/** Highest frequency average human hearing resolves, in hertz. */
export const MAX_AUDIBLE_FREQ_HZ = 20_000;
