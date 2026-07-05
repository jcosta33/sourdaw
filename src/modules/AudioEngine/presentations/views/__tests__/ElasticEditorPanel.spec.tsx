import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const callOrder: string[] = [];
    return {
        callOrder,
        setElasticTool: vi.fn(),
        setElasticSensitivity: vi.fn(),
        detectTransientsForClip: vi.fn(() => {
            callOrder.push('detect');
        }),
        markElasticDetectionComplete: vi.fn(() => {
            callOrder.push('mark');
        }),
        selectElasticMarkers: vi.fn(),
        quantizeTransients: vi.fn(),
        addManualMarker: vi.fn(),
        removeMarker: vi.fn(),
        toggleMarkerLock: vi.fn(),
        setStretchMode: vi.fn(),
        setDefaultAlgorithm: vi.fn(),
        getWaveformPeaks: vi.fn(() => new Float32Array(200).fill(0.3)),
        trackStoreValue: {
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }],
                },
            ],
            selectedTrackId: 't1',
        },
        workspaceStoreValue: {
            selectedClipId: 'c1',
            snapValue: 0.25,
        },
        elasticStoreValue: {
            openClipId: 'c1',
            tool: 'select' as const,
            sensitivity: 0.5,
            selectedMarkerIds: [],
            detected: true,
        },
        warpStates: new Map<
            string,
            {
                enabled: boolean;
                markers: Array<{
                    id: string;
                    originalBeat: number;
                    warpedBeat: number;
                    origin?: 'user' | 'transient-auto' | 'grid-snap';
                    confidence?: number;
                    locked?: boolean;
                }>;
                stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
                originalTempo: number | null;
            }
        >([
            [
                'c1',
                {
                    enabled: true,
                    markers: [
                        { id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'transient-auto', confidence: 0.9 },
                        { id: 'm2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
                    ],
                    stretchMode: 'complex' as const,
                    originalTempo: null,
                },
            ],
        ]),
    };
});

vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, fallback?: unknown) => {
        const marker = (store as { __kind?: string }).__kind;
        if (marker === 'elastic') {
            return mocks.elasticStoreValue;
        }
        if (marker === 'track') {
            return mocks.trackStoreValue;
        }
        if (marker === 'workspace') {
            return mocks.workspaceStoreValue;
        }
        if (marker === 'warp') {
            return { clipSettings: new Map(), defaultAlgorithm: 'complex-pro', globalPitchShift: 0 };
        }
        return fallback ?? null;
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        trackStore: { __kind: 'track' },
        defaultTrackState: { tracks: [], selectedTrackId: null },
        warpStates: mocks.warpStates,
        getWarpState: (clipId: string) =>
            mocks.warpStates.get(clipId) ?? {
                enabled: false,
                markers: [],
                stretchMode: 'complex',
                originalTempo: null,
            },
    };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        setStretchMode: (...args: unknown[]) => mocks.setStretchMode(...args),
    };
});

vi.mock('#/modules/Workspace/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        workspaceStore: { __kind: 'workspace' },
        defaultWorkspaceState: { selectedClipId: null, snapValue: 1 },
    };
});

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_name: string, fallback: string) => fallback,
}));

vi.mock('../../../stores/elasticAudio', () => ({
    elasticAudioStore: {
        __kind: 'elastic',
        value: mocks.elasticStoreValue,
        set: (v: unknown) => {
            Object.assign(mocks.elasticStoreValue, v as object);
        },
    },
    defaultElasticAudioState: {
        openClipId: null,
        tool: 'select',
        sensitivity: 0.5,
        selectedMarkerIds: [],
        detected: false,
    },
}));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        getWaveformPeaks: (...args: unknown[]) => mocks.getWaveformPeaks(...args),
    },
}));

vi.mock('../../../stores/audioWarp', () => ({
    audioWarpStore: { __kind: 'warp' },
}));

vi.mock('../../../useCases/audioWarping/getAlgorithmInfo', () => ({
    getAlgorithmInfo: (id: string) => ({
        name: `algo:${id}`,
        quality: 'high',
        cpuCost: 'high',
        bestFor: '',
        realTime: true,
    }),
}));

vi.mock('../../../useCases/audioWarping/setDefaultAlgorithm', () => ({
    setDefaultAlgorithm: (...args: unknown[]) => mocks.setDefaultAlgorithm(...args),
}));

vi.mock('../../../useCases/elasticAudio/addManualMarker', () => ({
    addManualMarker: (...args: unknown[]) => mocks.addManualMarker(...args),
}));

vi.mock('../../../useCases/elasticAudio/detectTransientsForClip', () => ({
    detectTransientsForClip: (...args: unknown[]) => mocks.detectTransientsForClip(...args),
}));

vi.mock('../../../useCases/elasticAudio/markElasticDetectionComplete', () => ({
    markElasticDetectionComplete: (...args: unknown[]) => mocks.markElasticDetectionComplete(...args),
}));

vi.mock('../../../useCases/elasticAudio/quantizeTransients', () => ({
    quantizeTransients: (...args: unknown[]) => mocks.quantizeTransients(...args),
}));

vi.mock('../../../useCases/elasticAudio/removeMarker', () => ({
    removeMarker: (...args: unknown[]) => mocks.removeMarker(...args),
}));

vi.mock('../../../useCases/elasticAudio/setElasticSensitivity', () => ({
    setElasticSensitivity: (...args: unknown[]) => mocks.setElasticSensitivity(...args),
}));

vi.mock('../../../useCases/elasticAudio/setElasticTool', () => ({
    setElasticTool: (...args: unknown[]) => mocks.setElasticTool(...args),
}));

vi.mock('../../../useCases/elasticAudio/selectElasticMarkers', () => ({
    selectElasticMarkers: (...args: unknown[]) => mocks.selectElasticMarkers(...args),
}));

vi.mock('../../../useCases/elasticAudio/toggleMarkerLock', () => ({
    toggleMarkerLock: (...args: unknown[]) => mocks.toggleMarkerLock(...args),
}));

import { ElasticEditorPanel } from '../ElasticEditorPanel';

describe('ElasticEditorPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.callOrder.length = 0;
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }] }],
            selectedTrackId: 't1',
        };
        mocks.workspaceStoreValue = { selectedClipId: 'c1', snapValue: 0.25 };
        mocks.elasticStoreValue = {
            openClipId: 'c1',
            tool: 'select',
            sensitivity: 0.5,
            selectedMarkerIds: [],
            detected: true,
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders the waveform canvas and marker count for the open clip', () => {
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-waveform-canvas')).toBeInTheDocument();
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 1 user, 0 locked');
    });

    it('calls setElasticSensitivity when the sensitivity slider changes', () => {
        render(<ElasticEditorPanel />);
        const slider = screen.getByLabelText('Transient detection sensitivity');
        expect(slider).toBeInTheDocument();
        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(mocks.setElasticSensitivity).toHaveBeenCalled();
    });

    it('switches tool mode when a tool button is clicked', () => {
        render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-tool-add-marker'));
        expect(mocks.setElasticTool).toHaveBeenCalledWith('add-marker');
        fireEvent.click(screen.getByTestId('elastic-tool-remove-marker'));
        expect(mocks.setElasticTool).toHaveBeenCalledWith('remove-marker');
        fireEvent.click(screen.getByTestId('elastic-tool-lock-marker'));
        expect(mocks.setElasticTool).toHaveBeenCalledWith('lock-marker');
    });

    it('invokes detectTransientsForClip then marks detection complete on Detect button', () => {
        render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        expect(mocks.detectTransientsForClip).toHaveBeenCalledWith('c1', 0.5);
        expect(mocks.markElasticDetectionComplete).toHaveBeenCalledTimes(1);
        expect(mocks.callOrder).toEqual(['detect', 'mark']);
    });

    it('selects an existing marker through the elastic selection use case', () => {
        render(<ElasticEditorPanel />);
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, {
            clientX: 40,
            pointerId: 4,
        });

        expect(mocks.selectElasticMarkers).toHaveBeenCalledWith(['m1']);
        expect(mocks.addManualMarker).not.toHaveBeenCalled();
        expect(mocks.removeMarker).not.toHaveBeenCalled();
        expect(mocks.toggleMarkerLock).not.toHaveBeenCalled();
    });

    it('invokes quantizeTransients on Quantize button when markers exist and detection ran', () => {
        render(<ElasticEditorPanel />);
        const btn = screen.getByTestId('elastic-quantize-button');
        expect(btn).not.toBeDisabled();
        fireEvent.click(btn);
        expect(mocks.quantizeTransients).toHaveBeenCalledWith('c1');
    });

    it('disables the Quantize button when detection has not run', () => {
        mocks.elasticStoreValue = {
            openClipId: 'c1',
            tool: 'select',
            sensitivity: 0.5,
            selectedMarkerIds: [],
            detected: false,
        };
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-quantize-button')).toBeDisabled();
    });

    it('shows an empty state when no audio clip is selected', () => {
        mocks.workspaceStoreValue = { selectedClipId: null, snapValue: 0.25 };
        mocks.elasticStoreValue = {
            openClipId: null,
            tool: 'select',
            sensitivity: 0.5,
            selectedMarkerIds: [],
            detected: false,
        };
        render(<ElasticEditorPanel />);
        expect(screen.getByText(/Select an audio clip/i)).toBeInTheDocument();
    });

    it('shows an empty state when the selected clip is not audio', () => {
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [{ id: 'cmidi', type: 'midi' }] }],
            selectedTrackId: 't1',
        };
        mocks.workspaceStoreValue = { selectedClipId: 'cmidi', snapValue: 0.25 };
        mocks.elasticStoreValue = {
            openClipId: null,
            tool: 'select',
            sensitivity: 0.5,
            selectedMarkerIds: [],
            detected: false,
        };
        render(<ElasticEditorPanel />);
        expect(screen.getByText(/Select an audio clip/i)).toBeInTheDocument();
    });
});
