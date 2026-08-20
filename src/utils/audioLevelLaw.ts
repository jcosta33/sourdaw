/**
 * Level laws: the shared dB ↔ linear-gain conversion, the fader ceiling, and
 * the send-control taper (FX-7).
 *
 * Two distinct things are easy to conflate here:
 *
 * - **Stored level** (`Send.level`, `Track.gain`) is, and stays, a **linear
 *   amplitude multiplier** — it is wire format written into project truth and
 *   handed straight to `GainNode.gain`. Nothing in this module changes what a
 *   stored value means, so existing projects render bit-identically; a
 *   project saved with `gain: 0.8` keeps `0.8`, and only what a control
 *   *displays* for that value can change.
 * - **Control position** is what a slider reports (0–100). Mapping that
 *   position linearly onto gain is the ergonomics defect FX-7 names: half the
 *   travel is spent between −6 dB and 0 dB, while the entire useful bottom of
 *   a send (−60 dB … −20 dB) is crushed into the last three steps. The taper
 *   below spends the travel evenly in **decibels** instead, which is what a
 *   first-class mixer does.
 *
 * Pan is deliberately absent. `StereoPannerNode` — used by both the live strip
 * and the offline strip — already implements the constant-power law in the
 * Web Audio spec's own rendering algorithm; the `pan / 50` seen at the call
 * sites is the unit conversion from this app's −50…+50 pan scale onto the
 * node's −1…+1 input, not a linear pan law. Replacing it with a hand-rolled
 * cos/sin pair would double-apply the taper and re-image every existing mix.
 */

/** Control travel below unity, in decibels. −60 dB is effectively silent. */
export const SEND_MIN_DB = -60;

/** Linear amplitude gain for a level in decibels. `dbToGain(0) === 1`. */
export function dbToGain(db: number): number {
    return 10 ** (db / 20);
}

/**
 * Decibels for a linear amplitude gain. Zero (and anything below it) has no
 * finite dB value, so it reports `-Infinity` rather than `NaN`.
 */
export function gainToDb(gain: number): number {
    if (gain <= 0) {
        return Number.NEGATIVE_INFINITY;
    }
    return 20 * Math.log10(gain);
}

/**
 * The shared fader dB readout: `-∞` at silence, one decimal everywhere else.
 * Every fader-style dB readout in the mixer (track strip, master strip)
 * formats through here rather than through its own arithmetic — a hand-rolled
 * formula per strip is how the track strip ended up reporting "0.0 dB" at a
 * gain of 0.8 (true value ≈ −1.9 dB) and the master strip disagreed with it
 * on a different wrong number.
 */
export function formatGainDb(gain: number): string {
    const db = gainToDb(gain);
    if (!Number.isFinite(db)) {
        return '-∞';
    }
    return db.toFixed(1);
}

/**
 * Headroom a fader allows above unity, in decibels. Every shipping DAW allows
 * some: Ableton Live and Logic stop at +6 dB, Pro Tools and Reaper go further,
 * to +12 dB. Sourdaw follows the conservative end of that convention.
 */
export const FADER_HEADROOM_DB = 6;

/**
 * The fader ceiling, as a linear amplitude multiplier: `+{@link
 * FADER_HEADROOM_DB} dB` of headroom above unity, not unity itself — a track
 * fader can produce make-up gain, the same as the reference DAWs above.
 *
 * This is a **product invariant, not an implementation detail** — every writer
 * of a track's fader gain must apply it, or a value the fader itself cannot
 * produce reaches the output. #789 found the first half of that divergence (a
 * stored gain above unity rendered louder on export than it ever played back)
 * and fixed the static strip gain; {@link clampFaderGain} is the shared law
 * both runtimes now route through, including gain *automation*, which
 * escaped the offline clamp because it writes the AudioParam directly rather
 * than through the strip's initial value.
 */
export const FADER_MAX_GAIN = dbToGain(FADER_HEADROOM_DB);

/**
 * Clamp a linear amplitude to the fader's range, `[0, {@link FADER_MAX_GAIN}]`.
 * The floor is a hard 0 — negative amplitude is a phase inversion, never a
 * level — and the ceiling is the fader's headroom, not unity.
 */
export function clampFaderGain(gain: number): number {
    if (!(gain > 0)) {
        return 0;
    }
    return Math.min(FADER_MAX_GAIN, gain);
}

/**
 * Maps a 0–100 send-control position onto the stored linear send level.
 *
 * Position 100 is unity (0 dB), position 0 is true silence, and everything
 * between is linear in dB across {@link SEND_MIN_DB}. Position 0 returns a
 * hard 0 rather than `dbToGain(-60)` so a closed send is actually closed —
 * `removeSend` semantics in the matrix key off `level > 0`.
 */
export function sendPositionToLevel(position: number): number {
    const clamped = Math.max(0, Math.min(100, position));
    if (clamped <= 0) {
        return 0;
    }
    return dbToGain(SEND_MIN_DB * (1 - clamped / 100));
}

/**
 * Inverse of {@link sendPositionToLevel}: the control position that displays a
 * stored linear send level. Levels above unity (which no control can produce,
 * but an imported project may carry) pin the control at the top rather than
 * running it off the end.
 */
export function levelToSendPosition(level: number): number {
    if (level <= 0) {
        return 0;
    }
    const db = gainToDb(level);
    const position = 100 * (1 - db / SEND_MIN_DB);
    return Math.max(0, Math.min(100, position));
}
