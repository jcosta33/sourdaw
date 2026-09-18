/**
 * True for a device type the native engine hosts and sounds inline on its own
 * audio callback rather than through any Web Audio node — today only
 * `external-plugin` (see `TrackNode.ts` and the "External plugins are
 * engine-hosted" invariant in this module's `CLAUDE.md`).
 *
 * Kept separate from `isUnrenderableCatalogDeviceType` rather than folded into
 * its table: that table is catalog ids, cross-checked against the catalog in
 * both directions by `offlineDeviceCoverage.spec.ts`, and `external-plugin` is
 * not a catalog id — it is the device family whose real implementation lives
 * entirely on the native side. The offline `OfflineAudioContext` cannot host a
 * plugin instance (the native offline path maps against an empty instance
 * table by design), so there is no render path to build toward yet; refusing
 * is the honest behaviour until a bounce through the live engine exists.
 */
export function isEngineHostedPluginDeviceType(deviceType: string): boolean {
    return deviceType === 'external-plugin';
}
