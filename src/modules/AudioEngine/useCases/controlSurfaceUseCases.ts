/**
 * Control Surface Protocols
 *
 * MCU (Mackie Control Universal), OSC, and HUI protocol support
 * for hardware controller integration.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type ControlSurfaceProtocol = 'mcu' | 'osc' | 'hui';

export type McuFaderState = {
    /** 10-bit fader position (0-1023) */
    position: number;
    /** Track index this fader controls */
    trackIndex: number;
};

export type McuState = {
    /** 8 channel faders + 1 master */
    faders: McuFaderState[];
    /** Channel bank offset (which set of 8 channels is visible) */
    bankOffset: number;
    /** V-Pot ring positions (0-11) */
    vpots: number[];
    /** Active channel strip modes */
    mode: 'pan' | 'send' | 'plugin';
    /** Timecode display text */
    timecodeDisplay: string;
    /** Assignment display text */
    assignmentDisplay: string;
};

export type OscEndpoint = {
    id: string;
    host: string;
    sendPort: number;
    receivePort: number;
    active: boolean;
};

export type OscMapping = {
    oscAddress: string;
    actionType: string;
    /** Parameter path (e.g., 'track.0.gain') */
    parameterPath: string;
    /** Value range */
    min: number;
    max: number;
};

export type ControlSurfaceState = {
    /** Active protocol */
    protocol: ControlSurfaceProtocol | null;
    /** MCU state */
    mcu: McuState;
    /** OSC endpoints */
    oscEndpoints: OscEndpoint[];
    /** OSC address mappings */
    oscMappings: OscMapping[];
    /** Is the control surface connected? */
    connected: boolean;
};

export const controlSurfaceStore = new Store<ControlSurfaceState>(logger, {
    initialData: {
        protocol: null,
        mcu: {
            faders: Array.from({ length: 9 }, (_, i) => ({ position: 0, trackIndex: i })),
            bankOffset: 0,
            vpots: Array.from({ length: 8 }, () => 0),
            mode: 'pan',
            timecodeDisplay: '00:00:00:00',
            assignmentDisplay: 'PAN',
        },
        oscEndpoints: [],
        oscMappings: [],
        connected: false,
    },
});

// ── Protocol Selection ────────────────────────────────────────────────

export function setProtocol(protocol: ControlSurfaceProtocol | null): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({ ...state, protocol });
}

// ── MCU ───────────────────────────────────────────────────────────────

export function mcuSetFader(faderIndex: number, position: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const pos = Math.max(0, Math.min(1023, Math.round(position)));
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            faders: state.mcu.faders.map((f, i) => (i === faderIndex ? { ...f, position: pos } : f)),
        },
    });
}

export function mcuBankLeft(): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            bankOffset: Math.max(0, state.mcu.bankOffset - 8),
            faders: state.mcu.faders.map((f, i) => ({
                ...f,
                trackIndex: Math.max(0, state.mcu.bankOffset - 8) + i,
            })),
        },
    });
}

export function mcuBankRight(totalTracks: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const maxOffset = Math.max(0, totalTracks - 8);
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            bankOffset: Math.min(maxOffset, state.mcu.bankOffset + 8),
            faders: state.mcu.faders.map((f, i) => ({
                ...f,
                trackIndex: Math.min(maxOffset, state.mcu.bankOffset + 8) + i,
            })),
        },
    });
}

export function mcuSetMode(mode: McuState['mode']): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const displayMap = { pan: 'PAN', send: 'SND', plugin: 'PLG' } as const;
    controlSurfaceStore.set({
        ...state,
        mcu: { ...state.mcu, mode, assignmentDisplay: displayMap[mode] },
    });
}

export function mcuUpdateTimecode(bars: number, beats: number, ticks: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            timecodeDisplay: `${String(bars).padStart(3, '0')}:${String(beats).padStart(2, '0')}:${String(ticks).padStart(3, '0')}`,
        },
    });
}

// ── OSC ───────────────────────────────────────────────────────────────

let endpointId = 1;

export function addOscEndpoint(host: string, sendPort: number, receivePort: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscEndpoints: [...state.oscEndpoints, {
            id: `osc-${endpointId++}`, host, sendPort, receivePort, active: true,
        }],
    });
}

export function removeOscEndpoint(id: string): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscEndpoints: state.oscEndpoints.filter((e) => e.id !== id),
    });
}

export function addOscMapping(oscAddress: string, actionType: string, parameterPath: string, min: number = 0, max: number = 1): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscMappings: [...state.oscMappings, { oscAddress, actionType, parameterPath, min, max }],
    });
}

/**
 * Process an incoming OSC message and return the mapped action + value.
 */
export function processOscMessage(address: string, value: number): { actionType: string; parameterPath: string; normalizedValue: number } | null {
    const state = controlSurfaceStore.value;
    if (!state) {
        return null;
    }

    const mapping = state.oscMappings.find((m) => m.oscAddress === address);
    if (!mapping) {
        return null;
    }

    const range = mapping.max - mapping.min;
    const normalizedValue = range > 0 ? (value - mapping.min) / range : 0;

    return {
        actionType: mapping.actionType,
        parameterPath: mapping.parameterPath,
        normalizedValue: Math.max(0, Math.min(1, normalizedValue)),
    };
}

// ── Connection ────────────────────────────────────────────────────────

export function setConnected(connected: boolean): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({ ...state, connected });
}
