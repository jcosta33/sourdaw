/**
 * The last position of each held pedal (`HELD_PEDAL_CONTROLLERS`) the live
 * input sent, per zero-based MIDI channel, as the wire carried it.
 *
 * Singleton module alongside `channelControllerState.ts`, but with a different
 * lifetime: the pedal under the musician's foot is a fact about the physical
 * controller, so a transport stop, pause or seek leaves it standing and the next
 * take can begin with it down. It is dropped only when the input device is reset
 * or torn down, and per channel by Reset All Controllers, which lifts them all.
 */
export const heldPedalState = new Map<number, Map<number, number>>();
