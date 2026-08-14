import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackColor } from '../handleSetTrackColor';

const mocks = vi.hoisted(() => ({
    setTrackColor: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackColor', () => ({
    setTrackColor: mocks.setTrackColor,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackColor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('calls setTrackColor', () => {
            void handleSetTrackColor.execute({
                type: 'setTrackColor',
                payload: { trackId: 't1', color: '#ff0000' },
            });
            expect(mocks.setTrackColor).toHaveBeenCalledWith('t1', '#ff0000');
        });
    });

    describe('describe', () => {
        it('returns inverse action with previous color', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', color: '#00ff00' }] });

            const desc = handleSetTrackColor.describe({
                type: 'setTrackColor',
                payload: { trackId: 't1', color: '#ff0000' },
            });

            expect(desc.label).toBe('Set track color');
            expect(desc.inverseAction).toEqual({
                type: 'setTrackColor',
                payload: { trackId: 't1', color: '#00ff00', expectedColor: '#ff0000' },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackColor',
                payload: { trackId: 't1', color: '#ff0000', expectedColor: '#00ff00' },
            });
        });

        it('returns null inverse action if track not found', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleSetTrackColor.describe({
                type: 'setTrackColor',
                payload: { trackId: 't1', color: '#ff0000' },
            });

            expect(desc.inverseAction).toBeNull();
        });
    });

    it('refuses a guarded inverse after a collaborator changes the color', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', color: '#collaborator' }] });

        const result = handleSetTrackColor.execute({
            type: 'setTrackColor',
            payload: { trackId: 't1', color: '#old', expectedColor: '#new' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackColor).not.toHaveBeenCalled();
    });

    it('does not consume a guarded inverse as a no-op after the target is deleted', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        const action = {
            type: 'setTrackColor',
            payload: { trackId: 't1', color: '#old', expectedColor: '#new' },
        } as const;

        expect(handleSetTrackColor.isNoop?.(action)).toBe(false);
        expect(handleSetTrackColor.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });

    it('is a no-op when the requested color is already applied', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', color: '#ff0000' }] });

        expect(
            handleSetTrackColor.isNoop?.({
                type: 'setTrackColor',
                payload: { trackId: 't1', color: '#ff0000' },
            })
        ).toBe(true);
    });

    it('is undoable', () => {
        expect(handleSetTrackColor.undoable).toBe(true);
    });
});
