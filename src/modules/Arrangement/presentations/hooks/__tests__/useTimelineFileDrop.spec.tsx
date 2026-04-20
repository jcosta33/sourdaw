import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTimelineFileDrop } from '../useTimelineFileDrop';

const mocks = vi.hoisted(() => ({
    hitTestTrack: vi.fn(),
    trackStoreValue: { value: { tracks: [], selectedTrackId: null } },
    libraryStoreValue: { value: { roots: [] } },
    buildTimelineRenderModel: vi.fn(),
    notifyUser: vi.fn(),
    isTauri: vi.fn(),
    getAssetTransfer: vi.fn(),
    decodeAudioFile: vi.fn(),
    addClip: vi.fn(),
    addDevice: vi.fn(),
    addTrack: vi.fn(),
    importMidiFile: vi.fn(),
}));

vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({
    hitTestTrack: mocks.hitTestTrack,
}));

vi.mock('../../../stores/trackStore', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/SampleLibrary/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    libraryStore: {
        get value() {
            return mocks.libraryStoreValue.value;
        },
    },
}));

vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: mocks.buildTimelineRenderModel,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    decodeAudioFile: mocks.decodeAudioFile,
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: mocks.addClip,
}));

vi.mock('../../../useCases/device/addDevice', () => ({
    addDevice: mocks.addDevice,
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: mocks.addTrack,
}));

vi.mock('../../../useCases/importMidiFile', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    importMidiFile: mocks.importMidiFile,
}));

describe('useTimelineFileDrop', () => {
    const getCanvasCoords = vi.fn().mockReturnValue({ x: 100, y: 100 });
    const getBeatFromX = vi.fn().mockReturnValue(10);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isTauri.mockReturnValue(false);
        mocks.buildTimelineRenderModel.mockReturnValue({ tempo: 120 });
        mocks.getAssetTransfer.mockReturnValue({ addLocalAsset: vi.fn().mockResolvedValue('hash') });
        mocks.trackStoreValue.value = { tracks: [], selectedTrackId: null } as any;
    });

    it('handles plugin drop', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) => {
                    if (type === 'application/x-sourdaw-plugin') {
                        return JSON.stringify({ name: 'SuperFilter', id: 'p1' });
                    }
                    return '';
                },
                files: [],
            },
        };

        mocks.hitTestTrack.mockReturnValue('t1');

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.addDevice).toHaveBeenCalledWith('t1', 'SuperFilter');
        });
    });

    it('handles sample drop by creating a new track if needed', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) => {
                    if (type === 'application/x-sourdaw-sample') {
                        return JSON.stringify({
                            name: 'Kick',
                            id: 's1',
                            path: 'kick.wav',
                            libraryRootId: 'root1',
                            durationSeconds: 2,
                        });
                    }
                    return '';
                },
                files: [],
            },
        };

        mocks.hitTestTrack.mockReturnValue(null);
        mocks.addTrack.mockReturnValue({ id: 'new-track-id' });
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf1', buffer: { duration: 2 } });

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Kick', kind: 'audio' });
            expect(mocks.addClip).toHaveBeenCalledWith(
                expect.objectContaining({
                    trackId: 'new-track-id',
                    name: 'Kick',
                    type: 'audio',
                })
            );
        });
    });

    it('handles external file drop (MIDI)', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        // Mock MIDI file
        const mockFile = new File(['MThd\x00\x00\x00\x06\x00\x01\x00\x01\x00\x80'], 'song.mid', { type: 'audio/midi' });
        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: () => '',
                files: [mockFile],
            },
        };

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.importMidiFile).toHaveBeenCalledWith(mockFile);
        });
    });

    it('handles external file drop (Audio)', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockFile = new File([''], 'snare.wav', { type: 'audio/wav' });
        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: () => '',
                files: [mockFile],
            },
        };

        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }] } as any;
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf2', buffer: { duration: 1 } });

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.addClip).toHaveBeenCalledWith(
                expect.objectContaining({
                    trackId: 't1',
                    name: 'snare',
                    type: 'audio',
                    audioBufferId: 'buf2',
                })
            );
        });
    });
});
