/**
 * Which pedals and controllers stored playback has left engaged, per device, so
 * a stop or a locate can release exactly those.
 *
 * A pedal is held state and no second message comes to clear it: a stop takes
 * the player's hands off the keys but the engine keeps the pedal where the last
 * move put it. A move that stored playback made must therefore not outlive the
 * playback that made it. Only moves the scheduler posts are recorded here, so a
 * pedal the user holds live is never in this record and never released by it.
 *
 * Module state, because the scheduler that records and the transport teardown
 * that releases are separate use cases sharing one process-wide playback.
 */

export type StoredControllerEngagement = {
    trackId: string;
    deviceId: string;
    deviceType: string;
    /** Controller numbers whose last stored move left them non-zero. */
    controllers: ReadonlySet<number>;
};

type MutableEngagement = { trackId: string; deviceId: string; deviceType: string; controllers: Set<number> };

const engagementByDevice = new Map<string, MutableEngagement>();

/** The identity one device's engagement is recorded under. */
export function storedControllerDeviceKey(trackId: string, deviceId: string): string {
    return JSON.stringify([trackId, deviceId]);
}

/** Record where a stored move left one controller on one device. */
export function noteStoredControllerMove(input: {
    trackId: string;
    deviceId: string;
    deviceType: string;
    controller: number;
    engaged: boolean;
}): void {
    const key = storedControllerDeviceKey(input.trackId, input.deviceId);
    const existing = engagementByDevice.get(key);
    if (!input.engaged) {
        existing?.controllers.delete(input.controller);
        if (existing && existing.controllers.size === 0) {
            engagementByDevice.delete(key);
        }
        return;
    }
    if (existing) {
        existing.controllers.add(input.controller);
        return;
    }
    engagementByDevice.set(key, {
        trackId: input.trackId,
        deviceId: input.deviceId,
        deviceType: input.deviceType,
        controllers: new Set([input.controller]),
    });
}

/** The controllers stored playback has left engaged on one device. */
export function readStoredControllerEngagement(trackId: string, deviceId: string): ReadonlySet<number> {
    return new Set(engagementByDevice.get(storedControllerDeviceKey(trackId, deviceId))?.controllers);
}

/** Every engagement recorded so far, leaving the record as it is. */
export function listStoredControllerEngagements(): StoredControllerEngagement[] {
    return Array.from(engagementByDevice.values(), (engagement) => ({
        ...engagement,
        controllers: new Set(engagement.controllers),
    }));
}

/** Every engagement recorded so far, forgetting it: the caller is about to release each one. */
export function takeStoredControllerEngagements(): StoredControllerEngagement[] {
    const taken = Array.from(engagementByDevice.values(), (engagement) => ({
        ...engagement,
        controllers: new Set(engagement.controllers),
    }));
    engagementByDevice.clear();
    return taken;
}

/** Drop every engagement without releasing it, for a teardown whose audio graph is already gone. */
export function forgetStoredControllerEngagements(): void {
    engagementByDevice.clear();
}
