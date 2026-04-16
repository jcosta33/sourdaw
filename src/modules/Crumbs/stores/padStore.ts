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
        if (!s) {return {};}
        if (s[instanceId]) {
            return s;
        }
        return { ...s, [instanceId]: { ...defaultPadState } };
    });
}

export function selectPad(instanceId: string, index: number): void {
    padStore.update((s) => {
        if (!s) {return {};}
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
        if (!s) {return {};}
        const inst = s[instanceId];
        if (!inst || !inst.pads[index]) {
            return s;
        }
        const pads = [...inst.pads];
        pads[index] = { ...pads[index]!, ...updates };
        return {
            ...s,
            [instanceId]: { ...inst, pads },
        };
    });
}

export function assignSampleToPad(
    instanceId: string,
    index: number,
    sampleId: number,
    name: string
): void {
    updatePad(instanceId, index, { sampleId, name });
}

export function resetPad(instanceId: string, index: number): void {
    padStore.update((s) => {
        if (!s) {return {};}
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

export function updateChannelStrip(
    instanceId: string,
    index: number,
    updates: Partial<PadChannelStrip>
): void {
    padStore.update((s) => {
        if (!s) {return {};}
        const inst = s[instanceId];
        if (!inst || !inst.channelStrips[index]) {
            return s;
        }
        const channelStrips = [...inst.channelStrips];
        channelStrips[index] = { ...channelStrips[index]!, ...updates };
        return {
            ...s,
            [instanceId]: { ...inst, channelStrips },
        };
    });
}

export function reorderPad(instanceId: string, fromIndex: number, toIndex: number): void {
    padStore.update((s) => {
        if (!s) {return {};}
        const inst = s[instanceId];
        if (!inst) {
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
        const [movedPad] = pads.splice(fromIndex, 1);
        const [movedStrip] = channelStrips.splice(fromIndex, 1);
        pads.splice(toIndex, 0, movedPad!);
        channelStrips.splice(toIndex, 0, movedStrip!);

        return {
            ...s,
            [instanceId]: { ...inst, pads, channelStrips },
        };
    });
}

export function removePadInstance(instanceId: string): void {
    padStore.update((s) => {
        if (!s) {return {};}
        const next = { ...s };
        delete next[instanceId];
        return next;
    });
}
