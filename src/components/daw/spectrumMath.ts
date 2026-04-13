/**
 * Shared spectrum-display math helpers.
 *
 * §12.1 — Three SpectrumAnalyzer components (Bacteria, Workspace/Metering,
 * Fermenter) each had their own copy of the log-frequency axis mapping and
 * dB→y mapping. The visual styles are deliberately different per feature
 * (in-line preview vs. live analyser vs. crossover overlay), so the
 * components stay distinct, but the math is the same.
 *
 * All helpers are pure — they do not touch Canvas2D, stores, or the DOM.
 */

const MIN_FREQ_HZ = 20;
const MAX_FREQ_HZ = 20_000;
const MIN_LOG = Math.log10(MIN_FREQ_HZ);
const MAX_LOG = Math.log10(MAX_FREQ_HZ);
const LOG_RANGE = MAX_LOG - MIN_LOG;

/**
 * Map a frequency in Hz to an x-pixel on a logarithmic axis.
 *
 * The default axis spans 20 Hz to 20 kHz. Callers reading from a live
 * AudioAnalyser should pass \`maxFreq = sampleRate/2\` so the axis
 * respects Nyquist at the current sample rate.
 */
export const freqToLogX = (
    freq: number,
    width: number,
    maxFreq: number = MAX_FREQ_HZ
): number => {
    const clamped = Math.max(MIN_FREQ_HZ, freq);
    const maxLog = maxFreq === MAX_FREQ_HZ ? MAX_LOG : Math.log10(maxFreq);
    const range = maxFreq === MAX_FREQ_HZ ? LOG_RANGE : maxLog - MIN_LOG;
    return ((Math.log10(clamped) - MIN_LOG) / range) * width;
};

/**
 * Map a dB value to a y-pixel within a display of \`height\` px, where
 * the top of the display is \`maxDb\` (default 0 dB) and the bottom is
 * \`minDb\` (default -60 dB). Out-of-range values clamp.
 */
export const dbToY = (db: number, height: number, minDb = -60, maxDb = 0): number => {
    const range = maxDb - minDb;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return height * (1 - (clamped - minDb) / range);
};

/**
 * Live-analyser variant: dB 0 at top, -80 at bottom, with 6 dB of
 * headroom above 0 dB so peaks don't clip to the top edge.
 */
export const dbToYLiveAnalyser = (db: number, height: number): number => dbToY(db, height, -80, 6);

/**
 * Canonical frequency marks for a log-scale spectrum grid.
 * Standard octave/decade breakpoints used by most DAW spectrum displays.
 */
export const STANDARD_FREQ_MARKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] as const;

/** Standard dB marks for spectrum display grids (top to bottom, 0 dB at top). */
export const STANDARD_DB_MARKS = [0, -12, -24, -36, -48, -60] as const;
