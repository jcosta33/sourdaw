import { isDesktopExternalPluginRuntime } from '../../repositories/deviceStrategy/isDesktopExternalPluginRuntime';
import { readLoadedExternalInstanceIds } from '../livePlayback/readLoadedExternalInstanceIds';

import { type NativeOfflineHostedRuntime } from './nativeOfflineHostedDevice';
import { readScannedPluginKind } from './readScannedPluginKind';

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
