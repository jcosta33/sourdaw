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
 * Pan appears here only as a unit conversion (`toStereoPan` /
 * `fromStereoPan`). `StereoPannerNode` — used by both the live strip and the
 * offline strip — already implements the constant-power law in the Web Audio
 * spec's own rendering algorithm; converting this app's −50…+50 pan scale onto
 * the node's −1…+1 input is not a pan law, and replacing it with a hand-rolled
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
 * How a dB readout renders its digits. The *law* — the conversion and the
 * `-∞` branch — never varies; only the presentation does.
 */
export type GainDbFormat = {
    /** Digits after the decimal point. Defaults to one. */
    fractionDigits?: number;
    /**
     * Drop trailing zeros, so a whole number reads as prose (`0 dB`) rather
     * than as a meter (`0.00 dB`). Defaults to `false`: a mixer readout wants
     * the fixed width so the number does not jitter as the fader moves, while
     * a sentence wants the short form.
     */
    trimTrailingZeros?: boolean;
};

/**
 * The shared fader dB readout: `-∞` at silence, one decimal everywhere else.
 * Every fader-style dB readout in the mixer (track strip, master strip)
 * formats through here rather than through its own arithmetic — a hand-rolled
 * formula per strip is how the track strip ended up reporting "0.0 dB" at a
 * gain of 0.8 (true value ≈ −1.9 dB) and the master strip disagreed with it
 * on a different wrong number.
 *
 * The AI confirmation prose formats through here too, at two trimmed
 * decimals. Its own copy of this arithmetic was a fourth statement of the
 * same law, free to drift from the three the mixer already shares — and a
 * confirmation sentence that disagrees with the strip the user is about to
 * look at is worse than no sentence.
 */
export function formatGainDb(gain: number, format: GainDbFormat = {}): string {
    const { fractionDigits = 1, trimTrailingZeros = false } = format;
    const db = gainToDb(gain);
    if (!Number.isFinite(db)) {
        return '-∞';
    }
    const fixed = db.toFixed(fractionDigits);
    return trimTrailingZeros ? String(Number(fixed)) : fixed;
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
 * {@link FADER_MAX_GAIN} as the decimal an LLM-facing schema advertises.
 *
 * A tool description that names a ceiling is a *contract with the model*, and
 * the model will not ask for a value it has been told is out of range. Every
 * such description therefore derives its number from here rather than typing
 * one: the literals this constant replaced still read `1.0` after the ceiling
 * moved to `+{@link FADER_HEADROOM_DB} dB`, so the widened acceptor was
 * unreachable from the tool path — the model asked for `1.0` and got unity
 * when the user asked for make-up gain.
 *
 * Three decimals, rounded down by truncation of the trailing digits, so the
 * advertised value is always one the acceptor honours.
 */
export const FADER_MAX_GAIN_LABEL = (Math.floor(FADER_MAX_GAIN * 1000) / 1000).toFixed(3);

/**
 * The range clause every fader-gain tool schema advertises, stating the real
 * contract rather than a ceiling of unity: the top of the travel, where unity
 * sits inside it, and the default a new track carries.
 */
export const FADER_GAIN_RANGE_DESCRIPTION = `0.0 to about ${FADER_MAX_GAIN_LABEL} (1.0 = unity, 0.8 = default)`;

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
 * Ceiling for a VCA group's own gain multiplier, before it folds into a
 * member track's fader. Deliberately **not** derived from {@link
 * FADER_HEADROOM_DB} — a VCA multiplier is not a fader position, and the
 * render fold already clamps the *composed* result to {@link
 * FADER_MAX_GAIN} regardless of how large the raw multiplier is
 * (`createOfflineTrackStrip.ts`'s `clampFaderGain(track.gain *
 * vcaMultiplier)`, `graph.rs`'s `folded.min(fader_max_gain())`). This is the
 * bound the engine's actual VCA write path enforces on the multiplier
 * itself — `setVcaGain.ts` clamps to this same constant — so any AI-facing
 * check of a raw VCA gain value matches it, rather than being either looser
 * than what a person can never reach or stricter than what a person's own
 * slider already allows.
 */
export const VCA_MAX_GAIN = 2;

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

/**
 * Top of the app's stored pan scale: control and stored pan positions run
 * −50 (full left) through 0 (center) to +50 (full right). `StereoPannerNode`
 * takes −1…+1, so every strip converts through {@link toStereoPan} /
 * {@link fromStereoPan} rather than restating the ratio — the live strip and
 * the offline strip must convert identically or a render re-images the mix.
 */
export const PAN_SCALE_MAX = 50;

/**
 * Convert a stored pan position (±{@link PAN_SCALE_MAX}) onto the −1…+1 input
 * a `StereoPannerNode` takes. Unit conversion only — the node applies the
 * constant-power pan law itself.
 */
export function toStereoPan(lanePan: number): number {
    return Math.max(-1, Math.min(1, lanePan / PAN_SCALE_MAX));
}

/**
 * Inverse of {@link toStereoPan}: the stored pan position a node's −1…+1 pan
 * value represents. Clamped to ±{@link PAN_SCALE_MAX} so an out-of-range node
 * value (an imported project, a stray automation write) cannot pin a control
 * past its travel.
 */
export function fromStereoPan(nodePan: number): number {
    return Math.max(-PAN_SCALE_MAX, Math.min(PAN_SCALE_MAX, nodePan * PAN_SCALE_MAX));
}

/**
 * Floor of every level *display*: a value at or below −60 dB renders as the
 * meter's empty state rather than as an ever-smaller number.
 *
 * Deliberately not `SEND_MIN_DB`, even though the two agree today. That
 * constant is a *stored-level* law — the bottom of a send control's travel in
 * dB — while this one only says how far down a readout bothers to draw. A
 * wider meter could move this floor without touching what a closed send
 * stores, and merging them would silently make that impossible.
 */
export const METER_FLOOR_DB = -60;
