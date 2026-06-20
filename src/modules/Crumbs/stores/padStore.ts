/**
 * Pad grid state store for Drum mode.
 * Holds per-pad configuration and selection.
 */

import { createStore } from '#/infra/store/createStore';

import {
    type PadChannelStrip,
    type PadConfig,
    createDefaultChannelStrip,
    createDefaultPad,
    DEFAULT_PAD_COUNT,
} from '../models/CrumbsTypes';

export type PadState = {
    pads: PadConfig[];
    channelStrips: PadChannelStrip[];
    selectedPadIndex: number;
};

export const defaultPadState: PadState = {
    pads: Array.from({ length: DEFAULT_PAD_COUNT }, (_, i) => createDefaultPad(i)),
    channelStrips: Array.from({ length: DEFAULT_PAD_COUNT }, () => createDefaultChannelStrip()),
    selectedPadIndex: 0,
};

export const padStore = createStore<Record<string, PadState>>({
    initialData: {},
});

export function ensurePadInstance(instanceId: string): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        if (s[instanceId]) {
            return s;
        }
        return { ...s, [instanceId]: { ...defaultPadState } };
    });
}

export function selectPad(instanceId: string, index: number): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst || index < 0 || index >= inst.pads.length) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...inst, selectedPadIndex: index },
        };
    });
}

export function updatePad(instanceId: string, index: number, updates: Partial<PadConfig>): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        const existing = inst?.pads[index];
        if (!inst || !existing) {
            return s;
        }
        const pads = [...inst.pads];
        pads[index] = { ...existing, ...updates };
        return {
            ...s,
            [instanceId]: { ...inst, pads },
        };
    });
}

export function assignSampleToPad(instanceId: string, index: number, sampleId: number, name: string): void {
    updatePad(instanceId, index, { sampleId, name });
}

export function resetPad(instanceId: string, index: number): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        const pads = [...inst.pads];
        const channelStrips = [...inst.channelStrips];
        pads[index] = createDefaultPad(index);
        channelStrips[index] = createDefaultChannelStrip();
        return {
            ...s,
            [instanceId]: { ...inst, pads, channelStrips },
        };
    });
}

export function updateChannelStrip(instanceId: string, index: number, updates: Partial<PadChannelStrip>): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        const existing = inst?.channelStrips[index];
        if (!inst || !existing) {
            return s;
        }
        const channelStrips = [...inst.channelStrips];
        channelStrips[index] = { ...existing, ...updates };
        return {
            ...s,
            [instanceId]: { ...inst, channelStrips },
        };
    });
}

export function reorderPad(instanceId: string, fromIndex: number, toIndex: number): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        // pads and channelStrips move together — a reorder that mutated only the
        // one array would desync the strip from its pad. Refuse to reorder unless
        // both arrays agree on length so the splice below is index-safe on both.
        if (inst.pads.length !== inst.channelStrips.length) {
            return s;
        }
        if (fromIndex < 0 || fromIndex >= inst.pads.length) {
            return s;
        }
        if (toIndex < 0 || toIndex >= inst.pads.length) {
            return s;
        }
        if (fromIndex === toIndex) {
            return s;
        }

        const pads = [...inst.pads];
        const channelStrips = [...inst.channelStrips];
        const movedPad = pads[fromIndex];
        const movedStrip = channelStrips[fromIndex];
        if (!movedPad || !movedStrip) {
            return s;
        }
        pads.splice(fromIndex, 1);
        channelStrips.splice(fromIndex, 1);
        pads.splice(toIndex, 0, movedPad);
        channelStrips.splice(toIndex, 0, movedStrip);

        return {
            ...s,
            [instanceId]: { ...inst, pads, channelStrips },
        };
    });
}

export function removePadInstance(instanceId: string): void {
    padStore.update((s) => {
        if (!s) {
            return {};
        }
        const next = { ...s };
        delete next[instanceId];
        return next;
    });
}
