import { type ToasterEngineMessage } from './projectToasterKitToEngineMessages';

/**
 * The name one Toaster control carries in a native `write-device-parameter`
 * record (#3124).
 *
 * `ToasterBody` (`crates/daw-engine/src/scheduler.rs`) has a single flat
 * namespace: a kit-level control arrives under the instrument's own name, and a
 * pad's control arrives with its index folded into the name as `pad<N>_<name>`,
 * which `toaster_pad_key` splits again on the other side. Both the whole-kit
 * projection and a single live edit have to spell that the same way, so the
 * composition is stated once here rather than at each producer.
 *
 * `delay_time` is deliberately not converted: a kit persists it in
 * milliseconds and the native body converts at its own door, the same
 * asymmetry `projectToasterKitToNativePatch` documents.
 */
export function toasterNativeParamName(message: ToasterEngineMessage): string {
    return message.type === 'param' ? message.name : `pad${message.pad}_${message.name}`;
}
