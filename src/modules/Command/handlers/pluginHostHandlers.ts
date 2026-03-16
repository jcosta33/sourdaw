import type { ActionHandler } from "../models/ActionHandler";
import type { AppAction } from "../models/AppAction";
import { startPluginScan } from "#/modules/AudioEngine/useCases/pluginScanUseCases";
import { loadPlugin } from "#/modules/AudioEngine/useCases/pluginBridge";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import { addDevice } from "#/modules/Track/useCases/deviceUseCases";
import { findPluginByName } from "#/modules/AudioEngine/useCases/pluginScanUseCases";

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const pluginHostHandlers = {
    scanPlugins: {
        execute: async () => {
            await startPluginScan();
        },
        describe: () => ({ label: "Scan external plugins" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "scanPlugins">>,

    loadExternalPlugin: {
        execute: async (a) => {
            const { pluginId, trackId: providedTrackId } = a.payload;

            let trackId = providedTrackId;
            if (!trackId) {
                const plugin = findPluginByName(pluginId);
                const isInstrument = plugin?.category.toLowerCase() === "instrument";
                const newTrack = addTrack({
                    name: plugin?.name ?? "Plugin",
                    kind: isInstrument ? "midi" : "audio",
                });
                if (!newTrack) {
                    return;
                }
                trackId = newTrack.id;
            }

            const scanned = findPluginByName(pluginId);
            const pluginName = scanned?.name ?? pluginId;
            addDevice(trackId, pluginName);

            const instanceId = `${pluginId}-${String(Date.now())}`;
            await loadPlugin(pluginId, instanceId);
        },
        describe: (a) => ({ label: `Load external plugin "${a.payload.pluginId}"` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "loadExternalPlugin">>,
};
