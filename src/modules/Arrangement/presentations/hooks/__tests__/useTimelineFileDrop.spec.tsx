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
    audioBufferCacheGet: vi.fn(),
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

vi.mock('#/modules/AudioEngine/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    audioBufferCache: {
        get: mocks.audioBufferCacheGet,
    },
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
        // Default: nothing in the buffer cache → drops take the file-read/decode path.
        mocks.audioBufferCacheGet.mockReturnValue(undefined);
        mocks.libraryStoreValue.value = { roots: [] } as any;
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

    // Regression (risk #4): a factory sample dragged onto the timeline carries
    // no file handle and its root is the handle-less 'browser' shim with an empty
    // rootRef, so neither the Tauri nor the browser decode branch fires. Its
    // decoded AudioBuffer already lives in audioBufferCache under the sample id;
    // the drop must resolve audioBufferId from the cache so the clip is audible in
    // playback/export instead of silent (audioBufferId === undefined).
    it('resolves a factory clip audioBufferId from the buffer cache (no handle, no decode)', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        mocks.libraryStoreValue.value = {
            roots: [{ id: 'factory', provider: 'browser', rootRef: '', handle: undefined }],
        } as any;
        // Buffer present in the cache keyed by the sample id.
        mocks.audioBufferCacheGet.mockImplementation((id: string) =>
            id === 'factory-kick' ? ({ duration: 2 } as AudioBuffer) : undefined
        );

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) =>
                    type === 'application/x-sourdaw-sample'
                        ? JSON.stringify({
                              name: 'Kick',
                              id: 'factory-kick',
                              path: 'drums/kick.factory',
                              libraryRootId: 'factory',
                          })
                        : '',
                files: [],
            },
        };

        mocks.hitTestTrack.mockReturnValue(null);
        mocks.addTrack.mockReturnValue({ id: 'new-track-id' });

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.addClip).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Kick', type: 'audio', audioBufferId: 'factory-kick' })
            );
        });
        // The cache short-circuit must skip the file decode path entirely.
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
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

    // Regression (#35-new): a malformed AI-render payload with a non-finite
    // durationSeconds previously produced a NaN clip span that addClip silently
    // rejected — a no-op drop with no feedback. The drop must now surface an
    // error and never call addClip.
    it('rejects an AI-render drop with a non-finite duration and notifies the user', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) => {
                    if (type === 'application/x-sourdaw-ai-render') {
                        // durationSeconds is missing → NaN duration downstream.
                        return JSON.stringify({ name: 'Pad', bufferId: 'buf-ai' });
                    }
                    return '';
                },
                files: [],
            },
        };

        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' } as any;

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.any(String), 'error');
        });
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    // Regression (#35-new): a structurally broken sample payload must surface an
    // error instead of being swallowed by a silent catch.
    it('rejects a malformed sample drop and notifies the user', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) => {
                    if (type === 'application/x-sourdaw-sample') {
                        // Missing required string fields (id/path/libraryRootId).
                        return JSON.stringify({ name: 'Broken' });
                    }
                    return '';
                },
                files: [],
            },
        };

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.any(String), 'error');
        });
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('places a valid AI-render drop as a clip', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) => {
                    if (type === 'application/x-sourdaw-ai-render') {
                        return JSON.stringify({ name: 'Pad', bufferId: 'buf-ai', durationSeconds: 4 });
                    }
                    return '';
                },
                files: [],
            },
        };

        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' } as any;

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.addClip).toHaveBeenCalledWith(
                expect.objectContaining({ trackId: 't1', name: 'Pad', type: 'audio', audioBufferId: 'buf-ai' })
            );
        });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
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
