import { audioEngine } from '#/modules/AudioEngine/useCases';

import { resolveDeviceNode } from './resolveDeviceNode';

const CC_SUSTAIN_PEDAL = 64;
const CC_SOSTENUTO_PEDAL = 66;
const CC_UNA_CORDA_PEDAL = 67;
const PEDAL_LATCH_THRESHOLD = 64;

/** One physical pedal movement, addressed at one Grand Boule device. */
export type PedalMessage = Readonly<{
    trackId: string;
    deviceId: string;
    /**
     * Resolved controller number. Pedals are 64, 66 and 67 — above the 14-bit
     * range — so the resolved number and the raw one are the same.
     */
    cc: number;
    /** Position as the wire carries it: `0` through `127`. */
    value: number;
    /** The same position as the `0..1` fraction the Web Audio node takes. */
    normalized: number;
    /** MIDI channel the message arrived on: `0` through `15`. */
    channel: number;
}>;

export type PedalRouteDependencies = Readonly<{
    /** Whether the engine holds a body for this device, audible or shadowed. */
    isDeviceHeldByNativeSession: (trackId: string, deviceId: string) => boolean;
    /** The one sanctioned renderer route for a controller to a native body. */
    sendNativeLiveMidiControl: (input: {
        trackId: string;
        deviceId: string;
        controller: number;
        value: number;
        channel: number;
    }) => Promise<boolean>;
    /** Publishes the panel's pedal indicator, whichever carrier sounded it. */
    emitPedalCc: (payload: { deviceId: string; cc: number; value: number | boolean }) => void;
}>;

/**
 * Deliver one pedal movement to every Grand Boule body that exists for the
 * device, and announce it once.
 *
 * Both carriers, every time, rather than only the audible one. A device has a
 * Web Audio node whenever its strip is built and a native body whenever the
 * engine's chain holds it, and which of the two is *sounding* can change
 * between a press and its release — a session starting, stopping, or running
 * shadowed. A pedal is held state with no second message coming to clear it, so
 * a body that missed one half of the pair stays latched until something
 * unrelated happens to move that pedal again.
 *
 * A controller that is not one of the three pedals is not this route's
 * business, so the guard is here rather than at every caller.
 */
export function routePedalToBodies(pedal: PedalMessage, deps: PedalRouteDependencies): void {
    if (pedal.cc !== CC_SUSTAIN_PEDAL && pedal.cc !== CC_SOSTENUTO_PEDAL && pedal.cc !== CC_UNA_CORDA_PEDAL) {
        return;
    }

    writePedalToWebAudioNode(pedal);

    if (deps.isDeviceHeldByNativeSession(pedal.trackId, pedal.deviceId)) {
        // The raw 7-bit value, deliberately: the engine's own body divides CC64
        // by full scale and reads 66 and 67 against the switch threshold, so a
        // normalized fraction sent here would latch every pedal off.
        void deps.sendNativeLiveMidiControl({
            trackId: pedal.trackId,
            deviceId: pedal.deviceId,
            controller: pedal.cc,
            value: pedal.value,
            channel: pedal.channel,
        });
    }

    // Once per message: the foot moved once, and the panel draws one indicator
    // however many bodies took the movement.
    deps.emitPedalCc({
        deviceId: pedal.deviceId,
        cc: pedal.cc,
        value: pedal.cc === CC_SUSTAIN_PEDAL ? pedal.normalized : pedal.value >= PEDAL_LATCH_THRESHOLD,
    });
}

function writePedalToWebAudioNode(pedal: PedalMessage): void {
    const strip = audioEngine.getTrackStrip(pedal.trackId);
    const controls = resolveDeviceNode(strip, { deviceId: pedal.deviceId, type: 'grand-boule' })?.grandBouleControls;
    if (!controls?.ready) {
        return;
    }

    const engaged = pedal.value >= PEDAL_LATCH_THRESHOLD;
    if (pedal.cc === CC_SUSTAIN_PEDAL) {
        controls.setSustain(pedal.normalized);
    } else if (pedal.cc === CC_SOSTENUTO_PEDAL) {
        controls.setSostenuto(engaged);
    } else if (pedal.cc === CC_UNA_CORDA_PEDAL) {
        controls.setUnaCorda(engaged);
    }
}
