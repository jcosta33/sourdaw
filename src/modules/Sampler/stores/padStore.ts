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
} from '../models/SamplerTypes';

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

export const padStore = createStore<PadState>({
    initialData: defaultPadState,
});

export function selectPad(index: number): void {
    padStore.update((s) => {
        if (!s || index < 0 || index >= s.pads.length) {
            return s;
        }
        return { ...s, selectedPadIndex: index };
    });
}

export function updatePad(index: number, updates: Partial<PadConfig>): void {
    padStore.update((s) => {
        if (!s || !s.pads[index]) {
            return s;
        }
        const pads = [...s.pads];
        pads[index] = { ...pads[index]!, ...updates };
        return { ...s, pads };
    });
}

export function assignSampleToPad(index: number, sampleId: number, name: string): void {
    updatePad(index, { sampleId, name });
}

export function resetPad(index: number): void {
    padStore.update((s) => {
        if (!s) {
            return s;
        }
        const pads = [...s.pads];
        const channelStrips = [...s.channelStrips];
        pads[index] = createDefaultPad(index);
        channelStrips[index] = createDefaultChannelStrip();
        return { ...s, pads, channelStrips };
    });
}

export function updateChannelStrip(index: number, updates: Partial<PadChannelStrip>): void {
    padStore.update((s) => {
        if (!s || !s.channelStrips[index]) {
            return s;
        }
        const channelStrips = [...s.channelStrips];
        channelStrips[index] = { ...channelStrips[index]!, ...updates };
        return { ...s, channelStrips };
    });
}

export function reorderPad(fromIndex: number, toIndex: number): void {
    padStore.update((s) => {
        if (!s) {
            return s;
        }
        if (fromIndex < 0 || fromIndex >= s.pads.length) {
            return s;
        }
        if (toIndex < 0 || toIndex >= s.pads.length) {
            return s;
        }
        if (fromIndex === toIndex) {
            return s;
        }

        const pads = [...s.pads];
        const channelStrips = [...s.channelStrips];
        const [movedPad] = pads.splice(fromIndex, 1);
        const [movedStrip] = channelStrips.splice(fromIndex, 1);
        pads.splice(toIndex, 0, movedPad!);
        channelStrips.splice(toIndex, 0, movedStrip!);

        return { ...s, pads, channelStrips };
    });
}
