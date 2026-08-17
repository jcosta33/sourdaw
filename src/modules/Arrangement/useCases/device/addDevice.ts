import { logger } from '#/infra/logger/appLogger';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { compileFaustDSP } from '#/modules/PluginHost/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { isDeviceSupportedOnCurrentPlatform } from '../../models/DeviceParameter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';
import { getPlatformPlugins } from '../getPlatformPlugins';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

import { applyDeviceChainRuntimeDelta } from './applyDeviceChainRuntimeDelta';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * `deviceType` must be a catalog **id**. The lookup below also accepts a display
 * name, which is a trap: `De-esser`, `LUFS Meter` and `Stereo Widener` each name
 * two catalog plugins, and a name that matches nothing at all is stored verbatim
 * as the device type, producing a device no descriptor matches.
 *
 * `displayName` overrides the label this would otherwise take from the resolved
 * plugin. Presets need it — the type picks the device, the preset picks the
 * label — and it belongs in this call so the device is written once.
 *
 * Serialized preset callers supply their saved internal parameter subset.
 * Omitting it applies current defaults for a newly created device; passing an
 * empty object preserves legacy semantics for an unversioned preset.
 */
export function addDevice(
    trackId: string,
    deviceType: string,
    displayName?: string,
    deviceId?: string,
    deviceIndex?: number,
    initialInternalParameterValues?: Readonly<Record<string, number>>,
    options: { projectOnly?: boolean } = {}
): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }
    const matchingTracks = state.tracks.filter((candidate) => candidate.id === trackId);
    if (matchingTracks.length !== 1) {
        return null;
    }
    const resolvedDeviceId = deviceId ?? nextDeviceIdStr();
    if (state.tracks.some((candidate) => candidate.devices.some((device) => device.id === resolvedDeviceId))) {
        return null;
    }
    const track = matchingTracks[0];
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
        return null;
    }
    const insertionIndex = deviceIndex ?? track.devices.length;
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > track.devices.length) {
        return null;
    }

    // A device this runtime cannot host must not be half-placed.
    // `getPlatformPlugins()` below is platform-filtered, so in a
    // browser build a native-only id resolves to no plugin and falls into the
    // generic branch, writing a device with no parameters whose type is on the
    // export refusal table — the project then refuses to export over a device
    // that was never properly added. The helper passes unknown types through, so
    // external plugins and older projects' device strings are unaffected.
    if (!isDeviceSupportedOnCurrentPlatform(deviceType)) {
        notifyUser(`"${deviceType}" is not available on this platform and was not added.`, 'error');
        return null;
    }

    // Search by name first, then by ID — callers may pass either
    const plugin = getPlatformPlugins().find(
        (param1) => param1.name.toLowerCase() === deviceType.toLowerCase() || param1.id === deviceType
    );
    const internalParameterValues = initialInternalParameterValues ?? plugin?.internalParameterValues ?? {};
    const parameterValues: Record<string, number> = { ...internalParameterValues };
    if (plugin) {
        for (const param of plugin.parameters) {
            parameterValues[param.id] = param.value;
        }
    }

    const device: Device = {
        id: resolvedDeviceId,
        name: displayName ?? (plugin ? plugin.name : deviceType),
        type: plugin ? plugin.id : deviceType,
        bypassed: false,
        parameterValues,
    };

    const hadLiveStrip = shouldCreateLiveTrackStrip(track);
    const activatesFolderStrip = !hadLiveStrip && track.kind === 'folder' && device.type === 'toaster';
    const beforeTrack = structuredClone(track);
    const afterTrack = {
        ...track,
        devices: [...track.devices.slice(0, insertionIndex), device, ...track.devices.slice(insertionIndex)],
    };
    updateTrack(trackId, () => afterTrack);

    if (options.projectOnly) {
        return device;
    }

    if (!plugin) {
        return device;
    }

    if (activatesFolderStrip) {
        projectTrackToLiveStrip({ trackId, activateDormantExternalPlugins: true });
        for (const child of state.tracks) {
            if (child.parentId === trackId && shouldCreateLiveTrackStrip(child)) {
                projectTrackToLiveStrip({ trackId: child.id, activateDormantExternalPlugins: true });
            }
        }
        return device;
    }

    if (hadLiveStrip) {
        if (plugin.id.startsWith('faust-')) {
            Promise.resolve()
                .then(() => compileFaustDSP(plugin.id))
                .catch(() => {
                    // Faust compilation is best-effort — device falls back to passthrough
                });
        }
        const result = applyDeviceChainRuntimeDelta({
            before: beforeTrack,
            after: afterTrack,
            operation: 'add-device',
        });
        if (result.acceptance === 'rejected') {
            logger.warn(`[addDevice] Rejected runtime device delta for ${trackId}/${device.id}: ${result.reason}`);
            return device;
        }
        if (result.application === 'needs-reconcile') {
            logger.warn(
                `[addDevice] Runtime device delta needs reconciliation for ${trackId}/${device.id}: ${result.reason}`
            );
        }
        for (const [paramId, value] of Object.entries(device.parameterValues)) {
            updateDeviceParam(trackId, device.id, paramId, value);
        }
    }

    return device;
}
