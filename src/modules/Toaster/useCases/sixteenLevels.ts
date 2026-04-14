import { triggerToasterPad } from './triggerPad';
import { setToasterPadParam } from './toasterParamBridge/setToasterPadParam';
import { getFirstToasterDeviceId } from './toasterParamBridge/getFirstToasterDeviceId';

export type SixteenLevelsTarget = 'velocity' | 'tune' | 'decay' | 'filter';

// §167.x — 16-levels session state wrapped in a holder so HMR reloads
// drop the whole state atomically. Three independent let-bindings with
// cross-referenced semantics were the exact footgun §14.1 already
// addressed elsewhere.
const sixteenLevelsState: {
    active: boolean;
    targetPad: number;
    target: SixteenLevelsTarget;
} = {
    active: false,
    targetPad: 0,
    target: 'velocity',
};

export function enter16Levels(padIndex: number, paramTarget: SixteenLevelsTarget = 'velocity'): void {
    sixteenLevelsState.active = true;
    sixteenLevelsState.targetPad = padIndex;
    sixteenLevelsState.target = paramTarget;
}

export function exit16Levels(): void {
    sixteenLevelsState.active = false;
}

export function is16LevelsActive(): boolean {
    return sixteenLevelsState.active;
}

export function get16LevelsTarget(): { padIndex: number; target: SixteenLevelsTarget } {
    return { padIndex: sixteenLevelsState.targetPad, target: sixteenLevelsState.target };
}

export const trigger16LevelDependencies = {
    triggerToasterPad,
    getFirstToasterDeviceId,
    setToasterPadParam,
} as const;

export function trigger16Level(gridIndex: number): void {
    if (!sixteenLevelsState.active) {
        return;
    }

    const normalized = (gridIndex + 1) / 16; // 0.0625 to 1.0

    const deviceId = getFirstToasterDeviceId();
    const { targetPad, target } = sixteenLevelsState;

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
