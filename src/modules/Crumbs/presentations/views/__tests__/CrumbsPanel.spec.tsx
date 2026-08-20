import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { crumbsStore, defaultCrumbsState, ensureInstance, setActiveSample, setMode } from '../../../stores/crumbsStore';
import { ensurePadInstance, padStore } from '../../../stores/padStore';
import { ensureSliceInstance, sliceStore } from '../../../stores/sliceStore';
import { initCrumbsEngine } from '../../../useCases/crumbsLifecycle/initCrumbsEngine';
import { armCrumbsRecording } from '../../../useCases/recording/armCrumbsRecording';
import { CrumbsPanel } from '../CrumbsPanel';

import type { SampleMeta } from '../../../models/CrumbsTypes';

// Engine lifecycle and position polling reach the desktop bridge; stub them so the
// render exercises real store-driven DOM without IPC. The panel still drives its
// own `useStoreSelector` against the real signal stores.
vi.mock('../../../useCases/crumbsLifecycle/initCrumbsEngine', () => ({
    initCrumbsEngine: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../useCases/crumbsLifecycle/teardownCrumbsEngine', () => ({
    teardownCrumbsEngine: vi.fn().mockResolvedValue(undefined),
}));
// Silence the engine-init warning the panel logs when init rejects.
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// The recorder controls reach the desktop bridge too; the readout under test is
// how the panel renders their outcome, so the outcome is what is stubbed.
vi.mock('../../../useCases/recording/armCrumbsRecording', () => ({
    armCrumbsRecording: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../useCases/recording/stopCrumbsRecording', () => ({
    stopCrumbsRecording: vi.fn().mockResolvedValue(undefined),
}));

const initEngineMock = vi.mocked(initCrumbsEngine);
const armRecordingMock = vi.mocked(armCrumbsRecording);

const DEVICE = 'panel-test';

function crumbsTrack(parameterValues: Record<string, number>): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Sampler', kind: 'audio' }),
        devices: [{ id: DEVICE, name: 'Crumbs', type: 'builtin-crumbs', bypassed: false, parameterValues }],
    };
}

function setProjectParameters(parameterValues: Record<string, number>): void {
    trackStore.set({ tracks: [crumbsTrack(parameterValues)], selectedTrackId: 'track-1', ghostClips: [] });
}

function seedSample(overrides: Partial<SampleMeta> = {}): SampleMeta {
    return {
        sampleId: 1,
        sampleRate: 48000,
        channels: 2,
        frameCount: 96000,
        durationSecs: 2,
        detectedRoot: 60,
        detectedBpm: 128,
        category: 'percussive',
        filePath: '/loops/break.wav',
        fileName: 'break.wav',
        ...overrides,
    };
}

beforeEach(() => {
    // Reset to an empty (non-null) record so `ensureInstance` actually seeds the
    // instance — `clear()` would null the store and `ensureInstance` returns an
    // empty record on null, dropping the subsequent state writes.
    crumbsStore.set({});
    padStore.set({});
    sliceStore.set({});
    ensureInstance(DEVICE);
    ensurePadInstance(DEVICE);
    ensureSliceInstance(DEVICE);
    initEngineMock.mockReset();
    initEngineMock.mockResolvedValue(undefined);
    armRecordingMock.mockReset();
    armRecordingMock.mockResolvedValue(true);
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('CrumbsPanel', () => {
    it('reconciles a mounted control when project truth changes or removes its value', async () => {
        setProjectParameters({ masterGain: defaultCrumbsState.masterGain });

        render(<CrumbsPanel deviceId={DEVICE} />);
        const gain = screen.getByRole('slider', { name: 'Gain' });

        act(() => {
            setProjectParameters({ masterGain: 99, stackCount: 1.5 });
        });
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '2'));
        expect(screen.getByRole('slider', { name: 'Voices' })).toHaveAttribute('aria-valuenow', '1');

        act(() => {
            setProjectParameters({});
        });
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', String(defaultCrumbsState.masterGain)));
    });

    it('renders the always-present sections', () => {
        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getByText('Sample')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Controls')).toBeInTheDocument();
        expect(screen.getByText('Waveform')).toBeInTheDocument();
    });

    it('prompts to drop a sample when none is loaded', () => {
        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getByText('Drop a sample to begin')).toBeInTheDocument();
        // Empty-state shows no detected-metadata tiles.
        expect(screen.queryByText('Sample rate')).not.toBeInTheDocument();
    });

    it('renders sample metadata tiles once a sample is active', () => {
        setActiveSample(DEVICE, seedSample());
        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.queryByText('Drop a sample to begin')).not.toBeInTheDocument();
        expect(screen.getByText('Sample rate')).toBeInTheDocument();
        // 48000 Hz → "48.0k".
        expect(screen.getByText('48.0k')).toBeInTheDocument();
        // 2s duration → "2.00s".
        expect(screen.getByText('2.00s')).toBeInTheDocument();
        // Category is rendered as the classification tile value.
        expect(screen.getByText('percussive')).toBeInTheDocument();
    });

    it('shows an em dash for missing root and bpm', () => {
        setActiveSample(DEVICE, seedSample({ detectedRoot: null, detectedBpm: null }));
        render(<CrumbsPanel deviceId={DEVICE} />);

        // Both Root and BPM tiles fall back to the em dash.
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    });

    // The status readout sits in a LED beside an icon, so match on the LED
    // element's own text content rather than a fragmented text node.
    const hasOwnText =
        (text: string) =>
        (_content: string, el: Element | null): boolean =>
            el?.textContent === text;

    it('shows "Loading..." until engine init resolves, then "Ready"', async () => {
        // Init is gated: engineReady starts null → "Loading...", flips to "Ready"
        // only once initCrumbsEngine resolves. This guards against the LED reading
        // "Ready" while param writes silently no-op against a missing backend.
        let resolveInit: () => void = () => undefined;
        initEngineMock.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveInit = resolve;
            })
        );

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getAllByText(hasOwnText('Loading...')).length).toBeGreaterThan(0);
        expect(screen.queryAllByText(hasOwnText('Ready'))).toHaveLength(0);

        resolveInit();
        expect(await screen.findByText(hasOwnText('Ready'))).toBeInTheDocument();
        expect(screen.queryAllByText(hasOwnText('Loading...'))).toHaveLength(0);
    });

    it('shows "Engine unavailable" when engine init rejects', async () => {
        initEngineMock.mockRejectedValueOnce(new Error('engine boot failed'));

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(await screen.findByText(hasOwnText('Engine unavailable'))).toBeInTheDocument();
        expect(screen.queryAllByText(hasOwnText('Ready'))).toHaveLength(0);
    });

    it('shows the pad bay only in drum mode', () => {
        render(<CrumbsPanel deviceId={DEVICE} />);
        // Default mode is 'quick' — no pad bay.
        expect(screen.queryByText('Pad bay')).not.toBeInTheDocument();
    });

    it('renders the pad bay when mode is drum', () => {
        setMode(DEVICE, 'drum');
        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getByText('Pad bay')).toBeInTheDocument();
    });

    it('renders the recorder controls when mode is record', () => {
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);

        const recorder = screen.getByText('Recorder').closest('div');
        expect(recorder).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Arm' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
        expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('reads "Recording..." once the arm is accepted', async () => {
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));

        expect(await screen.findByText('Recording...')).toBeInTheDocument();
    });

    it('leaves the recorder Idle when the arm is refused', async () => {
        // The native crumbs instance is absent whenever the backend engine is
        // not running, so `arm_recording` rejects and no take is ever opened.
        // A readout driven by the click rather than the outcome told the
        // musician a take was running, and the loss only surfaced at stop.
        armRecordingMock.mockRejectedValueOnce(new Error('Crumbs instance not found'));
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));

        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Idle')).toBeInTheDocument();
        expect(screen.queryByText('Recording...')).not.toBeInTheDocument();
    });

    it('leaves the recorder Idle when the arm resolves without arming', async () => {
        // The use case refuses an instance with no pads before it reaches the
        // bridge. That resolves, so only the reported outcome distinguishes it
        // from an open take.
        armRecordingMock.mockResolvedValueOnce(false);
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));

        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Idle')).toBeInTheDocument();
        expect(screen.queryByText('Recording...')).not.toBeInTheDocument();
    });

    it('ignores an arm that resolves after Stop was pressed', async () => {
        // The arm's IPC round trip can outlive a Stop press. The stop request
        // leaves after the arm request, so the recorder really is stopped —
        // a stale arm resolution writing the readout would flip the LED back
        // to "Recording..." over a closed take.
        let resolveArm: (armed: boolean) => void = () => undefined;
        armRecordingMock.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveArm = resolve;
                })
        );
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        resolveArm(true);

        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Idle')).toBeInTheDocument();
        expect(screen.queryByText('Recording...')).not.toBeInTheDocument();
    });

    it('renders the slice controls when mode is slice and a sample is loaded', () => {
        setMode(DEVICE, 'slice');
        setActiveSample(DEVICE, seedSample());
        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getByText('Slices')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Auto-detect slices' })).toBeInTheDocument();
    });

    it('offers loop-point detection only once a sample is loaded', () => {
        const { unmount } = render(<CrumbsPanel deviceId={DEVICE} />);
        expect(screen.queryByRole('button', { name: 'Detect loop points' })).not.toBeInTheDocument();
        unmount();

        setActiveSample(DEVICE, seedSample());
        render(<CrumbsPanel deviceId={DEVICE} />);
        expect(screen.getByRole('button', { name: 'Detect loop points' })).toBeInTheDocument();
    });

    it('surfaces the active-voice count from store state', () => {
        crumbsStore.update((s) => ({
            ...s,
            [DEVICE]: { ...s![DEVICE]!, activeVoices: 3 },
        }));
        render(<CrumbsPanel deviceId={DEVICE} />);

        // The count sits in a LED beside a CPU icon, so the literal text is split
        // across nodes — match on the LED element's own normalized text content.
        const isThreeVoices = (_content: string, el: Element | null): boolean => {
            const text = (el?.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
            return text === '3 voices';
        };
        expect(screen.getAllByText(isThreeVoices).length).toBeGreaterThan(0);
    });
});
