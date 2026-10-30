import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { crumbsEngineAttachmentStore, markCrumbsInstanceAttached } from '../../../stores/crumbsEngineAttachmentStore';
import {
    crumbsNativeLifecycleStore,
    markCrumbsInstanceBound,
    markCrumbsInstanceCreating,
    markCrumbsInstanceFailed,
} from '../../../stores/crumbsNativeLifecycleStore';
import { crumbsRecordingStore, type CrumbsRecordingSnapshot } from '../../../stores/crumbsRecordingStore';
import { crumbsStore, defaultCrumbsState, ensureInstance, setActiveSample, setMode } from '../../../stores/crumbsStore';
import { ensurePadInstance, padStore } from '../../../stores/padStore';
import { ensureSliceInstance, sliceStore } from '../../../stores/sliceStore';
import { ensureCrumbsInstanceFromProject } from '../../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject';
import { syncCrumbsRecordingState } from '../../../useCases/recording/syncCrumbsRecordingState';
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
// Backed by the real ensure, because it is the hazard the desktop readout has
// to survive: a mount re-seeds the instance entry from project truth whether or
// not a native instance was ever created, so a readout that believed the entry
// would report Ready over a rolled-back create. A test wanting the frames
// before the ensure lands overrides it with a no-op.
vi.mock('../../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject', async () => {
    const actual = await vi.importActual<
        typeof import('../../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject')
    >('../../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject');
    return { ensureCrumbsInstanceFromProject: vi.fn(actual.ensureCrumbsInstanceFromProject) };
});
// Silence the warnings the panel logs from its recorder controls.
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const nativeRecorder = vi.hoisted(() => ({
    arm: vi.fn<(...args: unknown[]) => Promise<{ take_id: string } | null>>(),
    stop: vi.fn<(...args: unknown[]) => Promise<void>>(),
    get: vi.fn<(id: string) => Promise<CrumbsRecordingSnapshot | null>>(),
    on: vi.fn<(handler: (snapshot: CrumbsRecordingSnapshot) => void) => Promise<() => void>>(),
}));
vi.mock('../../../repositories/crumbsBridge/armRecording', () => ({ armRecording: nativeRecorder.arm }));
vi.mock('../../../repositories/crumbsBridge/stopRecording', () => ({ stopRecording: nativeRecorder.stop }));
vi.mock('../../../repositories/crumbsBridge/getCrumbsRecordingState', () => ({
    getCrumbsRecordingState: nativeRecorder.get,
}));
vi.mock('../../../repositories/crumbsBridge/onCrumbsRecordingState', () => ({
    onCrumbsRecordingState: nativeRecorder.on,
}));
// Lifecycle events must update the recorder even when no waveform poll runs.
vi.mock('../../../useCases/positionTracking', () => ({ subscribeToPosition: () => () => undefined }));
vi.mock('../../../useCases/setCrumbsMode', () => ({
    switchCrumbsMode: vi.fn(),
}));
vi.mock('../../../useCases/setCrumbsParamWithAudio', () => ({
    setCrumbsParamWithAudio: vi.fn(),
}));

const ensureInstanceFromProjectMock = vi.mocked(ensureCrumbsInstanceFromProject);
const armRecordingMock = nativeRecorder.arm;
const switchModeMock = vi.mocked(switchCrumbsMode);
const setParamMock = vi.mocked(setCrumbsParamWithAudio);

const DEVICE = 'panel-test';
let receiveRecording: (snapshot: CrumbsRecordingSnapshot) => void;
function recordingSnapshot(overrides: Partial<CrumbsRecordingSnapshot> = {}): CrumbsRecordingSnapshot {
    return {
        instance_id: DEVICE,
        instance_incarnation: '1',
        take_id: '0',
        revision: '0',
        phase: 'idle',
        first_input: null,
        failure: null,
        ...overrides,
    };
}
function emitRecording(overrides: Partial<CrumbsRecordingSnapshot>): void {
    act(() =>
        receiveRecording(
            recordingSnapshot({
                take_id: '1',
                revision: '1',
                first_input: { position_frames: '9007199254740993', frames: 128 },
                ...overrides,
            })
        )
    );
}

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

beforeEach(async () => {
    // Reset to an empty (non-null) record so `ensureInstance` actually seeds the
    // instance — `clear()` would null the store and `ensureInstance` returns an
    // empty record on null, dropping the subsequent state writes.
    crumbsStore.set({});
    padStore.set({});
    sliceStore.set({});
    crumbsEngineAttachmentStore.set(new Set<string>());
    crumbsNativeLifecycleStore.set({});
    ensureInstance(DEVICE);
    ensurePadInstance(DEVICE);
    ensureSliceInstance(DEVICE);
    nativeAvailableMock.mockReset();
    nativeAvailableMock.mockReturnValue(false);
    // Cleared, never reset: a reset would drop the real implementation the
    // factory installed.
    ensureInstanceFromProjectMock.mockClear();
    armRecordingMock.mockReset();
    armRecordingMock.mockResolvedValue({ take_id: '1' });
    nativeRecorder.stop.mockReset().mockResolvedValue(undefined);
    nativeRecorder.get.mockReset().mockResolvedValue(recordingSnapshot());
    nativeRecorder.on.mockReset().mockImplementation(async (handler) => {
        receiveRecording = handler;
        return () => undefined;
    });
    crumbsRecordingStore.set({});
    await syncCrumbsRecordingState(DEVICE, 'attach');
    switchModeMock.mockReset();
    setParamMock.mockReset();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
});

afterEach(async () => {
    await act(async () => {
        await syncCrumbsRecordingState(DEVICE, 'detach');
    });
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
    it('reads "Ready" from the engine attaching this instance while the create is still in flight', async () => {
        nativeAvailableMock.mockReturnValue(true);
        act(() => {
            markCrumbsInstanceCreating(DEVICE);
        });

        render(<CrumbsPanel deviceId={DEVICE} />);
        expect(screen.getAllByText(hasOwnText('Loading...')).length).toBeGreaterThan(0);

        act(() => {
            markCrumbsInstanceAttached(DEVICE);
        });

        expect(await screen.findByText(hasOwnText('Ready'))).toBeInTheDocument();
        expect(screen.queryAllByText(hasOwnText('Loading...'))).toHaveLength(0);
    });

    it('reads "Ready" from a created instance no batch has attached yet', () => {
        // A dormant instance takes the write and parks it; reporting the
        // backend unavailable for one would name a failure that is not one.
        nativeAvailableMock.mockReturnValue(true);
        act(() => {
            markCrumbsInstanceBound(DEVICE);
        });

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getAllByText(hasOwnText('Ready')).length).toBeGreaterThan(0);
    });

    // The mount hazard, and the whole reason the readout does not believe the
    // instance entry: the real `ensureCrumbsInstanceFromProject` runs here and
    // seeds one straight back over the rollback.
    it('shows "Engine unavailable" after a rolled-back create, however the mount re-seeds the store', () => {
        nativeAvailableMock.mockReturnValue(true);
        crumbsStore.set({});
        act(() => {
            markCrumbsInstanceFailed(DEVICE);
        });

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(crumbsStore.value?.[DEVICE]).toBeDefined();
        expect(screen.getAllByText(hasOwnText('Engine unavailable')).length).toBeGreaterThan(0);
        expect(screen.queryAllByText(hasOwnText('Ready'))).toHaveLength(0);
    });

    it('shows "Loading..." rather than an engine verdict while nothing has been decided', () => {
        // On the desktop build the sync has not answered for this device yet;
        // an undecided create is not a backend that failed.
        nativeAvailableMock.mockReturnValue(true);

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(screen.getAllByText(hasOwnText('Loading...')).length).toBeGreaterThan(0);
        expect(screen.queryAllByText(hasOwnText('Engine unavailable'))).toHaveLength(0);
    });

    it('shows "Loading..." rather than an engine verdict on a build with no native runtime', () => {
        // Nothing native is in question in the browser build, so the absence of
        // an instance entry in the frames before the mount ensure lands is not
        // a backend that failed.
        // Once, so the real implementation stays installed for the tests after
        // this one; the store assertion below is what proves the override took.
        ensureInstanceFromProjectMock.mockImplementationOnce(() => undefined);
        crumbsStore.set({});

        render(<CrumbsPanel deviceId={DEVICE} />);

        expect(crumbsStore.value?.[DEVICE]).toBeUndefined();
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

    it('shows Preparing until this take receives its first real input', async () => {
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledOnce());
        expect(screen.getByText('Preparing...')).toBeInTheDocument();
        expect(screen.queryByText('Recording...')).not.toBeInTheDocument();
        emitRecording({ phase: 'waiting' });
        expect(screen.getByText('Waiting...')).toBeInTheDocument();
    });

    it('shows Waiting before threshold and Recording after threshold', async () => {
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledOnce());
        emitRecording({ phase: 'waiting' });
        expect(screen.getByText('Waiting...')).toBeInTheDocument();
        emitRecording({ phase: 'recording', revision: '2' });
        expect(screen.getByText('Recording...')).toBeInTheDocument();
    });

    it('keeps Finishing until the accepted Stop reaches terminal state', async () => {
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledOnce());
        emitRecording({ phase: 'recording' });
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await waitFor(() => expect(nativeRecorder.stop).toHaveBeenCalledExactlyOnceWith(DEVICE, '1'));
        expect(screen.getByText('Finishing...')).toBeInTheDocument();
        emitRecording({ phase: 'completed', revision: '2' });
        expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('shows the automatic terminal state without a position poll', async () => {
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledOnce());
        emitRecording({ phase: 'recording' });
        emitRecording({ phase: 'completed', revision: '2' });
        expect(screen.getByText('Completed')).toBeInTheDocument();
        expect(nativeRecorder.stop).not.toHaveBeenCalled();
    });

    it('ignores stale take outcomes after Stop and instance replacement', async () => {
        const admission = Promise.withResolvers<{ take_id: string }>();
        armRecordingMock.mockReturnValueOnce(admission.promise);
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledOnce());
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await act(async () => {
            admission.resolve({ take_id: '1' });
        });
        expect(screen.getByText('Finishing...')).toBeInTheDocument();
        emitRecording({ phase: 'recording' });
        expect(screen.getByText('Finishing...')).toBeInTheDocument();
        const staleReceive = receiveRecording;
        await act(async () => {
            await syncCrumbsRecordingState(DEVICE, 'detach');
            nativeRecorder.get.mockResolvedValue(recordingSnapshot({ instance_incarnation: '2' }));
            await syncCrumbsRecordingState(DEVICE, 'attach');
        });
        act(() => staleReceive(recordingSnapshot({ take_id: '1', revision: '100', phase: 'failed' })));
        expect(screen.getByText('Idle')).toBeInTheDocument();
        expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    });

    it('reconciles recorder state when the panel remounts', async () => {
        setMode(DEVICE, 'record');
        const view = render(<CrumbsPanel deviceId={DEVICE} />);
        emitRecording({ phase: 'recording' });
        expect(screen.getByText('Recording...')).toBeInTheDocument();
        view.unmount();
        nativeRecorder.get.mockResolvedValue(recordingSnapshot({ take_id: '1', revision: '2', phase: 'completed' }));
        render(<CrumbsPanel deviceId={DEVICE} />);
        expect(await screen.findByText('Completed')).toBeInTheDocument();
        expect(nativeRecorder.on).toHaveBeenCalledOnce();
    });

    it('surfaces a refused arm as Failed', async () => {
        armRecordingMock.mockRejectedValueOnce(new Error('Crumbs instance not found'));
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        expect(await screen.findByText('Failed')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Crumbs instance not found');
    });

    it('leaves the recorder Idle when no native arm was admitted', async () => {
        armRecordingMock.mockResolvedValueOnce(null);
        setMode(DEVICE, 'record');
        render(<CrumbsPanel deviceId={DEVICE} />);
        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        await waitFor(() => expect(armRecordingMock).toHaveBeenCalledOnce());
        expect(screen.getByText('Idle')).toBeInTheDocument();
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
