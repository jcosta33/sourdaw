import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { crumbsEngineAttachmentStore, markCrumbsInstanceAttached } from '../../../stores/crumbsEngineAttachmentStore';
import { crumbsStore, defaultCrumbsState, ensureInstance, setActiveSample, setMode } from '../../../stores/crumbsStore';
import { ensurePadInstance, padStore } from '../../../stores/padStore';
import { ensureSliceInstance, sliceStore } from '../../../stores/sliceStore';
import { ensureCrumbsInstanceFromProject } from '../../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject';
import { armCrumbsRecording } from '../../../useCases/recording/armCrumbsRecording';
import { switchCrumbsMode } from '../../../useCases/setCrumbsMode';
import { setCrumbsParamWithAudio } from '../../../useCases/setCrumbsParamWithAudio';
import { CrumbsPanel } from '../CrumbsPanel';

import type { SampleMeta } from '../../../models/CrumbsTypes';

// Whether a native runtime is in question at all is a desktop-bridge read; the
// panel's readout is what is under test, so the answer is what is stubbed. The
// double is hoisted rather than imported back: presentation code, tests
// included, does not reach a repository directly.
const nativeAvailableMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../../repositories/crumbsBridge/isCrumbsNativeAvailable', () => ({
    isCrumbsNativeAvailable: nativeAvailableMock,
}));
// The panel's own ensure seeds an instance entry on mount, which is one of the
// two witnesses the readout reads. Stubbed so a test can present the panel with
// a device the runtime holds no instance for.
vi.mock('../../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject', () => ({
    ensureCrumbsInstanceFromProject: vi.fn(),
}));
// Silence the warnings the panel logs from its recorder controls.
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
vi.mock('../../../useCases/setCrumbsMode', () => ({
    switchCrumbsMode: vi.fn(),
}));
vi.mock('../../../useCases/setCrumbsParamWithAudio', () => ({
    setCrumbsParamWithAudio: vi.fn(),
}));

const ensureInstanceFromProjectMock = vi.mocked(ensureCrumbsInstanceFromProject);
const armRecordingMock = vi.mocked(armCrumbsRecording);
const switchModeMock = vi.mocked(switchCrumbsMode);
const setParamMock = vi.mocked(setCrumbsParamWithAudio);

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
    crumbsEngineAttachmentStore.set(new Set<string>());
    ensureInstance(DEVICE);
    ensurePadInstance(DEVICE);
    ensureSliceInstance(DEVICE);
    nativeAvailableMock.mockReset();
    nativeAvailableMock.mockReturnValue(false);
    ensureInstanceFromProjectMock.mockReset();
    armRecordingMock.mockReset();
    armRecordingMock.mockResolvedValue(true);
    switchModeMock.mockReset();
    setParamMock.mockReset();
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

    it('forwards mode and parameter control interactions to their use cases', () => {
        render(<CrumbsPanel deviceId={DEVICE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Drum' }));
        expect(switchModeMock).toHaveBeenCalledExactlyOnceWith(DEVICE, 'drum');

        const gain = screen.getByRole('slider', { name: 'Gain' });
        expect(gain).toHaveAttribute('aria-valuenow', '0.8');
        fireEvent.keyDown(gain, { key: 'ArrowUp' });
        expect(setParamMock).toHaveBeenCalledExactlyOnceWith(DEVICE, 'masterGain', 0.81, false);
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

    // The panel no longer owns the instance's lifetime (#4204), so the readout
    // is read from the engine's own state rather than remembered from one
    // resolved promise at mount.
    it('reads "Ready" from the engine attaching this instance, with no instance state of its own', async () => {
        nativeAvailableMock.mockReturnValue(true);
        crumbsStore.set({});

        render(<CrumbsPanel deviceId={DEVICE} />);
        expect(screen.getAllByText(hasOwnText('Engine unavailable')).length).toBeGreaterThan(0);

        act(() => {
            markCrumbsInstanceAttached(DEVICE);
        });

        expect(await screen.findByText(hasOwnText('Ready'))).toBeInTheDocument();
        expect(screen.queryAllByText(hasOwnText('Engine unavailable'))).toHaveLength(0);
    });

    it('shows "Engine unavailable" when the native runtime holds no instance for this device', () => {
        // What a refused `create_crumbs` leaves behind: the sync rolls the
        // instance state back, so a populated-but-dead panel cannot read
        // "Ready" while every parameter write silently no-ops.
        nativeAvailableMock.mockReturnValue(true);
        crumbsStore.set({});

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getAllByText(hasOwnText('Engine unavailable')).length).toBeGreaterThan(0);
        expect(screen.queryAllByText(hasOwnText('Ready'))).toHaveLength(0);
    });

    it('shows "Loading..." rather than an engine verdict on a build with no native runtime', () => {
        // Nothing native is in question in the browser build, so the absence of
        // an instance entry in the frames before the mount ensure lands is not
        // a backend that failed.
        crumbsStore.set({});

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getAllByText(hasOwnText('Loading...')).length).toBeGreaterThan(0);
        expect(screen.queryAllByText(hasOwnText('Engine unavailable'))).toHaveLength(0);
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

    it('establishes min-height floor and allows bottom drawer scrolling without overflow-hidden', () => {
        const { container } = render(<CrumbsPanel deviceId={DEVICE} />);
        const faceplate = container.querySelector<HTMLElement>('.crumbs-faceplate');
        expect(faceplate).not.toBeNull();
        expect(faceplate?.className).toContain('min-h-[440px]');
        expect(faceplate?.className).not.toContain('overflow-hidden');

        const grid = faceplate?.querySelector<HTMLElement>('.grid');
        expect(grid).not.toBeNull();
        expect(grid?.className).toContain('min-h-[440px]');
    });

    it('prevents section cards from collapsing when faceplate is compressed', () => {
        setMode(DEVICE, 'drum');
        const { container } = render(<CrumbsPanel deviceId={DEVICE} />);
        const cards = container.querySelectorAll('.crumbs-window.shrink-0');
        expect(cards.length).toBeGreaterThanOrEqual(5);
        for (const title of ['Sample', 'Pad bay', 'Status', 'Waveform', 'Controls']) {
            const heading = screen.getByText(title);
            const section = heading.closest('section');
            expect(section).not.toBeNull();
            expect(section?.className).toContain('shrink-0');
            expect(section?.className).toContain('crumbs-window');
        }
    });
});
