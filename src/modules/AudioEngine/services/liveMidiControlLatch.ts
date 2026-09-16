/**
 * Where every live pedal the renderer has sent is remembered, so a body the
 * engine builds later can be told the position the player's foot is actually in
 * (#3998).
 *
 * A pedal is held state with no second message coming to clear it. The engine
 * builds a native body at every session start and again at every chain rebuild,
 * always with its pedals up, and it never lifts one itself — a stop takes the
 * player's hands off the keys and leaves their foot where it was
 * (`AudioScheduler::release_sounding_notes`). So a damper pressed before play,
 * or held across a chain reorder, reaches a fresh body only if something on this
 * side remembers it. This is that memory; `replaceNativeChains` spends it onto
 * the bodies a whole-topology batch builds, and `mirrorDeviceChainDelta` spends
 * it inside the batch that rebuilds one strip mid-roll.
 *
 * Module state rather than a parameter for the reason
 * `nativeLiveGraphSessionState` is: the foot is one physical thing, and the
 * engine it is being mirrored onto is process-wide.
 *
 * Only the pedals are kept. A channel-mode message is an event rather than held
 * state — replaying All Sound Off onto a rebuilt body would silence a key the
 * player is still holding — so the only one that touches this record is Reset
 * All Controllers, which says every held controller is now released and
 * therefore discharges what is remembered for that device.
 */

const CC_SUSTAIN_PEDAL = 64;
const CC_SOSTENUTO_PEDAL = 66;
const CC_UNA_CORDA_PEDAL = 67;
const CC_RESET_ALL_CONTROLLERS = 121;

/** The pedals this record keeps. */
const LATCHED_CONTROLLERS: readonly number[] = [CC_SUSTAIN_PEDAL, CC_SOSTENUTO_PEDAL, CC_UNA_CORDA_PEDAL];

/** One remembered pedal position, addressed the way a graph command addresses one. */
export type LatchedLiveMidiControl = Readonly<{
    trackId: string;
    deviceId: string;
    /** Controller number, as the wire carries it. */
    controller: number;
    /** Controller position, as the wire carries it: `0` through `127`. */
    value: number;
    /** MIDI channel, as the engine addresses it: `0` through `15`. */
    channel: number;
}>;

const latchedByAddress = new Map<string, LatchedLiveMidiControl>();

function addressOf(trackId: string, deviceId: string, controller: number): string {
    return JSON.stringify([trackId, deviceId, controller]);
}

/**
 * Take note of one live controller the renderer is sending.
 *
 * A pedal replaces whatever was remembered for that device's controller, and a
 * Reset All Controllers forgets every pedal on that device: it is the message
 * that lifts them, so remembering them past it would press one back onto the
 * next body built.
 */
export function noteLiveMidiControl(control: LatchedLiveMidiControl): void {
    if (control.controller === CC_RESET_ALL_CONTROLLERS) {
        for (const controller of LATCHED_CONTROLLERS) {
            latchedByAddress.delete(addressOf(control.trackId, control.deviceId, controller));
        }
        return;
    }
    if (!LATCHED_CONTROLLERS.includes(control.controller)) {
        return;
    }
    latchedByAddress.set(addressOf(control.trackId, control.deviceId, control.controller), control);
}

/**
 * Every pedal position currently remembered, as a snapshot.
 *
 * A snapshot rather than the live map because the replay sends through the same
 * route that writes this record, so an iteration over the record itself would be
 * walking a collection its own body mutates.
 */
export function readLatchedLiveMidiControls(): readonly LatchedLiveMidiControl[] {
    return [...latchedByAddress.values()];
}
