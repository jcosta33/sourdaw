/**
 * Which hosted plugin devices the desktop export's native render prints (#4592).
 *
 * One answer read by both halves of that render, so they cannot disagree: the
 * engine selection (`selectOfflineRenderEngine`) admits a chain only when every
 * hosted device on it is a printable effect, and the programme
 * (`renderOfflineWithNativeEngine`) stamps parameter automation for exactly
 * the devices this admits. A selection that admitted a device the programme
 * left out would print it with its lanes missing.
 *
 * ── Loaded ──────────────────────────────────────────────────────────────
 *
 * The load test is `buildDeviceChain`'s own (`isHostedPluginInstanceLoaded`
 * against `readLoadedExternalInstanceIds`): a hosted device sounds in the
 * session exactly when its instance is loaded on the desktop runtime. One with
 * nothing loaded — a duplicated track, a template, a browser-build project —
 * is a unity pass-through live, and this answers `not-loaded` so the selection
 * keeps its earlier law for it. A loaded instance the engine has not attached
 * yet (loaded while parked) is admitted here too and refused by the native
 * mapper by device name; the export then falls back to Web Audio, whose chain
 * refuses a loaded hosted plugin by name, as before.
 *
 * ── Effect or instrument ────────────────────────────────────────────────
 *
 * The native side splices a hosted plugin as a generator exactly when the scan
 * recorded its category as `instrument`, and as an effect otherwise
 * (`chain_kind_for_category`, `crates/sourdaw-native/src/state.rs`); the
 * offline render refuses a generator. This reads the same scan answer from
 * `pluginScanStore`, so the two cannot disagree about what one plugin is. A
 * plugin the scan holds no record of answers `unknown`, which the selection
 * keeps off the native render rather than guess.
 */

import { type Device } from '#/modules/Arrangement/stores';
import { pluginScanStore } from '#/modules/PluginHost/stores';

import { isDesktopExternalPluginRuntime } from '../../repositories/deviceStrategy/isDesktopExternalPluginRuntime';
import { isEngineHostedPluginDeviceType } from '../../repositories/deviceStrategy/isEngineHostedPluginDeviceType';
import { isHostedPluginInstanceLoaded } from '../../repositories/deviceStrategy/isHostedPluginInstanceLoaded';
import { readLoadedExternalInstanceIds } from '../livePlayback/readLoadedExternalInstanceIds';

export type HostedPluginKind = 'effect' | 'instrument';

export type NativeOfflineHostedRuntime = Readonly<{
    /** Instance ids with a loaded parameter snapshot, as `buildDeviceChain` reads them. */
    loadedInstanceIds: ReadonlySet<string>;
    onDesktopRuntime: boolean;
    /** What the plugin scan recorded a plugin id as, or `null` when it holds no record of it. */
    pluginKind: (externalPluginId: string) => HostedPluginKind | null;
}>;

export type NativeOfflineHostedVerdict = 'not-loaded' | 'effect' | 'instrument' | 'unknown';

/** The scan's own split, mirrored from `chain_kind_for_category`. */
export function readScannedPluginKind(externalPluginId: string): HostedPluginKind | null {
    const plugin = pluginScanStore.value?.scannedPlugins.find((candidate) => candidate.id === externalPluginId);
    if (!plugin) {
        return null;
    }
    return plugin.category === 'instrument' ? 'instrument' : 'effect';
}

/** The live runtime, over a loaded-instance set the caller may have captured already. */
export function readNativeOfflineHostedRuntime(
    loadedInstanceIds: ReadonlySet<string> = readLoadedExternalInstanceIds()
): NativeOfflineHostedRuntime {
    return {
        loadedInstanceIds,
        onDesktopRuntime: isDesktopExternalPluginRuntime(),
        pluginKind: readScannedPluginKind,
    };
}

export function classifyNativeOfflineHostedDevice(
    device: Pick<Device, 'type' | 'externalPluginId' | 'externalInstanceId'>,
    runtime: NativeOfflineHostedRuntime
): NativeOfflineHostedVerdict {
    if (!isEngineHostedPluginDeviceType(device.type) || !isHostedPluginInstanceLoaded(device, runtime)) {
        return 'not-loaded';
    }
    const kind = device.externalPluginId === undefined ? null : runtime.pluginKind(device.externalPluginId);
    return kind ?? 'unknown';
}
