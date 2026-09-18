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
    return formatDecibels(gainToDb(gain), format);
}

/**
 * The same readout for a figure that is already in decibels — a relative
 * change a command asked for, say, which has no linear amplitude behind it to
 * convert.
 */
export function formatDecibels(db: number, format: GainDbFormat = {}): string {
    const { fractionDigits = 1, trimTrailingZeros = false } = format;
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
 * Ceiling of a clip's own gain trim, as a linear amplitude multiplier: `+6 dB`
 * of make-up on the clip before the track fader sees it. `clampClipGain` and
 * every acceptor that advertises the clip ceiling read this one constant — a
 * schema that promised a ceiling the writer clamps below would hand the caller
 * a confirmation for a level it never stored.
 */
export const CLIP_MAX_GAIN = 2;

/**
 * The window one level control admits, stated in decibels.
 *
 * Levels are *stored* as linear amplitude, but a musician — and a planner
 * speaking for one — thinks in decibels: "bring the vocal down 2 dB", not
 * "multiply its amplitude by 0.794". A law is the bridge. It is deliberately
 * the same shape for every control so a caller states which control it is
 * writing rather than restating that control's arithmetic.
 *
 * `unity` is pinned at `1` rather than derived: every level in this app
 * references unity gain, and a law that could claim another reference would let
 * "0 dB" mean two things.
 */
export type LevelLaw = {
    /** Quietest level the control admits, in decibels. */
    floorDb: number;
    /** Loudest level the control admits, in decibels. */
    ceilingDb: number;
    /** The linear amplitude `0 dB` names. */
    unity: 1;
};

/**
 * Track and master faders. The ceiling is the fader's own headroom; the floor
 * is {@link SEND_MIN_DB}, because the fader control itself has no dB floor —
 * its travel is linear from a hard `0` (true silence), so there is no taper
 * constant to reuse. Below −60 dB a fader is inaudible under any programme
 * material, so a dB request past it is a mistake worth reporting rather than a
 * level worth storing; asking for silence stays available through the linear
 * form, which is what a fader dragged to the bottom writes.
 */
export const TRACK_FADER_LAW: LevelLaw = { floorDb: SEND_MIN_DB, ceilingDb: FADER_HEADROOM_DB, unity: 1 };

/** Clip gain trim: the same floor as a fader, {@link CLIP_MAX_GAIN} as its ceiling. */
export const CLIP_GAIN_LAW: LevelLaw = { floorDb: SEND_MIN_DB, ceilingDb: gainToDb(CLIP_MAX_GAIN), unity: 1 };

/**
 * Send levels. A send stops at unity — it taps a copy of the signal, it does
 * not amplify it — and bottoms out at {@link SEND_MIN_DB}, the bottom of the
 * send control's own travel.
 */
export const SEND_LEVEL_LAW: LevelLaw = { floorDb: SEND_MIN_DB, ceilingDb: 0, unity: 1 };

/**
 * How a caller asked for a level: as the stored linear amplitude, as an
 * absolute level in decibels, or as a change relative to where the level is now.
 */
export type LevelArgument = { linear: number } | { absoluteDb: number } | { deltaDb: number };

/** Either the linear amplitude to store, or why the request cannot be honoured. */
export type LevelResolution = { ok: true; linear: number } | { ok: false; reason: string };

function describeDb(db: number): string {
    return `${db.toFixed(1)} dB`;
}

function admitDb(db: number, law: LevelLaw): LevelResolution {
    if (!Number.isFinite(db)) {
        return { ok: false, reason: 'A level in decibels must be a finite number.' };
    }
    if (db < law.floorDb) {
        return { ok: false, reason: `${describeDb(db)} is below this control's floor of ${describeDb(law.floorDb)}.` };
    }
    if (db > law.ceilingDb) {
        return {
            ok: false,
            reason: `${describeDb(db)} is above this control's ceiling of ${describeDb(law.ceilingDb)}.`,
        };
    }
    return { ok: true, linear: dbToGain(db) };
}

/**
 * The linear amplitude a level request resolves to under one control's law.
 *
 * The linear form passes through untouched: it is already the stored
 * representation, and the writer that receives it applies the same clamp it has
 * always applied, so routing an existing linear caller through here cannot move
 * what it stores. Only the decibel forms are judged against the law, because
 * only they are new — and a rejected request must leave the store alone rather
 * than land on the nearest legal value, since a planner that asked for +12 dB
 * on a fader needs to learn the ceiling, not to silently get +6 dB.
 *
 * A relative change needs somewhere to start. A level already at silence has no
 * finite decibel value, so `deltaDb` against it is not a small edit but an
 * unanswerable question, and it is refused by name rather than treated as a
 * change from the floor.
 */
export function resolveLevelArgument(argument: LevelArgument, current: number, law: LevelLaw): LevelResolution {
    if ('linear' in argument) {
        if (!Number.isFinite(argument.linear)) {
            return { ok: false, reason: 'A linear level must be a finite number.' };
        }
        return { ok: true, linear: argument.linear };
    }
    if ('absoluteDb' in argument) {
        return admitDb(argument.absoluteDb, law);
    }
    if (!Number.isFinite(argument.deltaDb)) {
        return { ok: false, reason: 'A relative level change must be a finite number of decibels.' };
    }
    const currentDb = gainToDb(current);
    if (!Number.isFinite(currentDb)) {
        return {
            ok: false,
            reason: 'The current level is silent, so there is no level to change relative to; ask for an absolute level in decibels instead.',
        };
    }
    const resolved = admitDb(currentDb + argument.deltaDb, law);
    if (!resolved.ok) {
        return {
            ok: false,
            reason: `A change of ${describeDb(argument.deltaDb)} from ${describeDb(currentDb)} lands out of range: ${resolved.reason}`,
        };
    }
    return resolved;
}

/**
 * The law a linear-amplitude gain automation lane draws under.
 *
 * A lane carries its own bounds, and a gain lane written before the fader
 * widened carries narrower ones than a lane written after, so the window is
 * read off the lane rather than assumed. A bound at or below zero has no finite
 * decibel value; it reports the shared floor, because a lane that reaches true
 * silence is unbounded below in decibels and a caller needs a number it can act
 * on.
 */
export function gainLaneLevelLaw(bounds: { minValue: number; maxValue: number }): LevelLaw {
    return {
        floorDb: bounds.minValue > 0 ? gainToDb(bounds.minValue) : SEND_MIN_DB,
        ceilingDb: bounds.maxValue > 0 ? gainToDb(bounds.maxValue) : SEND_MIN_DB,
        unity: 1,
    };
}

/**
 * How a caller-facing schema states one control's decibel window.
 *
 * A tool description that names a bound is a contract with the model, and the
 * model will not ask for a value it has been told is out of range — so the
 * sentence is derived from the law rather than typed beside it, where the two
 * could drift.
 */
export function describeLevelLawDb(law: LevelLaw): string {
    const round = (db: number): string => String(Number(db.toFixed(1)));
    return `${round(law.floorDb)} dB (floor) to ${round(law.ceilingDb)} dB (ceiling); 0 dB is unity`;
}

/**
 * The linear amplitude one command payload's level fields resolve to.
 *
 * A payload states its level exactly once. Stating it twice is a contradiction
 * rather than a preference between two numbers, so it is refused instead of
 * settled by a precedence rule the caller cannot see; stating it not at all
 * leaves nothing to write.
 */
export function resolveLevelFields(
    fields: { linear?: number; absoluteDb?: number; deltaDb?: number },
    current: number,
    law: LevelLaw
): LevelResolution {
    const stated: LevelArgument[] = [];
    if (fields.linear !== undefined) {
        stated.push({ linear: fields.linear });
    }
    if (fields.absoluteDb !== undefined) {
        stated.push({ absoluteDb: fields.absoluteDb });
    }
    if (fields.deltaDb !== undefined) {
        stated.push({ deltaDb: fields.deltaDb });
    }
    const [argument] = stated;
    if (argument === undefined || stated.length > 1) {
        return {
            ok: false,
            reason: 'State the level exactly once: a linear amplitude, an absolute level in decibels, or a relative change in decibels.',
        };
    }
    return resolveLevelArgument(argument, current, law);
}

/**
 * The decibel figure a stored linear level reads as, or `null` when it has
 * none.
 *
 * Silence is the reason for the `null`: {@link gainToDb} answers `-Infinity`
 * for a level of zero, which is a real answer about the level but not a
 * number a reader can print, compare, or send over a wire. Reporting it as a
 * very low decibel figure instead would claim the level is audible.
 */
export function toLevelDb(linear: number): number | null {
    const db = gainToDb(linear);
    return Number.isFinite(db) ? db : null;
}

/**
 * The linear level a send payload asks for, whichever form it used.
 *
 * Every send level — on the command, in a planner projection, in a state
 * guard — answers to one law, so the conversion lives in one place rather
 * than being restated at each site that has to predict what a send write
 * lands on.
 */
export function resolveSendLevelFields(
    fields: { level?: number; levelDb?: number; deltaDb?: number },
    current: number
): LevelResolution {
    return resolveLevelFields(
        { linear: fields.level, absoluteDb: fields.levelDb, deltaDb: fields.deltaDb },
        current,
        SEND_LEVEL_LAW
    );
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

/**
 * EBU R 128 broadcast loudness target, also the common streaming delivery
 * level. The export normalizer aims here, the LUFS meter's over-target color
 * fires against it, and a reference-mix analysis defaults to it — one number,
 * so the meter does not flag a level the exporter just produced.
 */
export const R128_TARGET_LUFS = -14;

/** EBU R 128 recommends −1 dBTP true peak for lossy delivery. */
export const R128_CEILING_DB_TP = -1;

/**
 * Travel of every device-level gain trim — the input/output gain knobs and the
 * clamp their persisted patch values pass through on hydration. The devices
 * that carry one (Gluten, Bacteria, Proof today) all stop at ±24 dB: far
 * enough to rescue a quiet or hot source, narrow enough that a slip cannot
 * take a mix fully out. A panel knob and the hydrate clamp that disagrees
 * with it would let a stored value a control cannot reach reappear on reload,
 * so both read this pair.
 */
export const GAIN_TRIM_DB = { min: -24, max: 24 } as const;
