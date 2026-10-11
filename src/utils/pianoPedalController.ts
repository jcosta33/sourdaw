import { clampMidiData7, MAX_MIDI_DATA_7BIT } from './midiData';

/**
 * Piano pedal controller law: which MIDI controllers are pedals, and how the
 * 7-bit wire value maps onto the position or latch a piano engine takes.
 * Named once because stored-clip playback in the browser scheduler and in the
 * offline render both turn a recorded controller into the same engine call.
 */

export const CC_SUSTAIN_PEDAL = 64;
export const CC_SOSTENUTO_PEDAL = 66;
export const CC_UNA_CORDA_PEDAL = 67;

/** The wire value at and above which a switch pedal (sostenuto, una corda) is engaged. */
const PEDAL_LATCH_THRESHOLD = 64;

/** The on/off switch controllers: sustain, portamento, sostenuto, soft, legato and hold 2. */
const FIRST_SWITCH_CONTROLLER = 64;
const LAST_SWITCH_CONTROLLER = 69;

/** Whether a controller change lets go of an on/off switch controller: a value below the latch threshold. */
export function isSwitchControllerRelease(controller: number, value: number): boolean {
    return (
        controller >= FIRST_SWITCH_CONTROLLER && controller <= LAST_SWITCH_CONTROLLER && value < PEDAL_LATCH_THRESHOLD
    );
}

type PianoPedalMove =
    /** Sustain is continuous: `position` is `0..1`, so half-pedal damps partially. */
    { pedal: 'sustain'; position: number } | { pedal: 'sostenuto' | 'unaCorda'; engaged: boolean };

/** The pedal move a controller change makes, or `null` for a controller that is not a pedal. */
export function resolvePianoPedalMove(controller: number, value: number): PianoPedalMove | null {
    if (controller === CC_SUSTAIN_PEDAL) {
        return { pedal: 'sustain', position: clampMidiData7(value) / MAX_MIDI_DATA_7BIT };
    }
    if (controller === CC_SOSTENUTO_PEDAL) {
        return { pedal: 'sostenuto', engaged: value >= PEDAL_LATCH_THRESHOLD };
    }
    if (controller === CC_UNA_CORDA_PEDAL) {
        return { pedal: 'unaCorda', engaged: value >= PEDAL_LATCH_THRESHOLD };
    }
    return null;
}

/** Whether a pedal move leaves its pedal down: any sustain position above zero, or a latched switch. */
export function isPianoPedalMoveEngaged(move: PianoPedalMove): boolean {
    return move.pedal === 'sustain' ? move.position > 0 : move.engaged;
}
