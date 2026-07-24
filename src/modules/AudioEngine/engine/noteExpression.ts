/**
 * MPE per-note expression — the single engine-side contract (audit MD-2).
 *
 * Per-note expression is captured in two places that must not diverge: live
 * Web MIDI input (`handleWebMidi*`) and scheduled playback (`scheduleMidiNotes`).
 * Both normalise through this module and dispatch through
 * `applyNoteExpression`, so there is exactly one wire-unit conversion, one
 * device registry and one control-surface shape. Adding an expression-capable
 * instrument means adding it to {@link NOTE_EXPRESSION_DEVICE_CONTROLS} — the
 * live path, the scheduled path and the editor's availability surface all read
 * that same table.
 *
 * Wire units are the ones already stored on project truth and on live note
 * state; they are consumed, never renamed:
 *   • `pitchBend` — 14-bit signed offset, -8192..8191
 *   • `pressure`  — channel pressure, 0..127
 *   • `slide`     — timbre / CC74, 0..127
 */

import { type BuiltinDeviceNode } from '../models/AudioEngineState';

/** Per-note expression exactly as stored on a MIDI note or a live note record. */
export type NoteExpressionWireValues = {
    pitchBend?: number;
    pressure?: number;
    slide?: number;
};

/** Engine-facing units: semitones, 0..1 and bipolar -1..1. */
export type NoteExpressionEngineValues = {
    bendSemitones: number;
    pressure: number;
    slide: number;
};

/** MPE member-channel default pitch-bend range (MPE spec v1.0 §2.2). */
export const MPE_MEMBER_BEND_RANGE_SEMITONES = 48;

/**
 * Device types whose engine sounds per-note expression, mapped to the control
 * surface on their strip device node. This table is the single source of truth
 * for expression capability — do not maintain a parallel list.
 */
export const NOTE_EXPRESSION_DEVICE_CONTROLS = {
    fermenter: 'fermenterControls',
    levain: 'levainControls',
} as const satisfies Partial<Record<string, keyof BuiltinDeviceNode>>;

export type NoteExpressionDeviceType = keyof typeof NOTE_EXPRESSION_DEVICE_CONTROLS;

/** The method an expression-capable instrument node exposes. */
export type NoteExpressionControls = {
    noteExpression: (
        note: number,
        bendSemitones: number,
        pressure: number,
        slide: number,
        sampleFrame?: number
    ) => void;
};

/** True when any of the three MPE dimensions carries a value. */
export function hasNoteExpression(values: NoteExpressionWireValues | undefined): boolean {
    if (!values) {
        return false;
    }
    return values.pitchBend !== undefined || values.pressure !== undefined || values.slide !== undefined;
}

/**
 * Convert captured wire units to engine units. Missing dimensions resolve to
 * the neutral value, so a note carrying only pressure does not also reset a
 * bend the engine already holds to something audible.
 */
export function normalizeNoteExpression(
    values: NoteExpressionWireValues,
    bendRangeSemitones: number = MPE_MEMBER_BEND_RANGE_SEMITONES
): NoteExpressionEngineValues {
    const rawBend = values.pitchBend ?? 0;
    const bendSemitones = (Math.max(-8192, Math.min(8191, rawBend)) / 8192) * bendRangeSemitones;
    const pressure = Math.max(0, Math.min(127, values.pressure ?? 0)) / 127;
    // CC74 is unipolar 0..127 with 64 as the neutral rest position, so the
    // engine's bipolar timbre axis is centred there.
    const slide = values.slide === undefined ? 0 : (Math.max(0, Math.min(127, values.slide)) - 64) / 63;

    return { bendSemitones, pressure, slide };
}

/**
 * Resolve the expression control surface of the first expression-capable
 * instrument on a strip's device nodes, or `null` when the track's instrument
 * has no per-note expression path.
 */
export function resolveNoteExpressionControls(
    deviceNodes: readonly BuiltinDeviceNode[]
): NoteExpressionControls | null {
    for (const deviceNode of deviceNodes) {
        if (!Object.hasOwn(NOTE_EXPRESSION_DEVICE_CONTROLS, deviceNode.type)) {
            continue;
        }
        const controlsKey = NOTE_EXPRESSION_DEVICE_CONTROLS[deviceNode.type as NoteExpressionDeviceType];
        const controls: unknown = deviceNode[controlsKey];
        if (
            typeof controls === 'object' &&
            controls !== null &&
            'noteExpression' in controls &&
            typeof controls.noteExpression === 'function'
        ) {
            return controls as NoteExpressionControls;
        }
    }
    return null;
}
