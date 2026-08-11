import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { grinderNeuralLibraryStore } from '../../../stores/grinderNeuralLibraryStore';
import { grinderStore } from '../../../stores/grinderStore';
import { GrinderPanel } from '../GrinderPanel';

vi.mock('../../../useCases/importGrinderNeuralModels', () => ({
    importGrinderNeuralModels: vi.fn(async () => []),
}));

vi.mock('../../../useCases/restoreGrinderNeuralLibrary', () => ({
    restoreGrinderNeuralLibrary: vi.fn(async () => undefined),
}));

describe('GrinderPanel', () => {
    const device_id = 'test-device';

    function grinderTrack(parameterValues: Record<string, number>): Track {
        return {
            ...createTrack({ id: 'track-1', name: 'Guitar', kind: 'audio' }),
            devices: [{ id: device_id, name: 'Grinder', type: 'grinder', bypassed: false, parameterValues }],
        };
    }

    beforeEach(() => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            importing: false,
            error: null,
            entries: [],
        });
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'lab',
                    gateEnabled: true,
                },
                basePatch: DEFAULT_PATCH,
            },
        });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('should render an explicit gate enable toggle in the lab section', () => {
        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByRole('button', { name: 'Gate On' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('should render an enabled drive pedal as pressed when the stored patch enables it', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [
                        {
                            id: 'od1',
                            type: 'overdrive',
                            enabled: true,
                            params: { drive: 4.5, tone: 5.5, level: 6.8 },
                        },
                    ],
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByRole('button', { name: 'Overdrive' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('should show non-duplicated neural status content instead of a repeated mode guide', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                    neuralModelName: 'Factory Voice A',
                    neuralModelFamily: 'NAM-compatible',
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.queryByText('Mode guide')).not.toBeInTheDocument();
        expect(screen.getByText('Signal path')).toBeInTheDocument();
        expect(
            screen.getByText(/selecting a library voice now swaps the active built-in capture profile/i)
        ).toBeInTheDocument();
    });

    it('should render the imported captures section in the Neural browser', () => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            importing: false,
            error: null,
            entries: [],
        });
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Imported captures')).toBeInTheDocument();
    });

    it('should keep a patch-only imported fallback visible when the reusable library entry is gone', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                    neuralModelId: 'imported-tight-rhythm',
                    neuralModelName: 'Tight Rhythm',
                    neuralModelFamily: 'NAM import',
                    neuralModelSource: 'imported',
                    neuralPlacement: 'amp-capture',
                    neuralModelProfile: {
                        derivedFrom: 'nam',
                        sourceArchitecture: 'WaveNet',
                        sourceSampleRate: 48_000,
                        sourceWeightCount: 12,
                        preferredTier: 'standard',
                        inputDrive: 1.18,
                        asymmetry: 0.04,
                        outputTrim: 0.9,
                        contourMix: 0.22,
                        recurrentBias: 0.02,
                        convWeights: [
                            [0.1, 0.7, 0.2],
                            [0.09, 0.68, 0.23],
                            [0.12, 0.66, 0.2],
                            [0.11, 0.67, 0.19],
                            [0.08, 0.72, 0.16],
                            [0.07, 0.74, 0.15],
                            [0.13, 0.64, 0.19],
                            [0.1, 0.69, 0.18],
                            [0.09, 0.7, 0.17],
                            [0.11, 0.68, 0.17],
                        ],
                    },
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Selected in this patch')).toBeInTheDocument();
    });

    it('should expose the current front-end pedal chain order in the drive section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [
                        {
                            id: 'dist1',
                            type: 'distortion',
                            enabled: true,
                            params: { drive: 4.2, tone: 4.4, level: 6.0 },
                        },
                        {
                            id: 'od1',
                            type: 'overdrive',
                            enabled: true,
                            params: { drive: 2.8, tone: 5.2, level: 5.4 },
                        },
                    ],
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Chain order')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /1 Distortion/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /2 Overdrive/i })).toBeInTheDocument();
    });

    it('should expose a direct room control in the cab section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Room')).toBeInTheDocument();
    });

    it('should expose cabinet voice, cabinet mode, and routing preset controls in the cab section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                    cabType: 'parametric',
                    cabIrId: '2x12-open',
                    routingMode: 'parallel',
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Cab voice')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '2x12 Open' })).toBeInTheDocument();
        expect(screen.getByText('Cab mode')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Parametric' })).toBeInTheDocument();
        expect(screen.getByText('Routing preset')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Parallel' })).toBeInTheDocument();
    });

    it('should render mic 2 position controls only when mic 2 is enabled', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                    mic2: { ...DEFAULT_PATCH.mic2, enabled: true },
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        const enabled_view = render(<GrinderPanel deviceId={device_id} />);
        expect(within(enabled_view.container).getByText('Mic 2')).toBeInTheDocument();
        enabled_view.unmount();

        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                    mic2: { ...DEFAULT_PATCH.mic2, enabled: false },
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        const disabled_view = render(<GrinderPanel deviceId={device_id} />);
        expect(within(disabled_view.container).queryByText('Mic 2')).not.toBeInTheDocument();
    });

    it('should display the shared compressor threshold default in the drive section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [],
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        // The drive deck falls back to the shared default threshold (-24 dB), matching
        // what the audio sync sends to the worklet.
        expect(screen.getByText('-24.0 dB')).toBeInTheDocument();
    });

    it('should show snapshot recall controls when the patch contains stored snapshots', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    snapshots: [
                        { id: 'clean', name: 'Clean', paramOverrides: { gain: 3 }, bypassStates: { od1: false } },
                        { id: 'drive', name: 'Drive', paramOverrides: { gain: 7 }, bypassStates: { od1: true } },
                    ],
                    activeSnapshot: 1,
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Snapshots')).toBeInTheDocument();
        const snapshots_section = screen.getByText('Snapshots').parentElement;

        expect(snapshots_section).not.toBeNull();
        expect(within(snapshots_section as HTMLElement).getByRole('button', { name: 'Clean' })).toBeInTheDocument();
        expect(within(snapshots_section as HTMLElement).getByRole('button', { name: 'Drive' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('should disable the Import NAM trigger while the shared store reports an import in flight', () => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: true,
            importing: true,
            error: null,
            entries: [],
        });
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        const importing_view = render(<GrinderPanel deviceId={device_id} />);
        const importing_button = within(importing_view.container).getByRole('button', { name: 'Importing…' });
        expect(importing_button).toBeDisabled();
        importing_view.unmount();

        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            importing: false,
            error: null,
            entries: [],
        });

        const idle_view = render(<GrinderPanel deviceId={device_id} />);
        expect(within(idle_view.container).getByRole('button', { name: 'Import NAM' })).toBeEnabled();
    });

    it('labels the Gain parameter knob with an accessible name', () => {
        // The GrinderKnob helper renders the label as a sibling span; the knob
        // itself must carry the name too (not fall back to the generic
        // "Parameter control"), so each param knob is addressable. The Gain knob
        // lives in the amp section.
        grinderStore.set({
            [device_id]: {
                patch: { ...DEFAULT_PATCH, uiSection: 'amp' },
                basePatch: DEFAULT_PATCH,
            },
        });
        render(<GrinderPanel deviceId={device_id} />);
        expect(screen.getByRole('slider', { name: 'Gain' })).toBeInTheDocument();
    });

    it('reconciles a mounted control when project truth changes or removes its value', async () => {
        grinderStore.set({
            [device_id]: {
                patch: { ...DEFAULT_PATCH, uiSection: 'amp', gain: 8 },
                basePatch: DEFAULT_PATCH,
            },
        });
        trackStore.set({
            tracks: [grinderTrack({ gain: 8 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        render(<GrinderPanel deviceId={device_id} />);
        const gain = screen.getByRole('slider', { name: 'Gain' });
        expect(gain).toHaveAttribute('aria-valuenow', '8');

        act(() => {
            trackStore.set({
                tracks: [grinderTrack({ gain: 2 })],
                selectedTrackId: 'track-1',
                ghostClips: [],
            });
        });
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '2'));

        act(() => {
            trackStore.set({
                tracks: [grinderTrack({})],
                selectedTrackId: 'track-1',
                ghostClips: [],
            });
        });
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', String(DEFAULT_PATCH.gain)));
    });
});
