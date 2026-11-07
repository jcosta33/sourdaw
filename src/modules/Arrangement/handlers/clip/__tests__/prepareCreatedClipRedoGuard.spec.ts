import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { prepareCreatedClipRedoGuard } from '../prepareCreatedClipRedoGuard';

vi.mock('#/modules/Command/useCases', () => ({
    commitRedoInverseCapture: vi.fn(),
    resetActionReplayAuthority: vi.fn(() => {
        throw new Error('Unexpected project authority reset in creator guard spec');
    }),
}));

describe('prepareCreatedClipRedoGuard', () => {
    beforeEach(() => vi.clearAllMocks());
    it('stages the forward prefix without publishing and preserves retired takes', () => {
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
        const action: AppAction = {
            type: 'addClip',
            payload: { id: 'copy', trackId: 'track', startBeat: 0, endBeat: 4, name: 'Copy', type: 'midi' },
        };
        publish?.(action);
        expect(commitRedoInverseCapture).toHaveBeenCalledOnce();
        const staged = vi.mocked(commitRedoInverseCapture).mock.calls[0]?.[0];
        expect(staged).toMatchObject({
            phase: 'stage',
            action,
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: 'copy', generatedMidiStateGuard: fresh, retiredTakeLanes: takes },
            },
        });
        if (
            !staged ||
            !('phase' in staged) ||
            staged.phase !== 'stage' ||
            staged.inverseAction.type !== 'discardDuplicatedClip'
        ) {
            throw new Error('Expected staged creator capture');
        }
        expect(staged.inverseAction.payload.generatedMidiStateGuard).not.toBe(fresh);
        expect(inverse.payload.generatedMidiStateGuard).toBe(previous);
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
        publish?.({ type: 'removeClip', payload: { clipId: 'copy' } });
        expect(commitRedoInverseCapture).not.toHaveBeenCalled();
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
