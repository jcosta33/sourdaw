/**
 * The AudioEngine half of the hung-note fix (MAJOR-B): the offs a removed Yeast
 * processor emits via `yeast.notesOff` must actually reach the live instrument.
 * `routeYeastNoteOffsForTargetTrack` resolves the target track's instrument and
 * delivers each Note Off to its device node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fermenterNoteOff, levainNoteOff, getTrackStrip, getTargetTrackId } = vi.hoisted(() => ({
    fermenterNoteOff: vi.fn<(note: number) => void>(),
    levainNoteOff: vi.fn<(note: number) => void>(),
    getTrackStrip: vi.fn(),
    getTargetTrackId: vi.fn<() => string | null>(),
}));

vi.mock('../state', () => ({
    getTargetTrackId,
}));

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: { getTrackStrip: (id: string) => getTrackStrip(id) as unknown },
}));

const { routeYeastNoteOffsForTargetTrack } = await import('../routeYeastNoteOff');

const noopEmit = (): void => {};

beforeEach(() => {
    fermenterNoteOff.mockReset();
    levainNoteOff.mockReset();
    getTrackStrip.mockReset();
    getTargetTrackId.mockReset();
});

describe('routeYeastNoteOffsForTargetTrack', () => {
    it('delivers each off to the target track fermenter device node', () => {
        getTargetTrackId.mockReturnValue('track-1');
        getTrackStrip.mockReturnValue({
            deviceNodes: [{ type: 'fermenter', fermenterControls: { noteOff: fermenterNoteOff } }],
        });
        const trackState = {
            tracks: [{ id: 'track-1', devices: [{ id: 'ferm-1', type: 'fermenter' }] }],
        };

        routeYeastNoteOffsForTargetTrack([60, 64], {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test shim for the track store shape the resolver reads
            getTrackStoreState: () => trackState as any,
            emitGrandBouleEvent: noopEmit,
        });

        expect(fermenterNoteOff.mock.calls.map((c) => c[0])).toEqual([60, 64]);
    });

    it('routes to a levain device when that is the track instrument', () => {
        getTargetTrackId.mockReturnValue('track-2');
        getTrackStrip.mockReturnValue({
            deviceNodes: [{ type: 'levain', levainControls: { noteOff: levainNoteOff } }],
        });
        const trackState = { tracks: [{ id: 'track-2', devices: [{ id: 'lev-1', type: 'levain' }] }] };

        routeYeastNoteOffsForTargetTrack([72], {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test shim for the track store shape the resolver reads
            getTrackStoreState: () => trackState as any,
            emitGrandBouleEvent: noopEmit,
        });

        expect(levainNoteOff).toHaveBeenCalledWith(72);
    });

    it('is a no-op when there is no target track (nothing to hang)', () => {
        getTargetTrackId.mockReturnValue(null);

        routeYeastNoteOffsForTargetTrack([60], {
            getTrackStoreState: () => null,
            emitGrandBouleEvent: noopEmit,
        });

        expect(getTrackStrip).not.toHaveBeenCalled();
        expect(fermenterNoteOff).not.toHaveBeenCalled();
    });

    it('is a no-op for an empty off list', () => {
        getTargetTrackId.mockReturnValue('track-1');
        routeYeastNoteOffsForTargetTrack([], {
            getTrackStoreState: () => ({ tracks: [] }) as never,
            emitGrandBouleEvent: noopEmit,
        });
        expect(getTrackStrip).not.toHaveBeenCalled();
    });
});
