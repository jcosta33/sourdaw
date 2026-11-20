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
 * plugin instance, so the Web Audio render refuses a loaded one; the desktop
 * export's native render prints a loaded hosted effect through an offline
 * instance of its own (`nativeOfflineHostedDevice`, #4592).
 *
 * This is only the type half of that refusal. Whether a *given* device sounds
 * live is whether its instance is loaded on the desktop runtime, not its
 * type: an `external-plugin` device with nothing loaded — a duplicated
 * track, a track template — gets a unity pass-through from `TrackNode` and
 * is silent in playback too, so a render leaves it out and warns. A project
 * opened in the browser build ends up in the same place for a different
 * reason: its `loadPlugin` stub still resolves a `PluginInstance` and
 * `activateExternalPlugin` still writes a snapshot, but the desktop-runtime
 * gate excludes the browser build from ever treating that snapshot as live.
 * Callers pair this with `readLoadedExternalInstanceIds` and
 * `isDesktopRuntime`; see `buildDeviceChain`.
 */
export function isEngineHostedPluginDeviceType(deviceType: string): boolean {
    return deviceType === 'external-plugin';
}
