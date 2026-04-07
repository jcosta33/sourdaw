/**
 * Control surface store — manages MCU/OSC/HUI protocol state.
 *
 * Extracted from controlSurfaceUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';

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

export const controlSurfaceStore = createStore<ControlSurfaceState>({
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

let endpointId = 1;

export function getNextOscEndpointId(): string {
    return `osc-${endpointId++}`;
}
