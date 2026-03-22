/**
 * Control Room Monitoring Section
 *
 * Multi-monitor output routing, cue mixes, talkback, reference
 * speaker switching, and dim/mono monitoring controls.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

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

let nextMonitorId = 1;
let nextCueId = 1;

function createDefaultState(): ControlRoomState {
    const mainMonitor: MonitorOutput = {
        id: `mon-${nextMonitorId++}`,
        name: 'Main Speakers',
        gainDb: 0,
        active: true,
        calibrationDb: 0,
    };
    const altMonitor: MonitorOutput = {
        id: `mon-${nextMonitorId++}`,
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

export const controlRoomStore = new Store<ControlRoomState>(logger, {
    initialData: createDefaultState(),
});

// ── Monitor Switching ─────────────────────────────────────────────────

export function switchMonitor(monitorId: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        activeMonitorId: monitorId,
        monitors: state.monitors.map((m) => ({ ...m, active: m.id === monitorId })),
    });
}

export function addMonitor(name: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    const monitor: MonitorOutput = {
        id: `mon-${nextMonitorId++}`,
        name,
        gainDb: 0,
        active: false,
        calibrationDb: 0,
    };

    controlRoomStore.set({
        ...state,
        monitors: [...state.monitors, monitor],
    });
}

export function calibrateMonitor(monitorId: string, calibrationDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        monitors: state.monitors.map((m) =>
            m.id === monitorId ? { ...m, calibrationDb } : m
        ),
    });
}

// ── Volume Controls ───────────────────────────────────────────────────

export function setMonitorVolume(volumeDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, monitorVolume: Math.max(-60, Math.min(6, volumeDb)) });
}

export function toggleDim(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, dimActive: !state.dimActive });
}

export function setDimLevel(levelDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, dimLevel: levelDb });
}

export function toggleMute(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, muted: !state.muted });
}

// ── Mono / Reference ──────────────────────────────────────────────────

export function toggleMono(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, monoActive: !state.monoActive });
}

export function toggleReference(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, referenceActive: !state.referenceActive });
}

// ── Talkback ──────────────────────────────────────────────────────────

export function toggleTalkback(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, talkbackActive: !state.talkbackActive });
}

export function setTalkbackLevel(levelDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, talkbackLevel: levelDb });
}

// ── Cue Mixes ─────────────────────────────────────────────────────────

export function createCueMix(name: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    const cue: CueMix = {
        id: `cue-${nextCueId++}`,
        name,
        trackLevels: {},
        masterLevel: 0.8,
        panOverride: {},
    };

    controlRoomStore.set({
        ...state,
        cueMixes: [...state.cueMixes, cue],
        activeCueId: state.activeCueId ?? cue.id,
    });
}

export function setCueTrackLevel(cueId: string, trackId: string, level: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        cueMixes: state.cueMixes.map((c) =>
            c.id === cueId
                ? { ...c, trackLevels: { ...c.trackLevels, [trackId]: level } }
                : c
        ),
    });
}

export function deleteCueMix(cueId: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        cueMixes: state.cueMixes.filter((c) => c.id !== cueId),
        activeCueId: state.activeCueId === cueId ? null : state.activeCueId,
    });
}

// ── Queries ───────────────────────────────────────────────────────────

export function getEffectiveVolume(): number {
    const state = controlRoomStore.value;
    if (!state) {
        return -6;
    }
    if (state.muted) {
        return -Infinity;
    }

    let volume = state.monitorVolume;
    if (state.dimActive) {
        volume += state.dimLevel;
    }

    // Add monitor calibration offset
    const activeMonitor = state.monitors.find((m) => m.id === state.activeMonitorId);
    if (activeMonitor) {
        volume += activeMonitor.calibrationDb;
    }

    return volume;
}
