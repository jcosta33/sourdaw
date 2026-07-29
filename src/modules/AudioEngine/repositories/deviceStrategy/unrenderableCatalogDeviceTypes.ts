/**
 * Catalog device ids the offline renderer genuinely cannot render — the only
 * device types an export refuses to produce a file for.
 *
 * ## Why a declared set rather than "anything that failed to build"
 *
 * Refusing on *every* unbuildable type fires far too widely. `addDevice` stores
 * an unmatched string verbatim as the device type, so factory presets that
 * added effects by display name wrote types like `Drum Comp` into projects.
 * That source is fixed, but hydration performs no type validation or migration,
 * so shipped `.sdaw` files still carry those strings — and a project that merely
 * *loaded* a preset would have become unexportable.
 *
 * The line is: refuse only when we would otherwise ship something the session
 * does not contain. A device type the product does not claim is silent in live
 * playback too — `TrackNode` returns without a node when no descriptor matches
 * it — so dropping it offline reproduces playback exactly. Refusing buys no
 * correctness there, and costs the user their export. A device the product
 * *does* claim and cannot render offline is the opposite case: it plays live and
 * would vanish (or, for an instrument, come back as the fallback synth) in the
 * file.
 *
 * ## Why this table is not a third hand-maintained list
 *
 * It is the same table `offlineDeviceCoverage.spec.ts` already owned, moved
 * here so the runtime gate and the guard read one source. That guard pins it
 * from both sides, against real product data:
 *
 * - Every catalog id that is *not* listed here and not node-less is built for
 *   real through the offline registry, and must not raise
 *   `UnsupportedDeviceTypeError`. A new catalog device with no offline path
 *   turns that suite red immediately.
 * - Every id listed here must still raise it, and must still be a real catalog
 *   id. An entry cannot rot into a permanent excuse or a stale string.
 *
 * `UnsupportedDeviceTypeError` is raised purely on type dispatch — a registry
 * miss, or a `builtin-` prefix match that resolves to no node — so the guard's
 * verdict for a given id is the runtime's verdict. Environment failures
 * (missing WASM asset, unavailable worklet, Faust compile error) are a
 * different class and stay degradable everywhere.
 */
const UNRENDERABLE_CATALOG_DEVICE_TYPES: Record<string, string> = {
    'builtin-crumbs':
        'Crumbs runs in the Rust backend behind the live `crumbs_*` Tauri commands. There is no WebAudio node and ' +
        'no offline bridge to the native engine, so no render path exists on either platform.',
    crust:
        'Crust is catalog-only: `addDevice` refuses to place it ("Crust is not fully implemented"), so it can ' +
        'never reach a track or a device chain.',
};

/** The declared ids, for the guard that pins this table against the catalog. */
export function getUnrenderableCatalogDeviceTypes(): Record<string, string> {
    return { ...UNRENDERABLE_CATALOG_DEVICE_TYPES };
}

/**
 * True when the product claims this device type and the offline renderer has no
 * path for it — the only case in which an export refuses rather than degrades.
 */
export function isUnrenderableCatalogDeviceType(deviceType: string): boolean {
    return UNRENDERABLE_CATALOG_DEVICE_TYPES[deviceType] !== undefined;
}
