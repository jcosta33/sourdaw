/**
 * The device-parameter lane the native export would silently drop, if any
 * (#3776).
 *
 * The native render stamps a lane only when it resolves, under the built-in
 * law, to a device on its strip. A lane that names a device the strip holds
 * but that does not resolve — a parameter the body cannot address, one the
 * declared law refuses, a legacy lane ambiguous between two devices — would
 * otherwise print a file with that lane missing, while the Web Audio render
 * may well carry it. So the export declines instead, and the caller's
 * fallback renders it through Web Audio with a warning; the live producer
 * names the same lanes as exclusions (`projectLiveAutomationWrites.ts`).
 *
 * An orphan lane — its device removed from the chain, which
 * `prepareRemoveDevice.ts` does without deleting the lane — names no device the
 * strip holds, and both engines already write nothing for it, so it declines
 * nothing. "Names a device the strip holds" is read the way the scheduler
 * resolves a lane (`resolveDeviceAutomationTargetIndex`): a canonical lane by
 * its owner's id, a legacy typed lane by its owner's type, and a bare legacy
 * lane by any device already holding that parameter key — the presence both
 * renderers' laws require before they admit it.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';

import { clipBoundsById } from './clipBoundsById';
import { deviceParameterLanes } from './deviceParameterLanes';
import { laneAddressesDevice } from './laneAddressesDevice';
import { type StripAutomationDeviceEntry } from './projectStripAutomationWrites';

function namesDeviceOnStrip(lane: AutomationLane, track: Track): boolean {
    const separatorIndex = lane.parameterId.indexOf(':');
    if (separatorIndex < 0) {
        return track.devices.some((device) => device.parameterValues[lane.parameterId] !== undefined);
    }
    const ownerId = lane.parameterId.slice(0, separatorIndex);
    return track.devices.some((device) => device.id === ownerId || device.type === ownerId);
}

export function nativeRefusedDeviceLane(input: {
    track: Track;
    lanes: readonly AutomationLane[];
    /** The devices on this strip the native render stamps, in chain order. */
    deviceEntries: readonly StripAutomationDeviceEntry[];
    law: OfflineDeviceAutomationLaw;
}): AutomationLane | null {
    const { track, lanes, deviceEntries, law } = input;
    // A strip reading no automation reads no device lane either.
    if (track.automationMode === 'off') {
        return null;
    }
    const laneById = new Map(lanes.map((lane): [string, AutomationLane] => [lane.id, lane]));
    const candidates = deviceParameterLanes({
        lanes,
        laneById,
        trackId: track.id,
        clipBounds: clipBoundsById(track),
    });
    return (
        candidates.find((lane) => namesDeviceOnStrip(lane, track) && !laneAddressesDevice(lane, deviceEntries, law)) ??
        null
    );
}
