/**
 * Arp pattern step model — per-step controls for the custom pattern editor.
 */

export type StepType = 'note' | 'rest' | 'tie' | 'chord' | 'random';

export type NoteSelector =
    | { type: 'next' }
    | { type: 'previous' }
    | { type: 'index'; index: number }
    | { type: 'random' }
    | { type: 'lowest' }
    | { type: 'highest' };

export type ArpStep = {
    active: boolean;
    stepType: StepType;
    noteSelector: NoteSelector;
    velocity: number; // 1-127
    velocityOverride: boolean; // if false, use source velocity
    gateMul: number; // 0.1-2.0 multiplier on base gate
    octaveOffset: number; // -3 to +3
    semitoneOffset: number; // -12 to +12
    probability: number; // 0.0-1.0
    ratchet: number; // 1-4 subdivisions within this step
};

export function defaultStep(): ArpStep {
    return {
        active: true,
        stepType: 'note',
        noteSelector: { type: 'next' },
        velocity: 100,
        velocityOverride: false,
        gateMul: 1.0,
        octaveOffset: 0,
        semitoneOffset: 0,
        probability: 1.0,
        ratchet: 1,
    };
}

export function createDefaultPattern(length: number): ArpStep[] {
    return Array.from({ length }, () => defaultStep());
}

// ── Projection codec ─────────────────────────────────────────────────────────

/**
 * The pattern travels to the Worker inside the numeric processor params, under
 * the `pattern_` prefix.
 *
 * `YeastProcessorProjectionItem.params` is `Record<string, number>`, and that
 * shape is load-bearing in three independent places: the Automerge codec drops
 * every non-finite-number param value (`normalizeProcessor`), the Worker
 * message validator rejects a projection whose params are not all numbers
 * (`isProjectionItem`), and `MidiRack.replaceProjection` forwards params
 * verbatim to `replaceParams`. Encoding into numbers therefore reaches the
 * audio thread, persists with the project, and replicates over CRDT without
 * widening any of those contracts. The precedent is `createYeastRuntimeProjection`,
 * which already flattens a groove template's offset arrays into
 * `groove_timing_<index>` / `groove_dynamics_<index>` numeric params.
 *
 * The encoding is SPARSE: a field equal to `defaultStep()`'s value is omitted
 * and restored on decode. That keeps a default pattern down to a single
 * `pattern_len` key instead of eleven keys per step in the CRDT document, and
 * it is what makes the format forward-compatible in both directions — a
 * projection written before this codec existed has no `pattern_len` and decodes
 * to the default pattern, and a field added to `ArpStep` later decodes to its
 * own default out of documents that predate it.
 */
export const ARP_PATTERN_PARAM_PREFIX = 'pattern_';
export const ARP_PATTERN_LENGTH_PARAM = 'pattern_len';

export const MIN_ARP_PATTERN_LENGTH = 1;
/** Bounds the CRDT cost of one pattern, and matches the editor's largest length preset. */
export const MAX_ARP_PATTERN_LENGTH = 32;
/** Length a projection without a stored pattern decodes to — the Arpeggiator's own initial pattern length. */
export const DEFAULT_ARP_PATTERN_LENGTH = 8;

const STEP_TYPES: readonly StepType[] = ['note', 'rest', 'tie', 'chord', 'random'];
const NOTE_SELECTOR_TYPES = ['next', 'previous', 'index', 'random', 'lowest', 'highest'] as const;
const MAX_NOTE_SELECTOR_INDEX = 127;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Clamp into range, falling back when the value is not a finite number (NaN, Infinity, undefined). */
function clampFinite(value: number | undefined, fallback: number, min: number, max: number): number {
    return value !== undefined && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function clampFiniteInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    return value !== undefined && Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
}

function sanitizeNoteSelector(selector: NoteSelector | undefined): NoteSelector {
    const type = NOTE_SELECTOR_TYPES.find((candidate) => candidate === selector?.type) ?? 'next';
    if (type === 'index') {
        return {
            type: 'index',
            index: clampFiniteInteger(
                (selector as { index?: number } | undefined)?.index,
                0,
                0,
                MAX_NOTE_SELECTOR_INDEX
            ),
        };
    }
    return { type };
}

/**
 * The single range table for a step, applied on BOTH sides of the codec.
 *
 * Encode must sanitize too, not just decode. A non-finite field is reachable
 * from the editor (a zero-height step cell makes the velocity pick divide by
 * zero), and `yeastWorker.isProjectionItem` rejects a whole `setProjection`
 * message whose params are not all finite numbers — so one NaN written into the
 * store would stop the ENTIRE rack from updating until reload, not just corrupt
 * one step. Sharing the table makes the channel symmetric by construction:
 * anything encode emits, decode returns unchanged.
 */
export function sanitizeArpStep(step: ArpStep | undefined): ArpStep {
    const base = defaultStep();
    return {
        active: step?.active !== false,
        stepType: STEP_TYPES.find((candidate) => candidate === step?.stepType) ?? base.stepType,
        noteSelector: sanitizeNoteSelector(step?.noteSelector),
        velocity: clampFiniteInteger(step?.velocity, base.velocity, 1, 127),
        velocityOverride: step?.velocityOverride === true,
        gateMul: clampFinite(step?.gateMul, base.gateMul, 0.1, 2.0),
        octaveOffset: clampFiniteInteger(step?.octaveOffset, base.octaveOffset, -3, 3),
        semitoneOffset: clampFiniteInteger(step?.semitoneOffset, base.semitoneOffset, -12, 12),
        probability: clampFinite(step?.probability, base.probability, 0, 1),
        ratchet: clampFiniteInteger(step?.ratchet, base.ratchet, 1, 4),
    };
}

function encodeNoteSelector(selector: NoteSelector): { selectorType: number; selectorIndex: number } {
    const selectorType = NOTE_SELECTOR_TYPES.indexOf(selector.type);
    return {
        selectorType: selectorType === -1 ? 0 : selectorType,
        selectorIndex: selector.type === 'index' ? selector.index : 0,
    };
}

function decodeNoteSelector(selectorType: number | undefined, selectorIndex: number | undefined): NoteSelector {
    const type = NOTE_SELECTOR_TYPES[clampFiniteInteger(selectorType, 0, 0, NOTE_SELECTOR_TYPES.length - 1)] ?? 'next';
    if (type === 'index') {
        return { type: 'index', index: clampFiniteInteger(selectorIndex, 0, 0, MAX_NOTE_SELECTOR_INDEX) };
    }
    return { type };
}

/** Clamp a requested step count into the range the codec can carry. */
export function clampArpPatternLength(length: number): number {
    if (!Number.isFinite(length)) {
        return DEFAULT_ARP_PATTERN_LENGTH;
    }
    return clamp(Math.round(length), MIN_ARP_PATTERN_LENGTH, MAX_ARP_PATTERN_LENGTH);
}

/** Encode a pattern as the `pattern_`-prefixed subset of a processor's params. */
export function encodeArpPatternParams(steps: readonly ArpStep[]): Record<string, number> {
    const length = clampArpPatternLength(steps.length);
    const params: Record<string, number> = { [ARP_PATTERN_LENGTH_PARAM]: length };
    const base = defaultStep();
    const baseSelector = encodeNoteSelector(base.noteSelector);
    for (let index = 0; index < length; index++) {
        // Sanitize BEFORE emitting: see `sanitizeArpStep`. An unsanitized NaN
        // here poisons the whole projection message, not just this step.
        const step = sanitizeArpStep(steps[index]);
        const selector = encodeNoteSelector(step.noteSelector);
        const put = (suffix: string, value: number, fallback: number): void => {
            if (value !== fallback) {
                params[`${ARP_PATTERN_PARAM_PREFIX}${index}_${suffix}`] = value;
            }
        };
        put('active', step.active ? 1 : 0, base.active ? 1 : 0);
        put('type', Math.max(0, STEP_TYPES.indexOf(step.stepType)), STEP_TYPES.indexOf(base.stepType));
        put('select', selector.selectorType, baseSelector.selectorType);
        put('select_index', selector.selectorIndex, baseSelector.selectorIndex);
        put('velocity', step.velocity, base.velocity);
        put('velocity_override', step.velocityOverride ? 1 : 0, base.velocityOverride ? 1 : 0);
        put('gate', step.gateMul, base.gateMul);
        put('octave', step.octaveOffset, base.octaveOffset);
        put('semitone', step.semitoneOffset, base.semitoneOffset);
        put('probability', step.probability, base.probability);
        put('ratchet', step.ratchet, base.ratchet);
    }
    return params;
}

/**
 * Decode the pattern a processor's params carry.
 *
 * Params reaching here come out of a CRDT any peer can write, so the decoded
 * step goes through the same `sanitizeArpStep` table the encoder uses rather
 * than being trusted. Params without `pattern_len` decode to the default
 * pattern.
 */
export function decodeArpPatternParams(params: Readonly<Record<string, number>> | undefined): ArpStep[] {
    const storedLength = params?.[ARP_PATTERN_LENGTH_PARAM];
    if (params === undefined || storedLength === undefined || !Number.isFinite(storedLength)) {
        return createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH);
    }
    const length = clampArpPatternLength(storedLength);
    const base = defaultStep();
    const steps: ArpStep[] = [];
    for (let index = 0; index < length; index++) {
        const read = (suffix: string): number | undefined => params[`${ARP_PATTERN_PARAM_PREFIX}${index}_${suffix}`];
        const readFlag = (suffix: string, fallback: boolean): boolean => {
            const value = read(suffix);
            return value === undefined || !Number.isFinite(value) ? fallback : value > 0.5;
        };
        steps.push(
            sanitizeArpStep({
                active: readFlag('active', base.active),
                stepType:
                    STEP_TYPES[
                        clampFiniteInteger(read('type'), STEP_TYPES.indexOf(base.stepType), 0, STEP_TYPES.length - 1)
                    ]!,
                noteSelector: decodeNoteSelector(read('select'), read('select_index')),
                velocity: clampFiniteInteger(read('velocity'), base.velocity, 1, 127),
                velocityOverride: readFlag('velocity_override', base.velocityOverride),
                gateMul: clampFinite(read('gate'), base.gateMul, 0.1, 2.0),
                octaveOffset: clampFiniteInteger(read('octave'), base.octaveOffset, -3, 3),
                semitoneOffset: clampFiniteInteger(read('semitone'), base.semitoneOffset, -12, 12),
                probability: clampFinite(read('probability'), base.probability, 0, 1),
                ratchet: clampFiniteInteger(read('ratchet'), base.ratchet, 1, 4),
            })
        );
    }
    return steps;
}

/** The `pattern_`-prefixed subset of a param record — the codec's own channel, isolated. */
export function extractArpPatternParams(params: Readonly<Record<string, number>> | undefined): Record<string, number> {
    return Object.fromEntries(
        Object.entries(params ?? {}).filter(([name]) => name.startsWith(ARP_PATTERN_PARAM_PREFIX))
    );
}

/** Drop every `pattern_`-prefixed key, so a shorter pattern cannot leave stale steps behind. */
export function stripArpPatternParams(params: Readonly<Record<string, number>> | undefined): Record<string, number> {
    return Object.fromEntries(
        Object.entries(params ?? {}).filter(([name]) => !name.startsWith(ARP_PATTERN_PARAM_PREFIX))
    );
}

/** Replace the pattern carried by a param record, leaving every other param untouched. */
export function withArpPatternParams(
    params: Readonly<Record<string, number>> | undefined,
    steps: readonly ArpStep[]
): Record<string, number> {
    return { ...stripArpPatternParams(params), ...encodeArpPatternParams(steps) };
}
