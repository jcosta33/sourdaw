import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(),
    renameTrack: vi.fn(),
    setTrackColor: vi.fn(),
    groupTracks: vi.fn(),
}));

import { getTrackStoreState, renameTrack, setTrackColor, groupTracks } from '#/modules/Arrangement/useCases';

import { handleAutoOrganizeProject } from '../handleAutoOrganizeProject';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedRename = vi.mocked(renameTrack);
const mockedSetColor = vi.mocked(setTrackColor);
const mockedGroup = vi.mocked(groupTracks);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleAutoOrganizeProject — execute', () => {
    it('does nothing when store is null', async () => {
        mockedGetState.mockReturnValue(null);
        await handleAutoOrganizeProject.execute({ type: 'autoOrganizeProject', payload: { tracks: [] } });
        expect(mockedRename).not.toHaveBeenCalled();
    });

    it('calls renameTrack for updates with newName', async () => {
        mockedGetState.mockReturnValue({ tracks: [] } as never);
        await handleAutoOrganizeProject.execute({
            type: 'autoOrganizeProject',
            payload: { tracks: [{ trackId: 't1', newName: 'Kick' }] },
        });
        expect(mockedRename).toHaveBeenCalledWith('t1', 'Kick');
    });

    it('skips renameTrack when newName is missing', async () => {
        mockedGetState.mockReturnValue({ tracks: [] } as never);
        await handleAutoOrganizeProject.execute({
            type: 'autoOrganizeProject',
            payload: { tracks: [{ trackId: 't1' }] },
        });
        expect(mockedRename).not.toHaveBeenCalled();
    });

    it('calls setTrackColor for updates with color', async () => {
        mockedGetState.mockReturnValue({ tracks: [] } as never);
        await handleAutoOrganizeProject.execute({
            type: 'autoOrganizeProject',
            payload: { tracks: [{ trackId: 't1', color: '#ff0000' }] },
        });
        expect(mockedSetColor).toHaveBeenCalledWith('t1', '#ff0000');
    });

    it('calls groupTracks with accumulated trackIds per folder', async () => {
        mockedGetState.mockReturnValue({ tracks: [] } as never);
        await handleAutoOrganizeProject.execute({
            type: 'autoOrganizeProject',
            payload: {
                tracks: [
                    { trackId: 't1', folderName: 'Drums' },
                    { trackId: 't2', folderName: 'Drums' },
                    { trackId: 't3', folderName: 'Bass' },
                ],
            },
        });
        expect(mockedGroup).toHaveBeenCalledTimes(2);
        // Drums folder has t1 and t2
        const drumsCall = mockedGroup.mock.calls.find((c) => c[1] === 'Drums');
        expect(drumsCall?.[0]).toEqual(['t1', 't2']);
        // Bass folder has t3
        const bassCall = mockedGroup.mock.calls.find((c) => c[1] === 'Bass');
        expect(bassCall?.[0]).toEqual(['t3']);
    });

    it('does not call groupTracks when no folderName in updates', async () => {
        mockedGetState.mockReturnValue({ tracks: [] } as never);
        await handleAutoOrganizeProject.execute({
            type: 'autoOrganizeProject',
            payload: { tracks: [{ trackId: 't1', newName: 'X' }] },
        });
        expect(mockedGroup).not.toHaveBeenCalled();
    });
});

describe('handleAutoOrganizeProject — describe', () => {
    it('returns label', () => {
        const result = handleAutoOrganizeProject.describe({ type: 'autoOrganizeProject', payload: { tracks: [] } });
        expect(result.label).toBe('Auto-Organize Project');
    });
});
