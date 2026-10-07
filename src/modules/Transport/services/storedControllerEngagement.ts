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
    /** The controllers that are not pedals (a Levain CC1, CC7 or CC11) stored playback has posted a move for (a copy the caller owns). */
    controllers: Set<number>;
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
    { trackId: string; deviceId: string; deviceType: string; pedals: Set<number>; controllers: Set<number> }
>();

/** Record that stored playback posted a move to one device, and the pedal or other controller it moved. */
export function noteStoredControllerPost(
    device: StoredControllerDevice & { pedal?: number; controller?: number }
): void {
    const key = storedControllerDeviceKey(device.trackId, device.deviceId);
    const existing = postedDeviceByKey.get(key) ?? {
        trackId: device.trackId,
        deviceId: device.deviceId,
        deviceType: device.deviceType,
        pedals: new Set<number>(),
        controllers: new Set<number>(),
    };
    if (device.pedal !== undefined) {
        existing.pedals.add(device.pedal);
    }
    if (device.controller !== undefined) {
        existing.controllers.add(device.controller);
    }
    postedDeviceByKey.set(key, existing);
}

/** The pedals stored playback has moved on one device: the ones a relocation may have to lift. */
export function readStoredControllerPostedPedals(trackId: string, deviceId: string): ReadonlySet<number> {
    return new Set(postedDeviceByKey.get(storedControllerDeviceKey(trackId, deviceId))?.pedals);
}

/** The controllers that are not pedals stored playback has moved on one device: the ones a relocation may have to return to their default. */
export function readStoredControllerPostedControllers(trackId: string, deviceId: string): ReadonlySet<number> {
    return new Set(postedDeviceByKey.get(storedControllerDeviceKey(trackId, deviceId))?.controllers);
}

function copyPostedDevice(device: {
    trackId: string;
    deviceId: string;
    deviceType: string;
    pedals: Set<number>;
    controllers: Set<number>;
}): StoredControllerPostedDevice {
    return { ...device, pedals: new Set(device.pedals), controllers: new Set(device.controllers) };
}

/** Every device stored playback has posted to, leaving the record as it is. */
export function listStoredControllerPostedDevices(): StoredControllerPostedDevice[] {
    return Array.from(postedDeviceByKey.values(), copyPostedDevice);
}

/** Every device stored playback has posted to, forgetting them: the caller is about to drop each one's queued stored moves. */
export function takeStoredControllerPostedDevices(): StoredControllerPostedDevice[] {
    const taken = Array.from(postedDeviceByKey.values(), copyPostedDevice);
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

/** What kept a track's stored controllers from a window: the track's own mute, or a muted clip of it. */
export type StoredControllerWithholding = 'track-mute' | 'clip-mute';

/**
 * The tracks a mute kept from posting their stored controllers in a window of this
 * playback, per kind of mute. The moves of those windows were never sent, so the
 * device still holds what it last received, and the window that schedules the track
 * again owes it the value in force there. The two are kept apart because they end
 * apart: a track mute ends when the track schedules again, whatever muted clips it
 * has, while a clip mute ends only in a window no muted clip with a lane overlaps,
 * and a restore that ran while such a clip was still muted left that clip out. One
 * entry per track and kind, dropped when its restore runs and with the rest of this
 * record when playback stops or the scheduler is disposed.
 */
const withheldTrackIds: Record<StoredControllerWithholding, Set<string>> = {
    'track-mute': new Set<string>(),
    'clip-mute': new Set<string>(),
};

/** Record that a mute kept one track's stored controllers from a window. */
export function noteStoredControllersWithheld(trackId: string, by: StoredControllerWithholding): void {
    withheldTrackIds[by].add(trackId);
}

/** Whether this kind of mute has kept the track's stored controllers from a window since its last restore. */
export function hasStoredControllersWithheld(trackId: string, by: StoredControllerWithholding): boolean {
    return withheldTrackIds[by].has(trackId);
}

/** Forget that this kind of mute kept the track's stored controllers from a window: its restore is queued. */
export function forgetStoredControllersWithheld(trackId: string, by: StoredControllerWithholding): void {
    withheldTrackIds[by].delete(trackId);
}

/** Forget every track a mute kept stored controllers from: the playback that withheld them is over. */
export function forgetAllStoredControllersWithheld(): void {
    withheldTrackIds['track-mute'].clear();
    withheldTrackIds['clip-mute'].clear();
}

/** Drop every engagement without releasing it, for a teardown whose audio graph is already gone. */
export function forgetStoredControllerEngagements(): void {
    engagementByDevice.clear();
    postedDeviceByKey.clear();
    withheldTrackIds['track-mute'].clear();
    withheldTrackIds['clip-mute'].clear();
}
