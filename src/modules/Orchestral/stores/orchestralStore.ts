/**
 * Orchestral instrument state store.
 * Holds the current patch, selected instrument, articulation state, and UI level.
 * Reactive — UI subscribes via useSyncExternalStore.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import {
    type OrchestraPatch,
    type ArticulationType,
    type MicPositionState,
    createDefaultPatch,
} from '../models/OrchestraPatch';
import {
    sendHumanizeToEngine,
    sendLegatoEnabledToEngine,
    sendMicParamToEngine,
} from '../useCases/orchestralParamBridge';

const logger = Container.getInstance().get(Logger);

export type OrchestraUiLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type OrchestraState = {
    patch: OrchestraPatch;
    uiLevel: OrchestraUiLevel;
    engineReady: boolean;
    activeVoices: number;
    peakL: number;
    peakR: number;
    currentArticulationDisplay: string;
};

export const orchestralStore = new Store<OrchestraState>(logger, {
    initialData: {
        patch: createDefaultPatch('violin-1'),
        uiLevel: 1,
        engineReady: false,
        activeVoices: 0,
        peakL: 0,
        peakR: 0,
        currentArticulationDisplay: 'Long',
    },
});

// ---------------------------------------------------------------------------
// State update functions
// ---------------------------------------------------------------------------

export function setOrchestraUiLevel(level: OrchestraUiLevel): void {
    const state = orchestralStore.value;
    if (state) {
        orchestralStore.set({ ...state, uiLevel: level });
    }
}

export function setOrchestraParam<K extends keyof OrchestraPatch>(
    key: K,
    value: OrchestraPatch[K],
): void {
    const state = orchestralStore.value;
    if (state) {
        orchestralStore.set({
            ...state,
            patch: { ...state.patch, [key]: value },
        });
    }
}

export function setCurrentArticulation(articulation: ArticulationType): void {
    const state = orchestralStore.value;
    if (state) {
        const entry = state.patch.articulations.find((a) => a.type === articulation);
        orchestralStore.set({
            ...state,
            patch: { ...state.patch, currentArticulation: articulation },
            currentArticulationDisplay: entry ? entry.name : articulation,
        });
    }
}

export function setMacro(index: number, value: number): void {
    const state = orchestralStore.value;
    if (state && index >= 0 && index < 8) {
        const macros = [...state.patch.macros] as OrchestraPatch['macros'];
        macros[index] = value;
        orchestralStore.set({
            ...state,
            patch: { ...state.patch, macros },
        });
    }
}

export function updateMicPosition(index: number, updates: Partial<MicPositionState>): void {
    const state = orchestralStore.value;
    if (state && index >= 0 && index < state.patch.micPositions.length) {
        const micPositions = state.patch.micPositions.map((mic, i) => {
            if (i === index) {
                return { ...mic, ...updates };
            }
            return mic;
        });
        orchestralStore.set({
            ...state,
            patch: { ...state.patch, micPositions },
        });
        // Forward to engine
        if (updates.volume !== undefined) {
            sendMicParamToEngine(index, 'volume', updates.volume);
        }
        if (updates.pan !== undefined) {
            sendMicParamToEngine(index, 'pan', updates.pan);
        }
        if (updates.enabled !== undefined) {
            sendMicParamToEngine(index, 'enabled', updates.enabled ? 1.0 : 0.0);
        }
    }
}

export function setHumanizeAmount(amount: number): void {
    const state = orchestralStore.value;
    if (state) {
        orchestralStore.set({
            ...state,
            patch: {
                ...state.patch,
                humanize: { ...state.patch.humanize, amount },
            },
        });
        sendHumanizeToEngine(amount);
    }
}

export function setLegatoEnabled(enabled: boolean): void {
    const state = orchestralStore.value;
    if (state) {
        orchestralStore.set({
            ...state,
            patch: {
                ...state.patch,
                legato: { ...state.patch.legato, enabled },
            },
        });
        sendLegatoEnabledToEngine(enabled);
    }
}

export function updateEngineMetrics(activeVoices: number, peakL: number, peakR: number): void {
    const state = orchestralStore.value;
    if (state) {
        orchestralStore.set({ ...state, activeVoices, peakL, peakR });
    }
}

export function setEngineReady(ready: boolean): void {
    const state = orchestralStore.value;
    if (state) {
        orchestralStore.set({ ...state, engineReady: ready });
    }
}
