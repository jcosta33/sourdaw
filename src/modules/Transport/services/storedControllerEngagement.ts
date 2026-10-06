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

export type StoredControllerDevice = { trackId: string; deviceId: string; deviceType: string };

export type StoredControllerPostedDevice = StoredControllerDevice & {
    /** The pedal controllers stored playback has posted a move for, whatever the move was (a copy the caller owns). */
    pedals: Set<number>;
};

/**
 * Every device stored playback has posted any move to, engaged or not, and which
 * pedals it moved there.
 *
 * Engagement alone cannot say what a relocation or a stop must clean up. A lift
 * still waiting for its frame has already cleared the pedal's engagement in the
 * record, yet the engine has not applied it: if the queued lift is dropped the
 * pedal stays down, so the pedal must be lifted whatever the last posted move
 * was. And a Levain CC1 or CC11 move never sets an engagement, yet may be queued:
 * the device must be reached to drop it.
 */
const postedDeviceByKey = new Map<
    string,
    { trackId: string; deviceId: string; deviceType: string; pedals: Set<number> }
>();

/** Record that stored playback posted a move to one device, and the pedal it moved if it was one. */
export function noteStoredControllerPost(device: StoredControllerDevice & { pedal?: number }): void {
    const key = storedControllerDeviceKey(device.trackId, device.deviceId);
    const existing = postedDeviceByKey.get(key) ?? {
        trackId: device.trackId,
        deviceId: device.deviceId,
        deviceType: device.deviceType,
        pedals: new Set<number>(),
    };
    if (device.pedal !== undefined) {
        existing.pedals.add(device.pedal);
    }
    postedDeviceByKey.set(key, existing);
}

/** The pedals stored playback has moved on one device: the ones a relocation may have to lift. */
export function readStoredControllerPostedPedals(trackId: string, deviceId: string): ReadonlySet<number> {
    return new Set(postedDeviceByKey.get(storedControllerDeviceKey(trackId, deviceId))?.pedals);
}

/** Every device stored playback has posted to, leaving the record as it is: a relocation restores from it. */
export function listStoredControllerPostedDevices(): StoredControllerPostedDevice[] {
    return Array.from(postedDeviceByKey.values(), (device) => ({ ...device, pedals: new Set(device.pedals) }));
}

/** Every device stored playback has posted to, forgetting them: the caller is about to drop each one's queued stored moves. */
export function takeStoredControllerPostedDevices(): StoredControllerPostedDevice[] {
    const taken = Array.from(postedDeviceByKey.values(), (device) => ({ ...device, pedals: new Set(device.pedals) }));
    postedDeviceByKey.clear();
    return taken;
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
    postedDeviceByKey.clear();
}
