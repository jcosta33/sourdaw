import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTimelineFileDrop } from '../useTimelineFileDrop';

type TrackStoreSubscribe = (typeof import('../../../stores/trackStore'))['trackStore']['subscribe'];
type TimelineDropTrack = {
    id: string;
    kind: string;
    clips?: Array<{ id: string }>;
};
type TimelineDropTrackState = {
    tracks: TimelineDropTrack[];
    selectedTrackId?: string | null;
};

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: TimelineDropTrackState } = {
        value: { tracks: [], selectedTrackId: null },
    };
    return {
        hitTestTrack: vi.fn(),
        trackStoreValue,
        buildTimelineRenderModel: vi.fn(),
        notifyUser: vi.fn(),
        getAssetTransfer: vi.fn(),
        decodeAudioFile: vi.fn(),
        discardDecodedAudioFile: vi.fn(),
        getCachedAudioBuffer: vi.fn(),
        resolveDroppedSampleFile: vi.fn(),
        addClip: vi.fn(),
        executeAddDeviceAction: vi.fn(),
        executeAppAction: vi.fn(),
        addTrack: vi.fn(),
        importMidiFile: vi.fn(),
    };
});
const projectEpoch = vi.hoisted(() => {
    let epoch = 0;
    let latest: { isCurrent: () => boolean } | null = null;
    const makeAuthority = () => {
        const capturedEpoch = epoch;
        return { isCurrent: () => epoch === capturedEpoch };
    };
    return {
        advance: () => {
            epoch += 1;
        },
        capture: vi.fn(() => {
            latest = makeAuthority();
            return latest;
        }),
        currentAuthority: makeAuthority,
        latest: () => latest,
        reset: () => {
            epoch = 0;
            latest = null;
        },
    };
});

vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({
    hitTestTrack: mocks.hitTestTrack,
}));

vi.mock('../../../stores/trackStore', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
        subscribe: vi.fn<TrackStoreSubscribe>((_callback) => () => {}),
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
    discardDecodedAudioFile: mocks.discardDecodedAudioFile,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: projectEpoch.capture,
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: mocks.addClip,
}));

vi.mock('../../../useCases/device/executeAddDeviceAction', () => ({
    executeAddDeviceAction: mocks.executeAddDeviceAction,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    executeAppAction: mocks.executeAppAction,
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
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
        projectEpoch.reset();
        mocks.buildTimelineRenderModel.mockReturnValue({ tempo: 120 });
        mocks.getAssetTransfer.mockReturnValue({
            stageLocalAsset: vi.fn().mockResolvedValue({ hash: 'hash', leaseId: 'lease' }),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        });
        mocks.trackStoreValue.value = { tracks: [], selectedTrackId: null };
        // Default: nothing in the buffer cache → drops take the file-read/decode path.
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'unresolved' });
        mocks.executeAddDeviceAction.mockResolvedValue({ status: 'applied', deviceId: 'device-1' });
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.addClip.mockReturnValue({ id: 'clip-imported' });
        mocks.importMidiFile.mockResolvedValue('completed');
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
            expect(mocks.executeAddDeviceAction).toHaveBeenCalledWith('t1', 'p1');
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
            expect(mocks.executeAddDeviceAction).toHaveBeenCalledWith('t1', 'faust-de-esser');
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
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'desktop', file });
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
        const transfer = mocks.getAssetTransfer.mock.results[0]?.value;
        expect(transfer.promoteStagedAsset).toHaveBeenCalledOnce();
        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('resolves a browser-root sample through the SampleLibrary resolver before decoding', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const file = new File(['audio'], 'clap.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'browser', file });
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-browser', buffer: { duration: 1.5 } });
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' };

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

    it('retains the drop-time selected track while a library file resolves', async () => {
        const file = new File(['audio'], 'clap.wav', { type: 'audio/wav' });
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.trackStoreValue.value = {
            tracks: [
                { id: 't1', kind: 'audio' },
                { id: 't2', kind: 'audio' },
            ],
            selectedTrackId: 't1',
        };
        mocks.resolveDroppedSampleFile.mockImplementationOnce(async () => {
            mocks.trackStoreValue.value = {
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't2', kind: 'audio' },
                ],
                selectedTrackId: 't2',
            };
            return { status: 'resolved', provider: 'browser', file };
        });
        mocks.decodeAudioFile.mockResolvedValueOnce({ id: 'buf-browser', buffer: { duration: 1 } });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
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
            } as any);
        });

        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1' }));
        expect(mocks.addClip).not.toHaveBeenCalledWith(expect.objectContaining({ trackId: 't2' }));
    });

    it('cancels a library import when its captured target disappears', async () => {
        const file = new File(['audio'], 'gone.wav', { type: 'audio/wav' });
        const transfer = {
            stageLocalAsset: vi.fn(async () => {
                mocks.trackStoreValue.value = {
                    tracks: [{ id: 'successor-track', kind: 'audio', clips: [{ id: 'successor-clip' }] }],
                    selectedTrackId: 'successor-track',
                };
                return { hash: 'gone-hash', leaseId: 'gone-lease' };
            }),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        };
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.hitTestTrack.mockReturnValue('captured-track');
        mocks.trackStoreValue.value = {
            tracks: [{ id: 'captured-track', kind: 'audio', clips: [] }],
            selectedTrackId: 'captured-track',
        };
        mocks.resolveDroppedSampleFile.mockResolvedValueOnce({ status: 'resolved', provider: 'browser', file });
        mocks.decodeAudioFile.mockResolvedValueOnce({ id: 'gone-buffer', buffer: { duration: 1 } });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: {
                    getData: (type: string) =>
                        type === 'application/x-sourdaw-sample'
                            ? JSON.stringify({
                                  name: 'Gone',
                                  id: 'gone-sample',
                                  path: 'gone.wav',
                                  libraryRootId: 'root-browser',
                              })
                            : '',
                    files: [],
                },
            } as any);
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('gone-lease');
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('gone-buffer');
        expect(mocks.trackStoreValue.value.tracks[0]?.clips).toEqual([{ id: 'successor-clip' }]);
    });

    it('aborts a decoded library import when asset staging fails', async () => {
        const file = new File(['audio'], 'unstaged.wav', { type: 'audio/wav' });
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' };
        mocks.resolveDroppedSampleFile.mockResolvedValueOnce({ status: 'resolved', provider: 'browser', file });
        mocks.decodeAudioFile.mockResolvedValueOnce({ id: 'unstaged-buffer', buffer: { duration: 1 } });
        mocks.getAssetTransfer.mockReturnValueOnce({
            stageLocalAsset: vi.fn().mockRejectedValue(new Error('AssetTransfer is disposed')),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: {
                    getData: (type: string) =>
                        type === 'application/x-sourdaw-sample'
                            ? JSON.stringify({
                                  name: 'Unstaged',
                                  id: 'unstaged-sample',
                                  path: 'unstaged.wav',
                                  libraryRootId: 'root-browser',
                              })
                            : '',
                    files: [],
                },
            } as any);
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('unstaged-buffer');
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "Unstaged" — asset registration failed',
            'error'
        );
    });

    it('silently cleans a decoded library import when stale staging fails', async () => {
        const file = new File(['audio'], 'stale-stage.wav', { type: 'audio/wav' });
        mocks.hitTestTrack.mockReturnValue('same-track');
        mocks.trackStoreValue.value = {
            tracks: [{ id: 'same-track', kind: 'audio', clips: [{ id: 'successor-clip' }] }],
            selectedTrackId: 'same-track',
        };
        mocks.resolveDroppedSampleFile.mockResolvedValueOnce({ status: 'resolved', provider: 'browser', file });
        mocks.decodeAudioFile.mockResolvedValueOnce({ id: 'stale-stage-buffer', buffer: { duration: 1 } });
        mocks.getAssetTransfer.mockReturnValueOnce({
            stageLocalAsset: vi.fn(async () => {
                projectEpoch.advance();
                throw new Error('AssetTransfer is disposed');
            }),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: {
                    getData: (type: string) =>
                        type === 'application/x-sourdaw-sample'
                            ? JSON.stringify({
                                  name: 'Stale stage',
                                  id: 'stale-stage-sample',
                                  path: 'stale-stage.wav',
                                  libraryRootId: 'root-browser',
                              })
                            : '',
                    files: [],
                },
            } as any);
        });

        expect(projectEpoch.latest()?.isCurrent()).toBe(false);
        expect(projectEpoch.currentAuthority().isCurrent()).toBe(true);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('stale-stage-buffer');
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.trackStoreValue.value.tracks[0]?.clips).toEqual([{ id: 'successor-clip' }]);

        const successorFile = new File(['audio'], 'successor.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValueOnce({
            status: 'resolved',
            provider: 'browser',
            file: successorFile,
        });
        mocks.decodeAudioFile.mockResolvedValueOnce({ id: 'successor-buffer', buffer: { duration: 1 } });
        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: {
                    getData: (type: string) =>
                        type === 'application/x-sourdaw-sample'
                            ? JSON.stringify({
                                  name: 'Successor',
                                  id: 'successor-sample',
                                  path: 'successor.wav',
                                  libraryRootId: 'root-browser',
                              })
                            : '',
                    files: [],
                },
            } as any);
        });

        expect(projectEpoch.latest()?.isCurrent()).toBe(true);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'same-track',
                audioBufferId: 'successor-buffer',
                name: 'Successor',
            })
        );
    });

    it('warns with the decode message when a native-root sample file cannot be decoded', async () => {
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const file = new File(['not-audio'], 'broken.wav', { type: 'audio/wav' });
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', provider: 'desktop', file });
        mocks.decodeAudioFile.mockRejectedValue(new Error('decode failed'));
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' };

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
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' };

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

    it('keeps a forwarded MIDI continuation bound to its drop epoch', async () => {
        mocks.importMidiFile.mockImplementationOnce(async (_file, options) => {
            expect(options.shouldContinue()).toBe(true);
            projectEpoch.advance();
            expect(options.shouldContinue()).toBe(false);
            return 'superseded';
        });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

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

        expect(mocks.importMidiFile).toHaveBeenCalledTimes(1);
        const originalOptions = mocks.importMidiFile.mock.calls[0]?.[1];
        expect(originalOptions?.shouldContinue()).toBe(false);

        const successorFile = new File(['MThd'], 'successor.mid', { type: 'audio/midi' });
        mocks.importMidiFile.mockResolvedValueOnce('completed');
        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: { getData: () => '', files: [successorFile] },
            } as any);
        });

        const successorOptions = mocks.importMidiFile.mock.calls[1]?.[1];
        expect(successorOptions?.shouldContinue()).toBe(true);
        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
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
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' };

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
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }], selectedTrackId: 't1' };

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
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }] };
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
        const transfer = mocks.getAssetTransfer.mock.results[0]?.value;
        expect(transfer.promoteStagedAsset).toHaveBeenCalledOnce();
        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('retains the drop-time selected track while an ordinary audio file decodes', async () => {
        const file = new File(['audio'], 'held.wav', { type: 'audio/wav' });
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.trackStoreValue.value = {
            tracks: [
                { id: 't1', kind: 'audio' },
                { id: 't2', kind: 'audio' },
            ],
            selectedTrackId: 't1',
        };
        mocks.decodeAudioFile.mockImplementationOnce(async () => {
            mocks.trackStoreValue.value = {
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't2', kind: 'audio' },
                ],
                selectedTrackId: 't2',
            };
            return { id: 'held-buffer', buffer: { duration: 1 } };
        });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: { getData: () => '', files: [file] },
            } as any);
        });

        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1' }));
        expect(mocks.addClip).not.toHaveBeenCalledWith(expect.objectContaining({ trackId: 't2' }));
    });

    it('cancels an ordinary audio import when its captured target disappears', async () => {
        const file = new File(['audio'], 'gone.wav', { type: 'audio/wav' });
        const transfer = {
            stageLocalAsset: vi.fn(async () => {
                mocks.trackStoreValue.value = {
                    tracks: [{ id: 'successor-track', kind: 'audio', clips: [{ id: 'successor-clip' }] }],
                    selectedTrackId: 'successor-track',
                };
                return { hash: 'gone-hash', leaseId: 'gone-lease' };
            }),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        };
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.hitTestTrack.mockReturnValue('captured-track');
        mocks.trackStoreValue.value = {
            tracks: [{ id: 'captured-track', kind: 'audio', clips: [] }],
            selectedTrackId: 'captured-track',
        };
        mocks.decodeAudioFile.mockResolvedValueOnce({ id: 'gone-buffer', buffer: { duration: 1 } });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: { getData: () => '', files: [file] },
            } as any);
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('gone-lease');
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('gone-buffer');
        expect(mocks.trackStoreValue.value.tracks[0]?.clips).toEqual([{ id: 'successor-clip' }]);
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
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', kind: 'audio' }] };
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

    it('does not create a sample target track while file resolution belongs to a superseded project', async () => {
        let resolveSample!: (value: { status: 'resolved'; provider: 'browser'; file: File }) => void;
        mocks.resolveDroppedSampleFile.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSample = resolve;
            })
        );
        mocks.hitTestTrack.mockReturnValue(null);
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));
        const dropPromise = act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: {
                    getData: (type: string) =>
                        type === 'application/x-sourdaw-sample'
                            ? JSON.stringify({
                                  name: 'Stale sample',
                                  id: 'sample-stale',
                                  path: 'stale.wav',
                                  libraryRootId: 'root',
                              })
                            : '',
                    files: [],
                },
            } as any);
        });

        projectEpoch.advance();
        expect(projectEpoch.latest()?.isCurrent()).toBe(false);
        expect(projectEpoch.currentAuthority().isCurrent()).toBe(true);
        resolveSample({
            status: 'resolved',
            provider: 'browser',
            file: new File(['audio'], 'stale.wav', { type: 'audio/wav' }),
        });
        await dropPromise;

        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('releases the captured staged lease and decoded buffer when an audio drop is superseded during hashing', async () => {
        const transfer = {
            stageLocalAsset: vi.fn(async () => {
                projectEpoch.advance();
                return { hash: 'hash-stale', leaseId: 'lease-stale' };
            }),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        };
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.decodeAudioFile.mockResolvedValue({ id: 'audio-stale', buffer: { duration: 1 } });
        const file = new File(['audio'], 'stale.wav', { type: 'audio/wav' });
        const { result } = renderHook(() => useTimelineFileDrop({ getCanvasCoords, getBeatFromX }));

        await act(async () => {
            await result.current.handleFileDrop({
                preventDefault: vi.fn(),
                dataTransfer: { getData: () => '', files: [file] },
            } as any);
        });

        expect(mocks.getAssetTransfer).toHaveBeenCalledTimes(1);
        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('lease-stale');
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('audio-stale');
        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(projectEpoch.latest()?.isCurrent()).toBe(false);
        expect(projectEpoch.currentAuthority().isCurrent()).toBe(true);
    });
});
