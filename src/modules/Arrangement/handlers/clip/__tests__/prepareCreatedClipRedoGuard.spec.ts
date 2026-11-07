import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { prepareCreatedClipRedoGuard } from '../prepareCreatedClipRedoGuard';

describe('prepareCreatedClipRedoGuard', () => {
    it('publishes only the successful forward prefix and preserves retired takes', () => {
        const previous = { entityJson: 'old', midiByClipIdJson: 'old-notes' };
        const inverse: Extract<AppAction, { type: 'discardDuplicatedClip' }> = {
            type: 'discardDuplicatedClip',
            payload: { clipId: 'copy', generatedMidiStateGuard: previous, retiredTakeLanes: [] },
        };
        const takes = inverse.payload.retiredTakeLanes;
        const fresh = { entityJson: '', midiByClipIdJson: '' };
        const publish = prepareCreatedClipRedoGuard({
            recordedRedo: { inverseAction: inverse, isCurrent: () => true },
            clipId: 'copy',
            guard: fresh,
        });
        fresh.entityJson = 'forward-prefix';
        fresh.midiByClipIdJson = 'prefix-notes';
        expect(inverse.payload.generatedMidiStateGuard).toBe(previous);
        expect(publish).toBeTypeOf('function');
        publish?.();
        expect(inverse.payload.generatedMidiStateGuard).toEqual(fresh);
        expect(inverse.payload.generatedMidiStateGuard).not.toBe(fresh);
        expect(inverse.payload.retiredTakeLanes).toBe(takes);
    });

    it('cannot publish after the recorded history authority changes', () => {
        let current = true;
        const previous = { entityJson: 'old', midiByClipIdJson: 'old-notes' };
        const inverse: AppAction = {
            type: 'discardDuplicatedClip',
            payload: { clipId: 'copy', generatedMidiStateGuard: previous },
        };
        const publish = prepareCreatedClipRedoGuard({
            recordedRedo: { inverseAction: inverse, isCurrent: () => current },
            clipId: 'copy',
            guard: { entityJson: 'new', midiByClipIdJson: 'new-notes' },
        });
        current = false;
        publish?.();
        expect(inverse.payload.generatedMidiStateGuard).toBe(previous);
    });

    it('requires an authenticated matching discard inverse', () => {
        const guard = { entityJson: 'prefix', midiByClipIdJson: 'notes' };
        const inverse: AppAction = { type: 'discardDuplicatedClip', payload: { clipId: 'other' } };
        expect(prepareCreatedClipRedoGuard({ recordedRedo: undefined, clipId: 'copy', guard })).toBeUndefined();
        expect(
            prepareCreatedClipRedoGuard({
                recordedRedo: { inverseAction: inverse, isCurrent: () => true },
                clipId: 'copy',
                guard,
            })
        ).toBeUndefined();
        expect(
            prepareCreatedClipRedoGuard({
                recordedRedo: { inverseAction: null, isCurrent: () => true },
                clipId: 'copy',
                guard,
            })
        ).toBeUndefined();
        expect(
            prepareCreatedClipRedoGuard({
                recordedRedo: {
                    inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: 'copy' } },
                    isCurrent: () => false,
                },
                clipId: 'copy',
                guard,
            })
        ).toBeUndefined();
    });
});
