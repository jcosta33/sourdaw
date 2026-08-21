import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreMidiOutput } from '../restoreMidiOutput';
import { handleRestoreTrackDisabled } from '../restoreTrackDisabled';
import { handleRestoreTrackInput } from '../restoreTrackInput';

type TrackFixture = {
    readonly id: string;
    readonly disabled?: boolean;
    readonly midiOutputTrackId?: string | null;
    readonly inputId?: string | null;
};

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => { tracks: TrackFixture[] } | null>(),
    disableTrack: vi.fn(),
    updateTrack: vi.fn<(trackId: string, updater: (track: TrackFixture) => TrackFixture) => void>(),
    setTrackInput: vi.fn<() => boolean>(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/toggleTrackState/disableTrack', () => ({
    disableTrack: mocks.disableTrack,
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../useCases/setTrackInput', () => ({
    setTrackInput: mocks.setTrackInput,
}));

function withTrack(track: TrackFixture): void {
    mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });
}

/**
 * The three guarded restores `disableTrack`, `setMidiOutput`/`clearMidiOutput` and
 * `setTrackInput` unwind through. None is `undoable`, so the registry's coverage floor
 * cannot see them; they are reached only by `undo()` and `redo()` dispatching them with
 * `skipUndo`, which is why each one has to refuse rather than overwrite when the live
 * value has moved on since the entry was filed.
 */
describe('guarded track restores', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('restoreTrackDisabled', () => {
        it('writes the replacement when the live value is the expected one', () => {
            withTrack({ id: 't1', disabled: true });

            expect(
                handleRestoreTrackDisabled.execute({
                    type: 'restoreTrackDisabled',
                    payload: { trackId: 't1', expected: true, replacement: false },
                })
            ).toEqual({ status: 'written' });
            expect(mocks.disableTrack).toHaveBeenCalledWith('t1', false);
        });

        it('refuses without writing when the track was disabled again after the entry was filed', () => {
            withTrack({ id: 't1', disabled: true });

            expect(
                handleRestoreTrackDisabled.execute({
                    type: 'restoreTrackDisabled',
                    payload: { trackId: 't1', expected: false, replacement: true },
                })
            ).toEqual({ status: 'conflict' });
            expect(mocks.disableTrack).not.toHaveBeenCalled();
        });

        it('refuses when the track is gone rather than treating its absence as a match', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            expect(
                handleRestoreTrackDisabled.execute({
                    type: 'restoreTrackDisabled',
                    payload: { trackId: 't1', expected: false, replacement: true },
                })
            ).toEqual({ status: 'conflict' });
        });

        it('reports no-write, and is a noop, when the value is already the replacement', () => {
            withTrack({ id: 't1', disabled: false });
            const action = {
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: false, replacement: false },
            } as const;

            expect(handleRestoreTrackDisabled.execute(action)).toEqual({
                status: 'no-write',
            });
            expect(handleRestoreTrackDisabled.isNoop?.(action)).toBe(true);
            expect(mocks.disableTrack).not.toHaveBeenCalled();
        });

        it('is not itself undoable', () => {
            expect(handleRestoreTrackDisabled.undoable).toBe(false);
        });
    });

    describe('restoreMidiOutput', () => {
        it('writes the replacement routing when the live routing is the expected one', () => {
            withTrack({ id: 't1', midiOutputTrackId: null });

            expect(
                handleRestoreMidiOutput.execute({
                    type: 'restoreMidiOutput',
                    payload: { trackId: 't1', expected: null, replacement: 't2' },
                })
            ).toEqual({ status: 'written' });

            const [trackId, updater] = mocks.updateTrack.mock.calls[0] ?? [];
            expect(trackId).toBe('t1');
            expect(updater?.({ id: 't1', midiOutputTrackId: null })).toEqual({
                id: 't1',
                midiOutputTrackId: 't2',
            });
        });

        it('refuses without writing when the routing was repointed after the entry was filed', () => {
            withTrack({ id: 't1', midiOutputTrackId: 't3' });

            expect(
                handleRestoreMidiOutput.execute({
                    type: 'restoreMidiOutput',
                    payload: { trackId: 't1', expected: null, replacement: 't2' },
                })
            ).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when the track is gone rather than treating its absence as a match', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            expect(
                handleRestoreMidiOutput.execute({
                    type: 'restoreMidiOutput',
                    payload: { trackId: 't1', expected: null, replacement: 't2' },
                })
            ).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('reports no-write, and is a noop, when the routing already matches the replacement', () => {
            withTrack({ id: 't1', midiOutputTrackId: 't2' });
            const action = {
                type: 'restoreMidiOutput',
                payload: { trackId: 't1', expected: 't2', replacement: 't2' },
            } as const;

            expect(handleRestoreMidiOutput.execute(action)).toEqual({
                status: 'no-write',
            });
            expect(handleRestoreMidiOutput.isNoop?.(action)).toBe(true);
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('is not itself undoable', () => {
            expect(handleRestoreMidiOutput.undoable).toBe(false);
        });
    });

    describe('restoreTrackInput', () => {
        it('writes the replacement input when the live input is the expected one', () => {
            withTrack({ id: 't1', inputId: 'in-1' });
            mocks.setTrackInput.mockReturnValue(true);

            expect(
                handleRestoreTrackInput.execute({
                    type: 'restoreTrackInput',
                    payload: { trackId: 't1', expected: 'in-1', replacement: 'in-2' },
                })
            ).toEqual({ status: 'written' });
            expect(mocks.setTrackInput).toHaveBeenCalledWith('t1', 'in-2');
        });

        it('refuses without writing when the input was changed after the entry was filed', () => {
            withTrack({ id: 't1', inputId: 'in-3' });

            expect(
                handleRestoreTrackInput.execute({
                    type: 'restoreTrackInput',
                    payload: { trackId: 't1', expected: 'in-1', replacement: 'in-2' },
                })
            ).toEqual({ status: 'conflict' });
            expect(mocks.setTrackInput).not.toHaveBeenCalled();
        });

        it('reports no-write when the track kind refuses the input rather than claiming a write', () => {
            // `setTrackInput` returns `false` for a track whose kind accepts no input. The
            // undo engine must not record that as a restored state it never restored.
            withTrack({ id: 't1', inputId: 'in-1' });
            mocks.setTrackInput.mockReturnValue(false);

            expect(
                handleRestoreTrackInput.execute({
                    type: 'restoreTrackInput',
                    payload: { trackId: 't1', expected: 'in-1', replacement: 'in-2' },
                })
            ).toEqual({ status: 'no-write' });
        });

        it('refuses when the track is gone rather than treating its absence as a match', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            expect(
                handleRestoreTrackInput.execute({
                    type: 'restoreTrackInput',
                    payload: { trackId: 't1', expected: 'in-1', replacement: 'in-2' },
                })
            ).toEqual({ status: 'conflict' });
            expect(mocks.setTrackInput).not.toHaveBeenCalled();
        });

        it('reports no-write, and is a noop, when the input already matches the replacement', () => {
            withTrack({ id: 't1', inputId: 'in-2' });
            const action = {
                type: 'restoreTrackInput',
                payload: { trackId: 't1', expected: 'in-2', replacement: 'in-2' },
            } as const;

            expect(handleRestoreTrackInput.execute(action)).toEqual({
                status: 'no-write',
            });
            expect(handleRestoreTrackInput.isNoop?.(action)).toBe(true);
            expect(mocks.setTrackInput).not.toHaveBeenCalled();
        });

        it('is not itself undoable', () => {
            expect(handleRestoreTrackInput.undoable).toBe(false);
        });
    });
});
