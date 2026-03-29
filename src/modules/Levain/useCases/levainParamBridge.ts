/**
 * Levain parameter bridge — throttled UI → audio communication.
 *
 * Follows the same pattern as fermenterParamBridge: caches active device
 * references, groups knob updates per rAF tick, and provides a clean API
 * for the presentation layer to update both the UI store and the audio engine.
 */

import { type LevainPatch } from '../models/LevainPatch';
import { levainStore, setLevainParam, setMacro } from '../stores/levainStore';

// ---------------------------------------------------------------------------
// Device reference cache
// ---------------------------------------------------------------------------

type LevainDevice = {
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
};

let activeDevice: LevainDevice | null = null;

export function registerLevainDevice(device: LevainDevice): void {
    activeDevice = device;
}

export function unregisterLevainDevice(): void {
    activeDevice = null;
    // Cancel any pending rAF callbacks.
    for (const rafId of pendingUpdates.values()) {
        cancelAnimationFrame(rafId);
    }
    pendingUpdates.clear();
    latestValues.clear();
}

function getDevice(): LevainDevice | null {
    return activeDevice;
}

// ---------------------------------------------------------------------------
// Throttled parameter updates (one rAF per param)
// ---------------------------------------------------------------------------

const latestValues = new Map<string, number>();
const pendingUpdates = new Map<string, number>();

function queueParam(rustKey: string, value: number): void {
    latestValues.set(rustKey, value);
    if (!pendingUpdates.has(rustKey)) {
        pendingUpdates.set(
            rustKey,
            requestAnimationFrame(() => flushParam(rustKey)),
        );
    }
}

function flushParam(key: string): void {
    pendingUpdates.delete(key);
    const value = latestValues.get(key);
    if (value === undefined) {
        return;
    }
    latestValues.delete(key);

    const device = getDevice();
    if (device) {
        device.setParam(key, value);
    }
}

/**
 * Set an levain parameter on both UI store and audio engine.
 * Audio updates are throttled to one per rAF per parameter.
 */
export function setLevainParamWithAudio<K extends keyof LevainPatch>(
    key: K,
    value: LevainPatch[K],
): void {
    // Update UI store immediately.
    setLevainParam(key, value);

    // Queue audio engine update.
    if (typeof value === 'number') {
        const rustKey = camelToSnake(key as string);
        queueParam(rustKey, value);
    } else if (typeof value === 'boolean') {
        const rustKey = camelToSnake(key as string);
        queueParam(rustKey, value ? 1.0 : 0.0);
    } else if (typeof value === 'object' && value !== null) {
        // Flatten object: send each numeric property as "parentKey_childKey"
        for (const [childKey, childVal] of Object.entries(value)) {
            if (typeof childVal === 'number') {
                const rustKey = camelToSnake(key as string) + '_' + camelToSnake(childKey);
                queueParam(rustKey, childVal);
            } else if (typeof childVal === 'boolean') {
                const rustKey = camelToSnake(key as string) + '_' + camelToSnake(childKey);
                queueParam(rustKey, childVal ? 1.0 : 0.0);
            }
        }
    }
}

/**
 * Set a macro knob value (0-1) on both UI and audio.
 * Macros map to predefined audio parameters.
 */
export function setMacroWithAudio(index: number, value: number): void {
    setMacro(index, value);

    const device = getDevice();
    if (!device) {
        return;
    }

    // Map macros to engine parameters.
    const state = levainStore.value;
    if (!state) {
        return;
    }

    const label = state.patch.macroLabels[index];
    switch (label) {
        case 'Dynamics':
            device.handleCc(1, Math.round(value * 127));
            break;
        case 'Expression':
            device.handleCc(11, Math.round(value * 127));
            break;
        case 'Vibrato':
            device.handleCc(2, Math.round(value * 127));
            break;
        case 'Tightness':
            device.setParam('humanize', 1.0 - value);
            break;
        case 'Space':
            // Blend close vs room mic positions.
            device.setParam('mic_0_volume', 1.0 - value * 0.5);
            device.setParam('mic_2_volume', value);
            break;
        case 'Tone':
            device.setParam('tone', value);
            break;
        case 'Attack':
            device.setParam('attack', value);
            break;
        case 'Release':
            device.setParam('release', value);
            break;
    }
}

/**
 * Send humanize amount directly to the engine.
 */
export function sendHumanizeToEngine(amount: number): void {
    const device = getDevice();
    if (device) {
        device.setParam('humanize', amount);
    }
}

/**
 * Send legato enabled state to the engine.
 */
export function sendLegatoEnabledToEngine(enabled: boolean): void {
    const device = getDevice();
    if (device) {
        device.setParam('legato_enabled', enabled ? 1.0 : 0.0);
    }
}

/**
 * Send mic position param to the engine.
 */
export function sendMicParamToEngine(micIndex: number, param: string, value: number): void {
    const device = getDevice();
    if (device) {
        device.setParam(`mic_${micIndex}_${param}`, value);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
