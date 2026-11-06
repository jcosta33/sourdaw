import { executeUserAppAction } from '#/modules/Command/useCases';

/**
 * Quantize an audio clip's transients to a grid of `gridSize` beats: the clip is cut at each detected
 * hit and each slice moves so its hit lands on the grid, as one undoable edit Arrangement owns.
 */
export function quantizeTransients(clipId: string, gridSize: number, sensitivity?: number): Promise<void> {
    return executeUserAppAction({
        type: 'quantizeTransients',
        payload: sensitivity === undefined ? { clipId, gridSize } : { clipId, gridSize, sensitivity },
    });
}
