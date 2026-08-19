import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTimelineFileDrop } from '../useTimelineFileDrop';

const mocks = vi.hoisted(() => ({
    hitTestTrack: vi.fn(),
    trackStoreValue: { value: { tracks: [], selectedTrackId: null } },
    buildTimelineRenderModel: vi.fn(),
    notifyUser: vi.fn(),
    getAssetTransfer: vi.fn(),
    decodeAudioFile: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    resolveDroppedSampleFile: vi.fn(),
    addClip: vi.fn(),
    compileAddDeviceAction: vi.fn(),
    executeAppAction: vi.fn(),
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

vi.mock('#/modules/SampleLibrary/useCases', () => ({
    resolveDroppedSampleFile: mocks.resolveDroppedSampleFile,
}));

vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: mocks.buildTimelineRenderModel,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    decodeAudioFile: mocks.decodeAudioFile,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: mocks.addClip,
}));

vi.mock('../../../useCases/device/compileAddDeviceAction', () => ({
    compileAddDeviceAction: mocks.compileAddDeviceAction,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
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
        mocks.buildTimelineRenderModel.mockReturnValue({ tempo: 120 });
        mocks.getAssetTransfer.mockReturnValue({ addLocalAsset: vi.fn().mockResolvedValue('hash') });
        mocks.trackStoreValue.value = { tracks: [], selectedTrackId: null };
        // Default: nothing in the buffer cache → drops take the file-read/decode path.
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'unresolved' });
        mocks.compileAddDeviceAction.mockImplementation((trackId: string, deviceType: string) => ({
            type: 'addDevice',
            payload: { trackId, deviceType, deviceId: 'device-1', expectedDeviceIds: [] },
        }));
        mocks.executeAppAction.mockResolvedValue(undefined);
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
            expect(mocks.compileAddDeviceAction).toHaveBeenCalledWith('t1', 'p1');
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'p1', deviceId: 'device-1', expectedDeviceIds: [] },
            });
        });
    });

    // The drag payload carries both, and the command receives the stable id.
    // `De-esser`, `LUFS Meter` and `Stereo Widener` each name two catalog
    // plugins — a builtin and a Faust one — so a name lookup returns whichever
    // the registry lists first, not the card the user actually dragged.
    it('adds the dropped plugin by id, so a name two plugins share cannot pick the other one', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) => {
                    if (type === 'application/x-sourdaw-plugin') {
                        return JSON.stringify({ name: 'De-esser', id: 'faust-de-esser' });
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
            expect(mocks.compileAddDeviceAction).toHaveBeenCalledWith('t1', 'faust-de-esser');
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'faust-de-esser', deviceId: 'device-1', expectedDeviceIds: [] },
            });
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
    // rootRef, so neither the native nor the browser decode branch fires. Its
    // decoded AudioBuffer already lives in audioBufferCache under the sample id;
    // the drop must resolve audioBufferId from the cache so the clip is audible in
    // playback/export instead of silent (audioBufferId === undefined).
    it('resolves a factory clip audioBufferId from the buffer cache (no handle, no decode)', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        // Buffer present in the cache keyed by the sample id.
        mocks.getCachedAudioBuffer.mockReturnValue({ duration: 2 });

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
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'factory-kick' });
        // The cache short-circuit must skip the file decode path entirely.
        expect(mocks.resolveDroppedSampleFile).not.toHaveBeenCalled();
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
    });

    it('reads a native-root sample through the SampleLibrary resolver before decoding', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const file = new File(['audio'], 'kick.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'tauri', file });
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-native', buffer: { duration: 2 } });
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.addTrack.mockReturnValue({ id: 'new-track-id' });

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) =>
                    type === 'application/x-sourdaw-sample'
                        ? JSON.stringify({
                              name: 'Kick',
                              id: 'native-kick',
                              path: 'Drums/Kick.wav',
                              libraryRootId: 'root1',
                          })
                        : '',
                files: [],
            },
        };

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.resolveDroppedSampleFile).toHaveBeenCalledWith({
                libraryRootId: 'root1',
                relativePath: 'Drums/Kick.wav',
                fallbackName: 'Kick',
            });
        });
        expect(mocks.decodeAudioFile).toHaveBeenCalledWith(file);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'new-track-id',
                name: 'Kick',
                type: 'audio',
                audioBufferId: 'buf-native',
                assetHash: 'hash',
            })
        );
    });

    it('resolves a browser-root sample through the SampleLibrary resolver before decoding', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const file = new File(['audio'], 'clap.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'browser', file });
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-browser', buffer: { duration: 1.5 } });
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' } as any;

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) =>
                    type === 'application/x-sourdaw-sample'
                        ? JSON.stringify({
                              name: 'Clap',
                              id: 'browser-clap',
                              path: 'Drums/Clap.wav',
                              libraryRootId: 'root-browser',
                          })
                        : '',
                files: [],
            },
        };

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.resolveDroppedSampleFile).toHaveBeenCalledWith({
                libraryRootId: 'root-browser',
                relativePath: 'Drums/Clap.wav',
                fallbackName: 'Clap',
            });
        });
        expect(mocks.decodeAudioFile).toHaveBeenCalledWith(file);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't1',
                name: 'Clap',
                type: 'audio',
                audioBufferId: 'buf-browser',
                assetHash: 'hash',
            })
        );
    });

    it('warns with the decode message when a native-root sample file cannot be decoded', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const file = new File(['not-audio'], 'broken.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'tauri', file });
        mocks.decodeAudioFile.mockRejectedValue(new Error('decode failed'));
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' } as any;

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) =>
                    type === 'application/x-sourdaw-sample'
                        ? JSON.stringify({
                              name: 'Broken Kick',
                              id: 'native-broken-kick',
                              path: 'Drums/Broken Kick.wav',
                              libraryRootId: 'root-native',
                          })
                        : '',
                files: [],
            },
        };

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                '"Broken Kick" could not be decoded — the file may be DRM-protected or corrupt.',
                'warning'
            );
        });
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('Could not access'), 'warning');
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't1',
                name: 'Broken Kick',
                type: 'audio',
                audioBufferId: undefined,
                assetHash: undefined,
            })
        );
    });

    it('keeps the decode warning for browser-root sample files that cannot be decoded', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const file = new File(['not-audio'], 'broken.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'browser', file });
        mocks.decodeAudioFile.mockRejectedValue(new Error('decode failed'));
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' } as any;

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) =>
                    type === 'application/x-sourdaw-sample'
                        ? JSON.stringify({
                              name: 'Broken Clap',
                              id: 'browser-broken-clap',
                              path: 'Drums/Broken Clap.wav',
                              libraryRootId: 'root-browser',
                          })
                        : '',
                files: [],
            },
        };

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                '"Broken Clap" could not be decoded — the file may be DRM-protected or corrupt.',
                'warning'
            );
        });
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('Could not access'), 'warning');
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't1',
                name: 'Broken Clap',
                type: 'audio',
                audioBufferId: undefined,
                assetHash: undefined,
            })
        );
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

    it('aborts an AI-render drop onto a non-audio track when no new audio track can be created', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: (type: string) =>
                    type === 'application/x-sourdaw-ai-render'
                        ? JSON.stringify({ name: 'Pad', bufferId: 'buf-ai', durationSeconds: 4 })
                        : '',
                files: [],
            },
        };

        // No track hit, no selected track, and addTrack returns null (e.g. max
        // track limit reached) -> the drop must abort without creating a clip.
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.trackStoreValue.value = { tracks: [], selectedTrackId: null };
        mocks.addTrack.mockReturnValue(null);

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('recognizes an audio file by extension when the MIME type is empty', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        // A file whose type is '' (common for OS-level drops) but whose name
        // carries an audio extension must still be treated as audio.
        const mockFile = new File([''], 'loop.flac', { type: '' });
        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: () => '',
                files: [mockFile],
            },
        };

        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }] } as any;
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-flac', buffer: { duration: 1 } });

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(mocks.decodeAudioFile).toHaveBeenCalledWith(mockFile);
            expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ audioBufferId: 'buf-flac' }));
        });
    });

    it('aborts a raw audio file drop when no new audio track could be created', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        const mockFile = new File([''], 'kick.wav', { type: 'audio/wav' });
        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: () => '',
                files: [mockFile],
            },
        };

        // No eligible track and addTrack returns null -> abort, no clip.
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.trackStoreValue.value = { tracks: [], selectedTrackId: null };
        mocks.addTrack.mockReturnValue(null);

        await act(async () => {
            await result.current.handleFileDrop(mockEvent as any);
        });

        expect(mocks.addClip).not.toHaveBeenCalled();
    });
});
