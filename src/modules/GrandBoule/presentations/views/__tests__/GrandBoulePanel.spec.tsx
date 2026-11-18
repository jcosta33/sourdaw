import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { createGrandBouleStore, resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { setGrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

const projectTrackState = vi.hoisted(() => ({
    current: null as null | {
        tracks: { id: string; devices: { id: string; parameterValues: Record<string, number> }[] }[];
        selectedTrackId: string | null;
        ghostClips: never[];
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value?: unknown }, defaultValue: unknown) => {
        if (
            projectTrackState.current !== null &&
            defaultValue !== null &&
            typeof defaultValue === 'object' &&
            'tracks' in defaultValue
        ) {
            return projectTrackState.current;
        }
        return store.value ?? defaultValue;
    }),
}));

// Non-spread listing of defaultTrackState and trackStore — GrandBoulePanel imports both; helpers.ts and commitGrandBouleDeviceState.ts import trackStore for Mix knob commits.
vi.mock('#/modules/Arrangement/stores', () => ({
    defaultTrackState: { tracks: [], selectedTrackId: null, ghostClips: [] },
    trackStore: {
        get value() {
            return projectTrackState.current;
        },
    },
}));

// Non-spread listing of clampDeviceParameterValue, getAllTracks, and quantiseDeviceParameterValue — normalizeGrandBoulePersistedParamValue imports the first and third for micPosition commits; resolveGrandBouleEngine imports getAllTracks for the engine readiness tile.
vi.mock('#/modules/Arrangement/useCases', () => ({
    clampDeviceParameterValue: ({ value }: { value: number }) => value,
    getAllTracks: () => [],
    quantiseDeviceParameterValue: ({ value }: { value: number }) => value,
}));

// Non-spread listing of ensureTrackStrip, getAudioSampleRate, sendNativeLiveMidiControl and
// writeNativeBuiltinParameters — resolveGrandBouleEngine imports the first two for the engine
// readiness tile, the third to mirror a panel pedal onto the engine's own body, and the fourth to
// mirror a calibration write onto the native body (#4302). `ensureTrackStrip` answers no device
// nodes here, so the resolved handle is always disconnected and never calls it.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: () => ({ deviceNodes: [], analyserNode: null }),
    getAudioSampleRate: () => 44100,
    sendNativeLiveMidiControl: async () => true,
    writeNativeBuiltinParameters: () => {},
}));

const hydrateGrandBouleConfigFromProject = vi.hoisted(() => vi.fn());

vi.mock('../../../useCases/hydrateGrandBouleConfigFromProject', () => ({ hydrateGrandBouleConfigFromProject }));

const executeAppAction = vi.hoisted(() =>
    vi.fn((action: { type: string; payload: { deviceId: string; paramId: string; value: number } }): Promise<void> => {
        const state = projectTrackState.current;
        if (state === null || action.type !== 'setDeviceParameter') {
            return Promise.resolve();
        }
        projectTrackState.current = {
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) =>
                    device.id === action.payload.deviceId
                        ? {
                              ...device,
                              parameterValues: {
                                  ...device.parameterValues,
                                  [action.payload.paramId]: action.payload.value,
                              },
                          }
                        : device
                ),
            })),
        };
        return Promise.resolve();
    })
);

const executeUserAppAction = executeAppAction;

// Non-spread listing of the dispatchers — helpers.ts imports executeUserAppAction and
// commitGrandBouleDeviceState.ts imports executeAppAction, both bound to one mock that
// writes authoritative parameter truth for parameter and morph commits.
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction,
    executeUserAppAction: executeAppAction,
    describeAppActionRefusal: vi.fn(() => ''),
    isAppActionAdmissionRefusal: vi.fn(() => false),
    isAppActionConflictError: vi.fn(() => false),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

describe('GrandBoulePanel', () => {
    beforeEach(() => {
        Container.clear();
        setGrandBouleEventBus(mockEventBus);
        resetGrandBouleStores();
        projectTrackState.current = null;
        vi.clearAllMocks();
    });

    it('renders the panel window with the expected heading', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The panel renders a grand-boule-window with content.
        const window = document.querySelector('.grand-boule-window');
        expect(window).not.toBeNull();
    });

    it('renders the engine readiness tile as "idle" with no live engine', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('renders interactive control elements (buttons, knobs, or sliders)', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        const interactive = screen.queryAllByRole('button').length + screen.queryAllByRole('slider').length;
        expect(interactive).toBeGreaterThan(0);
    });

    it('exposes the audible lid and microphone controls', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(screen.getByRole('slider', { name: 'Lid position' })).toHaveValue(1);
        expect(screen.getByRole('combobox', { name: 'Microphone position' })).toHaveValue('1');
    });

    it('routes microphone changes through authoritative project truth into the device-owned config', async () => {
        projectTrackState.current = {
            tracks: [{ id: 'track-1', devices: [{ id: 'dev-1', parameterValues: { micPosition: 1 } }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        };
        render(<GrandBoulePanel deviceId="dev-1" />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Microphone position' }), {
            target: { value: '2' },
        });

        await waitFor(() => {
            expect(createGrandBouleStore('dev-1').value?.config.micPosition).toBe(2);
        });
        expect(projectTrackState.current.tracks[0]?.devices[0]?.parameterValues.micPosition).toBe(2);
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'dev-1', paramId: 'micPosition', value: 2 },
        });
    });

    it('rehydrates the controls when undo changes project parameter values', () => {
        projectTrackState.current = {
            tracks: [{ id: 'track-1', devices: [{ id: 'dev-1', parameterValues: { lidPosition: 0.25 } }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        };
        const { rerender } = render(<GrandBoulePanel deviceId="dev-1" />);
        expect(hydrateGrandBouleConfigFromProject).toHaveBeenCalledOnce();
        hydrateGrandBouleConfigFromProject.mockClear();

        projectTrackState.current = {
            tracks: [{ id: 'track-1', devices: [{ id: 'dev-1', parameterValues: { lidPosition: 0.8 } }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        };
        rerender(<GrandBoulePanel deviceId="dev-1" />);

        expect(hydrateGrandBouleConfigFromProject).toHaveBeenCalledWith('dev-1');
    });

    it('emits events through the event bus when rendered (wiring check)', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The event bus is wired — at minimum it was registered.
        expect(mockEventBus.on).toHaveBeenCalled();
    });

    it('renders the panel for a different deviceId without error', () => {
        render(<GrandBoulePanel deviceId="grand-boule-2" />);
        expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('opens controls-first and mounts each optional visualization only when revealed', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);

        const controls = within(screen.getByRole('region', { name: 'Grand Boule controls' }));
        const piano = controls.getByRole('button', { name: 'Piano keyboard' });
        const strings = controls.getByRole('button', { name: 'String activity' });
        const spectrum = controls.getByRole('button', { name: 'Spectrum history' });
        for (const button of [piano, strings, spectrum]) {
            expect(button).toHaveAttribute('aria-expanded', 'false');
        }
        expect(screen.queryByLabelText('Grand Boule interactive piano')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Grand Boule string vibration visualisation')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Grand Boule spectral waterfall')).not.toBeInTheDocument();
        expect(screen.queryByText('No track analyser is available.')).not.toBeInTheDocument();

        fireEvent.click(piano);
        expect(piano).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Piano audio is unavailable.')).toBeVisible();
        expect(screen.getByLabelText('Grand Boule interactive piano')).toBeVisible();
        fireEvent.click(strings);
        expect(strings).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/No notes are sounding/)).toBeVisible();
        expect(screen.getByLabelText('Grand Boule string vibration visualisation')).toBeVisible();
        fireEvent.click(spectrum);
        expect(spectrum).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('No track analyser is available.')).toBeVisible();

        fireEvent.click(piano);
        expect(piano).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByLabelText('Grand Boule interactive piano')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Grand Boule string vibration visualisation')).toBeVisible();
        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('keeps the focusable piano disclosure open until the last preview pointer releases', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        const piano = screen.getByRole('button', { name: 'Piano keyboard' });
        piano.focus();
        expect(piano).toHaveFocus();
        fireEvent.click(piano);

        const canvas = screen.getByLabelText('Grand Boule interactive piano');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 480));
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 400 });
        expect(piano).toHaveAttribute('aria-disabled', 'true');
        expect(piano).toHaveFocus();
        fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 220, clientY: 400 });
        fireEvent.click(piano);
        expect(piano).toHaveAttribute('aria-expanded', 'true');
        expect(canvas).toBeVisible();

        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(piano).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(piano);
        expect(canvas).toBeVisible();

        fireEvent.pointerCancel(window, { pointerId: 2 });
        expect(piano).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(piano);
        expect(piano).toHaveAttribute('aria-expanded', 'false');
        expect(canvas).not.toBeInTheDocument();
    });

    it.each(['blur', 'lostpointercapture'])(
        'makes the piano disclosure usable after %s without a pointer release',
        (interruption) => {
            render(<GrandBoulePanel deviceId="dev-1" />);
            const piano = screen.getByRole('button', { name: 'Piano keyboard' });
            fireEvent.click(piano);
            const canvas = screen.getByLabelText('Grand Boule interactive piano');
            vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 480));
            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 400 });
            expect(piano).toHaveAttribute('aria-disabled', 'true');

            if (interruption === 'blur') {
                fireEvent.blur(window);
            } else {
                fireEvent(canvas, new PointerEvent(interruption, { bubbles: true, pointerId: 1 }));
            }

            expect(piano).not.toHaveAttribute('aria-disabled', 'true');
            expect(canvas).toBeVisible();
            fireEvent.click(piano);
            expect(piano).toHaveAttribute('aria-expanded', 'false');
            expect(canvas).not.toBeInTheDocument();
        }
    );

    it.each(['blur', 'lostpointercapture'])(
        'keeps a preview release reachable while the piano disclosure is closed after %s',
        (interruption) => {
            render(<GrandBoulePanel deviceId="dev-1" />);
            const piano = screen.getByRole('button', { name: 'Piano keyboard' });
            fireEvent.click(piano);
            const canvas = screen.getByLabelText('Grand Boule interactive piano');
            vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 480));
            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 400 });
            const playing = screen.getByText(/^Playing /).textContent;

            if (interruption === 'blur') {
                fireEvent.blur(window);
            } else {
                fireEvent(canvas, new PointerEvent(interruption, { bubbles: true, pointerId: 1 }));
            }
            fireEvent.click(piano);
            expect(piano).toHaveAttribute('aria-expanded', 'false');
            expect(canvas).not.toBeInTheDocument();
            expect(screen.queryByText(/^Playing /)).not.toBeInTheDocument();

            fireEvent.click(piano);
            expect(screen.getByText(/^Playing /).textContent).toBe(playing);
            fireEvent.click(piano);
            expect(piano).toHaveAttribute('aria-expanded', 'false');

            fireEvent.pointerUp(window, { pointerId: 1 });
            fireEvent.click(piano);
            expect(screen.getByText('No notes playing')).toBeInTheDocument();
        }
    );

    it('clears the disclosure lock when a different device takes over the panel', () => {
        const { rerender } = render(<GrandBoulePanel deviceId="dev-1" />);
        const piano = screen.getByRole('button', { name: 'Piano keyboard' });
        fireEvent.click(piano);
        const canvas = screen.getByLabelText('Grand Boule interactive piano');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 480));
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 400 });
        expect(piano).toHaveAttribute('aria-disabled', 'true');

        rerender(<GrandBoulePanel deviceId="dev-2" />);
        expect(canvas).not.toBeInTheDocument();
        expect(piano).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(piano);
        expect(piano).toHaveAttribute('aria-expanded', 'false');
    });

    it('applies shrink-0 to Grand Boule section cards including MorphPanel', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);

        const [morphTitle] = screen.getAllByText('Morph', { selector: 'div' });
        expect(morphTitle).toBeDefined();
        if (!morphTitle) {
            throw new Error('Morph title not found');
        }
        const morphSection = morphTitle.closest('section');
        expect(morphSection).not.toBeNull();
        expect(morphSection).toHaveClass('shrink-0');

        const sections = document.querySelectorAll('section.grand-boule-window.shrink-0');
        expect(sections.length).toBe(10);
        expect(screen.getByText('MIDI Calibration', { exact: true })).toBeInTheDocument();
        for (const section of sections) {
            expect(section).toHaveClass('shrink-0');
        }
    });
});
