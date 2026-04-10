/**
 * 16 Levels mode — MPC-style performance feature.
 * Maps the entire 4×4 pad grid to 16 velocity/parameter levels of a single pad.
 * Grid position determines the parameter value (typically velocity, but configurable).
 */

import { inject } from '#/infra/di/inject';
import { triggerToasterPad } from './triggerPad';
import { setToasterPadParam, getFirstToasterDeviceId } from './toasterParamBridge';

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

/**
 * When in 16 Levels mode, hitting grid position `gridIndex` (0-15) triggers the
 * target pad at the mapped level. Grid is read left-to-right, top-to-bottom.
 * Position 0 = lowest level, position 15 = highest level.
 */
export const trigger16Level = inject(trigger16LevelDependencies)(
    ({ triggerToasterPad, getFirstToasterDeviceId, setToasterPadParam }) =>
        function trigger16Level(gridIndex: number): void {
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
);
