/**
 * Control room store — manages monitoring, cue mixes, and talkback state.
 *
 * Extracted from controlRoomUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';

export type MonitorOutput = {
    id: string;
    name: string;
    /** Gain offset in dB */
    gainDb: number;
    /** Is this the active monitor? */
    active: boolean;
    /** Speaker calibration offset in dB */
    calibrationDb: number;
};

export type CueMix = {
    id: string;
    name: string;
    /** Track → level mapping (trackId → gain 0-1) */
    trackLevels: Record<string, number>;
    /** Master cue level */
    masterLevel: number;
    /** Pan override for the cue mix */
    panOverride: Record<string, number>;
};

export type ControlRoomState = {
    /** Available monitor outputs */
    monitors: MonitorOutput[];
    /** Active monitor ID */
    activeMonitorId: string;
    /** Monitoring volume in dB */
    monitorVolume: number;
    /** Dim level in dB (applied when dim is active) */
    dimLevel: number;
    /** Is dim active? */
    dimActive: boolean;
    /** Is mono monitoring active? */
    monoActive: boolean;
    /** Is reference (bypass all master bus processing) active? */
    referenceActive: boolean;
    /** Talkback */
    talkbackActive: boolean;
    talkbackLevel: number;
    /** Cue mixes for headphone feeds */
    cueMixes: CueMix[];
    /** Active cue mix ID */
    activeCueId: string | null;
    /** Mute monitoring output */
    muted: boolean;
};

export function getNextMonitorId(): string {
    return `mon-${crypto.randomUUID()}`;
}

export function getNextCueId(): string {
    return `cue-${crypto.randomUUID()}`;
}

function createDefaultState(): ControlRoomState {
    const mainMonitor: MonitorOutput = {
        id: getNextMonitorId(),
        name: 'Main Speakers',
        gainDb: 0,
        active: true,
        calibrationDb: 0,
    };
    const altMonitor: MonitorOutput = {
        id: getNextMonitorId(),
        name: 'Alt Speakers',
        gainDb: 0,
        active: false,
        calibrationDb: 0,
    };

    return {
        monitors: [mainMonitor, altMonitor],
        activeMonitorId: mainMonitor.id,
        monitorVolume: -6,
        dimLevel: -20,
        dimActive: false,
        monoActive: false,
        referenceActive: false,
        talkbackActive: false,
        talkbackLevel: -12,
        cueMixes: [],
        activeCueId: null,
        muted: false,
    };
}

export const controlRoomStore = createStore<ControlRoomState>({
    initialData: createDefaultState(),
});
