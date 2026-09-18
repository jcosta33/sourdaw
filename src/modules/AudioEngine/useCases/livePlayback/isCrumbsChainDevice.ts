/**
 * Whether this device type is the Crumbs sampler (#4204).
 *
 * Crumbs is the one device the mapper *splices* rather than builds or hosts:
 * `commands::crumbs` owns one engine instance per device, registered detached,
 * and `map_device` borrows it into the chain exactly as it borrows a hosted
 * plugin — under the device's own id, because that is the instance id the
 * renderer created it with. So it is absent from `nativeBuiltinBodies` on
 * purpose: the engine builds no Crumbs body, and a row there would promise one.
 *
 * The literal mirrors `CrumbsDescriptor`'s `id`, the value every Crumbs device
 * on a project carries, and the Rust mapper's own `CRUMBS_DEVICE_TYPE`
 * (`crates/sourdaw-native/src/commands/graph.rs`). Named here rather than
 * repeated, because two readings of "is this a Crumbs device" that could
 * disagree is how the carrier law comes to promise a strip the mapper refuses.
 */
export function isCrumbsChainDevice(deviceType: string): boolean {
    return deviceType === 'builtin-crumbs';
}
