/**
 * Loop station store — manages live looping state.
 *
 * Extracted from loopStationUseCases.ts — stores should live in stores/,
 * not inside use case files.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type LoopSlotState = 'empty' | 'recording' | 'playing' | 'overdubbing' | 'stopped';

export type LoopLayer = {
    id: string;
    /** Layer index (0 = base, 1+ = overdubs) */
    layerIndex: number;
    /** When this layer was recorded */
    recordedAt: string;
    /** Whether this layer is muted */
    muted: boolean;
    /** Volume level (0-1) */
    volume: number;
};

export type LoopSlot = {
    id: string;
    /** Which track this slot is on */
    trackId: string;
    /** Row index in the clip launcher grid */
    row: number;
    /** Column index */
    column: number;
    /** Current state */
    state: LoopSlotState;
    /** Loop duration in beats (set after first recording) */
    lengthBeats: number;
    /** Overdub layers */
    layers: LoopLayer[];
    /** Number of times the loop has repeated */
    loopCount: number;
    /** Master volume */
    volume: number;
    /** Is quantize-to-bar enabled? */
    quantize: boolean;
    /** Fade-in/out duration in beats */
    fadeBeats: number;
};

export type LoopStationState = {
    slots: LoopSlot[];
    /** How many columns (scenes) */
    sceneCount: number;
    /** Active scene column index */
    activeScene: number;
    /** Global record arm */
    armed: boolean;
    /** Sync to transport tempo */
    syncToTransport: boolean;
    /** Fixed loop length in beats (0 = auto-detect from first recording) */
    fixedLoopLength: number;
};

export const loopStationStore = new Store<LoopStationState>(logger, {
    initialData: {
        slots: [],
        sceneCount: 8,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    },
});
