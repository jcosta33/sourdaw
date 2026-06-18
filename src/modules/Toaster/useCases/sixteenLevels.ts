import { getFirstToasterDeviceId } from './toasterParamBridge/getFirstToasterDeviceId';
import { setToasterPadParam } from './toasterParamBridge/setToasterPadParam';
import { triggerToasterPad } from './triggerPad';

export type SixteenLevelsTarget = 'velocity' | 'tune' | 'decay' | 'filter';

type SixteenLevelsSession = {
    padIndex: number;
    target: SixteenLevelsTarget;
};

// One nullable binding replaces three loose fields that had to move
// together: a boolean active flag plus padIndex plus target. A single
// `Session | null` makes "inactive" the absence of a session, so the
// active check and the field reads can never disagree.
let activeSession: SixteenLevelsSession | null = null;

export function enter16Levels(padIndex: number, paramTarget: SixteenLevelsTarget = 'velocity'): void {
    activeSession = { padIndex, target: paramTarget };
}

export function exit16Levels(): void {
    activeSession = null;
}

export function is16LevelsActive(): boolean {
    return activeSession !== null;
}

export function get16LevelsTarget(): SixteenLevelsSession | null {
    return activeSession;
}

export function trigger16Level(gridIndex: number): void {
    const session = activeSession;
    if (!session) {
        return;
    }

    const normalized = (gridIndex + 1) / 16; // 0.0625 to 1.0

    const deviceId = getFirstToasterDeviceId();
    if (!deviceId) {
        return;
    }
    const { padIndex: targetPad, target } = session;

    switch (target) {
        case 'velocity':
            triggerToasterPad(deviceId, targetPad, Math.round(normalized * 127));
            break;
        case 'tune':
            if (deviceId) {
                setToasterPadParam(deviceId, targetPad, 'tune', -24 + normalized * 48);
            }
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        case 'decay':
            if (deviceId) {
                setToasterPadParam(deviceId, targetPad, 'decay', normalized);
            }
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        case 'filter': {
            const minHz = 20;
            const maxHz = 20000;
            const freq = minHz * (maxHz / minHz) ** normalized;
            if (deviceId) {
                setToasterPadParam(deviceId, targetPad, 'filterCutoff', freq);
            }
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        }
    }
}
