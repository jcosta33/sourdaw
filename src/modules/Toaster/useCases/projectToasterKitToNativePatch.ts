import { fromToasterKitState } from '../models/ToasterKitState';

import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';

export type ProjectToasterKitToNativePatchInput = {
    /** Project snapshot state; degrades to the default kit through `fromToasterKitState`. */
    deviceState: unknown;
};

/**
 * A Toaster's kit as the flat numeric record its native body applies to the
 * chain (#3124).
 *
 * The native engine's `ToasterBody` has no worklet in front of it — unlike the
 * web path, which posts `projectToasterKitToEngineMessages`' control writes at
 * a port one at a time — so a device's whole kit has to reach it as one record
 * inside the `write-device-parameter` batch, the same shape every other native
 * body's patch takes. Reusing the message projection rather than restating the
 * kit's fields here is what keeps the native and web kits from drifting apart:
 * `param` becomes the message's own name, already the engine's snake_case
 * spelling, and `padParam` gets the pad index folded into the name the way
 * `ToasterBody::set_pad_param` (`crates/daw-engine/src/scheduler.rs`) expects
 * it — `pad<N>_<name>`.
 *
 * `delay_time` is left in milliseconds, exactly as the message projection
 * states it. The worklet converts to seconds at its own door
 * (`toEngineKitParamValue`, `services/toasterProcessor.ts`) because
 * `StereoDelay::set_param` there consumes seconds; the native `ToasterBody`
 * accepts milliseconds directly at its own door instead, so this projection
 * must not perform that conversion a second time.
 */
export function projectToasterKitToNativePatch({
    deviceState,
}: ProjectToasterKitToNativePatchInput): Readonly<Record<string, number>> {
    const kit = fromToasterKitState(deviceState);
    const patch: Record<string, number> = {};
    for (const message of projectToasterKitToEngineMessages({ kit })) {
        if (message.type === 'param') {
            patch[message.name] = message.value;
        } else {
            patch[`pad${message.pad}_${message.name}`] = message.value;
        }
    }
    return patch;
}
