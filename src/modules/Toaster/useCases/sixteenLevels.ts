import { triggerToasterPad } from './triggerPad';
import { setToasterPadParam } from './toasterParamBridge/setToasterPadParam';
import { getFirstToasterDeviceId } from './toasterParamBridge/getFirstToasterDeviceId';

export type SixteenLevelsTarget = 'velocity' | 'tune' | 'decay' | 'filter';

let active = false;
let targetPad = 0;
let target: SixteenLevelsTarget = 'velocity';

export function enter16Levels(padIndex: number, paramTarget: SixteenLevelsTarget = 'velocity'): void {
    active = true;
    targetPad = padIndex;
    target = paramTarget;
}

export function exit16Levels(): void {
    active = false;
}

export function is16LevelsActive(): boolean {
    return active;
}

export function get16LevelsTarget(): { padIndex: number; target: SixteenLevelsTarget } {
    return { padIndex: targetPad, target };
}

export const trigger16LevelDependencies = {
    triggerToasterPad,
    getFirstToasterDeviceId,
    setToasterPadParam,
} as const;

export function trigger16Level(gridIndex: number): void {
    if (!active) {
        return;
    }

    const normalized = (gridIndex + 1) / 16; // 0.0625 to 1.0

    const deviceId = getFirstToasterDeviceId();

    switch (target) {
        case 'velocity':
            triggerToasterPad(targetPad, Math.round(normalized * 127));
            break;
        case 'tune':
            if (deviceId) {
                setToasterPadParam(deviceId, targetPad, 'tune', -24 + normalized * 48);
            }
            triggerToasterPad(targetPad, 127);
            break;
        case 'decay':
            if (deviceId) {
                setToasterPadParam(deviceId, targetPad, 'decay', normalized);
            }
            triggerToasterPad(targetPad, 127);
            break;
        case 'filter': {
            const minHz = 20;
            const maxHz = 20000;
            const freq = minHz * Math.pow(maxHz / minHz, normalized);
            if (deviceId) {
                setToasterPadParam(deviceId, targetPad, 'filterCutoff', freq);
            }
            triggerToasterPad(targetPad, 127);
            break;
        }
    }
}
