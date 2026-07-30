import { describe, expect, it } from 'vitest';

import { getPlatformPlugins } from '#/modules/Arrangement/useCases';

import { devicePresets } from '../Device';
import { type PresetContext } from '../Types';

const context: PresetContext = {
    selectedTrackId: 'track-1',
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 1,
};

function deviceTypeFor(preset: (typeof devicePresets)[number]): string {
    const action = preset.buildAction(context);
    if (!action || Array.isArray(action) || action.type !== 'addDevice') {
        throw new Error(`Expected an addDevice action for ${preset.id}`);
    }
    return action.payload.deviceType;
}

describe('device palette presets', () => {
    // `addDevice` matches a plugin by name *or* id and, on a miss, stores the
    // string it was handed as the device type. A palette entry that names a
    // plugin the catalog does not carry under that spelling therefore mints a
    // device no descriptor matches: silent in playback, absent from a render.
    // Ids are also the only unambiguous key — `De-esser`, `LUFS Meter` and
    // `Stereo Widener` each name two catalog plugins.
    it('asks for a catalog plugin id, so every palette entry mints a device the engine can host', () => {
        const catalogIds = new Set(getPlatformPlugins().map((plugin) => plugin.id));

        const unresolved = devicePresets
            .map((preset) => ({ id: preset.id, deviceType: deviceTypeFor(preset) }))
            .filter((entry) => !catalogIds.has(entry.deviceType))
            .map((entry) => `${entry.id} -> ${entry.deviceType}`);

        expect(unresolved).toEqual([]);
    });
});
