import { describe, expect, it } from 'vitest';

import { handleToggleAdjustmentLayer } from '../batchFeature/handleToggleAdjustmentLayer';
import { handleCutClip } from '../clip/handleCutClip';
import { handleReverseClip } from '../clip/handleReverseClip';
import { handleDisableTrack } from '../track/disableTrack';
import { handleFreezeTrack } from '../track/freezeTrack';
import { handleToggleSoloSafe } from '../track/toggleSoloSafe';
import { handleUnfreezeTrack } from '../track/unfreezeTrack';
import { handleZoomTracksVertical } from '../track/zoomTracksVertical';

describe('Arrangement undoable handlers audit', () => {
    it('provides valid inverseAction for toggle and state handlers', () => {
        expect(handleDisableTrack.undoable).toBe(true);
        expect(
            handleDisableTrack.describe({ type: 'disableTrack', payload: { trackId: 't1', disabled: true } })
        ).toEqual({
            label: 'Disable track',
            inverseAction: {
                type: 'disableTrack',
                payload: { trackId: 't1', disabled: false },
            },
            redoAction: {
                type: 'disableTrack',
                payload: { trackId: 't1', disabled: true },
            },
        });

        expect(handleToggleSoloSafe.undoable).toBe(true);
        expect(handleToggleSoloSafe.describe({ type: 'toggleSoloSafe', payload: { trackId: 't1' } })).toEqual({
            label: 'Toggle solo safe',
            inverseAction: {
                type: 'toggleSoloSafe',
                payload: { trackId: 't1' },
            },
            redoAction: {
                type: 'toggleSoloSafe',
                payload: { trackId: 't1' },
            },
        });

        expect(handleFreezeTrack.undoable).toBe(true);
        expect(handleFreezeTrack.describe({ type: 'freezeTrack', payload: { trackId: 't1' } })).toEqual({
            label: 'Freeze track',
            inverseAction: {
                type: 'unfreezeTrack',
                payload: { trackId: 't1' },
            },
            redoAction: {
                type: 'freezeTrack',
                payload: { trackId: 't1' },
            },
        });

        expect(handleUnfreezeTrack.undoable).toBe(true);
        expect(handleUnfreezeTrack.describe({ type: 'unfreezeTrack', payload: { trackId: 't1' } })).toEqual({
            label: 'Unfreeze track',
            inverseAction: {
                type: 'freezeTrack',
                payload: { trackId: 't1' },
            },
            redoAction: {
                type: 'unfreezeTrack',
                payload: { trackId: 't1' },
            },
        });

        expect(handleReverseClip.undoable).toBe(true);
        expect(handleReverseClip.describe({ type: 'reverseClip', payload: { clipId: 'c1' } })).toEqual({
            label: 'Reverse clip',
            inverseAction: {
                type: 'reverseClip',
                payload: { clipId: 'c1' },
            },
            redoAction: {
                type: 'reverseClip',
                payload: { clipId: 'c1' },
            },
        });

        expect(handleToggleAdjustmentLayer.undoable).toBe(true);
        expect(
            handleToggleAdjustmentLayer.describe({ type: 'toggleAdjustmentLayer', payload: { layerId: 'l1' } })
        ).toEqual({
            label: 'Toggle Adjustment Layer',
            inverseAction: {
                type: 'toggleAdjustmentLayer',
                payload: { layerId: 'l1' },
            },
            redoAction: {
                type: 'toggleAdjustmentLayer',
                payload: { layerId: 'l1' },
            },
        });
    });

    it('marks non-reversible or unmodeled actions as undoable: false', () => {
        expect(handleZoomTracksVertical.undoable).toBe(false);
        expect(handleCutClip.undoable).toBe(false);
    });
});
