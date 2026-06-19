import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type PadState } from '../models/ToasterKit';
import { updatePad } from '../stores/toasterStore';

import { findDeviceRef } from './toasterParamBridge/helpers';
import { triggerToasterPad } from './triggerPad';

export type SixteenLevelsTarget = 'velocity' | 'tune' | 'decay' | 'filter';

type SixteenLevelsSession = {
    deviceId: string;
    padIndex: number;
    target: SixteenLevelsTarget;
};

// Keyed by deviceId so two Toaster instances can each enter 16-Levels on their
// own pad without sharing or stealing the other's session. The map's absence
// of a deviceId means "inactive" for that instance, so the active check and the
// field reads can never disagree.
const activeSessions = new Map<string, SixteenLevelsSession>();

export function enter16Levels(deviceId: string, padIndex: number, paramTarget: SixteenLevelsTarget = 'velocity'): void {
    activeSessions.set(deviceId, { deviceId, padIndex, target: paramTarget });
}

export function exit16Levels(deviceId: string): void {
    activeSessions.delete(deviceId);
}

export function is16LevelsActive(deviceId: string): boolean {
    return activeSessions.has(deviceId);
}

export function get16LevelsTarget(deviceId: string): SixteenLevelsSession | null {
    return activeSessions.get(deviceId) ?? null;
}

/**
 * Send a pad param straight to the worklet, bypassing the rAF coalescing in
 * setToasterPadParam. 16-Levels triggers the pad synchronously right after
 * setting the param, so a deferred (rAF) flush would make the first hit play
 * with the previous value and collapse multiple cells within one frame to the
 * latest value (Finding #48). The store is still updated so the UI stays in
 * sync, matching setToasterPadParam's store-then-worklet effect.
 */
function setPadParamImmediate(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    updatePad(deviceId, padIndex, { [key]: value } as Partial<PadState>);

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }
    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return;
    }
    const dn = strip.deviceNodes.find((data) => data.toasterControls && data.toasterControls.ready !== undefined);
    dn?.toasterControls?.setPadParam(padIndex, key, value);
}

export function trigger16Level(gridIndex: number, deviceId: string): void {
    const session = activeSessions.get(deviceId);
    if (!session) {
        return;
    }

    const normalized = (gridIndex + 1) / 16; // 0.0625 to 1.0

    const { padIndex: targetPad, target } = session;

    switch (target) {
        case 'velocity':
            triggerToasterPad(deviceId, targetPad, Math.round(normalized * 127));
            break;
        case 'tune':
            setPadParamImmediate(deviceId, targetPad, 'tune', -24 + normalized * 48);
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        case 'decay':
            setPadParamImmediate(deviceId, targetPad, 'decay', normalized);
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        case 'filter': {
            const minHz = 20;
            const maxHz = 20000;
            const freq = minHz * (maxHz / minHz) ** normalized;
            setPadParamImmediate(deviceId, targetPad, 'filterCutoff', freq);
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        }
    }
}
