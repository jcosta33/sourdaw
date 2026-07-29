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
 * from both sides, against real product data — but the strength of the
 * *outward* side differs by device family, and it is worth being exact about
 * that rather than claiming a uniform "everything is built for real":
 *
 * - **WebAudio builtins** not listed here are built for real against a capable
 *   mock context and must hand back a node. This is a full check.
 * - **Native DSP devices** cannot be built off a real audio device (their
 *   `create` fetches wasm). The guard instead requires each to resolve in both
 *   `NATIVE_DSP_DEVICE_FACTORIES` and the live `wasmDeviceRegistry`, so a
 *   device claimed by one and not the other — the divergence that made
 *   GrandBoule silent in every device chain while playback was fine — cannot
 *   pass. It does not prove the wasm loads.
 * - **Faust devices** cannot be compiled under Node. The guard requires the
 *   catalog id to be registered in the Faust engine the app primes at startup.
 *   It does not prove the DSP compiles.
 * - **Every id listed here** must still raise `UnsupportedDeviceTypeError`, and
 *   must still be a real catalog id. An entry cannot rot into a permanent
 *   excuse or a stale string.
 *
 * So the honest summary of what this table's *absence* buys you: a new catalog
 * device wired to no factory at all, or to a WebAudio factory that does not
 * build, turns the suite red immediately. A new native or Faust device whose
 * engine is broken at runtime does not — that class degrades with a warning
 * rather than refusing, and is caught by the cross-registry checks only to the
 * extent that it shows up as a missing claim on one side.
 *
 * `UnsupportedDeviceTypeError` is raised purely on type dispatch — a registry
 * miss, or a `builtin-` prefix match that resolves to no node — so for any id
 * the guard *can* decide, its verdict is the runtime's verdict. Environment
 * failures (missing WASM asset, unavailable worklet, Faust compile error) are a
 * different class and stay degradable everywhere.
 */
export const UNRENDERABLE_CATALOG_DEVICE_TYPES: Readonly<Record<string, string>> = {
    'builtin-crumbs':
        'Crumbs runs in the Rust backend behind the live `crumbs_*` Tauri commands. There is no WebAudio node and ' +
        'no offline bridge to the native engine, so no render path exists on either platform.',
    crust:
        'Crust is catalog-only: `addDevice` refuses to place it ("Crust is not fully implemented"), so it can ' +
        'never reach a track or a device chain.',
};

/**
 * True when the product claims this device type and the offline renderer has no
 * path for it — the only case in which an export refuses rather than degrades.
 */
export function isUnrenderableCatalogDeviceType(deviceType: string): boolean {
    return UNRENDERABLE_CATALOG_DEVICE_TYPES[deviceType] !== undefined;
}
