/**
 * 16 Levels mode — MPC-style performance feature.
 * Maps the entire 4×4 pad grid to 16 velocity/parameter levels of a single pad.
 * Grid position determines the parameter value (typically velocity, but configurable).
 */

import { triggerToasterPad } from './triggerPad';

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

/**
 * When in 16 Levels mode, hitting grid position `gridIndex` (0-15) triggers the
 * target pad at the mapped level. Grid is read left-to-right, top-to-bottom.
 * Position 0 = lowest level, position 15 = highest level.
 */
export function trigger16Level(gridIndex: number): void {
    if (!active) { return; }

    const normalized = (gridIndex + 1) / 16; // 0.0625 to 1.0

    switch (target) {
        case 'velocity':
            triggerToasterPad(targetPad, Math.round(normalized * 127));
            break;
        case 'tune':
        case 'decay':
        case 'filter':
            // For non-velocity targets, trigger at full velocity but vary the parameter
            // This requires sending a param change before triggering
            // For now, just vary velocity as the simplest implementation
            triggerToasterPad(targetPad, Math.round(normalized * 127));
            break;
    }
}
