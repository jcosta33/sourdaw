import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';

import { createDefaultKit } from '../../../models/ToasterKit';
import { toToasterKitState } from '../../../models/ToasterKitState';
import { registerToasterDevice, resetToasterDeviceLifecycleState, toasterStore } from '../../../stores/toasterStore';
import { initToasterKitPersistence } from '../../../useCases/initToasterKitPersistence';
import { stopSequencer } from '../../../useCases/stopSequencer';
import { ToasterPanel } from '../ToasterPanel';

const engine = vi.hoisted(() => ({
    getTrackStrip: vi.fn(),
    ensureTrackStrip: vi.fn(),
    getToasterDeviceControls: vi.fn(),
    writeNativeBuiltinParameters: vi.fn(),
}));
// The panel, owning stores, bridge, persistence command and real sequencer stay
// connected. Only the live AudioEngine boundary is observed in this environment.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: engine.getTrackStrip,
    ensureTrackStrip: engine.ensureTrackStrip,
    getToasterDeviceControls: engine.getToasterDeviceControls,
    writeNativeBuiltinParameters: engine.writeNativeBuiltinParameters,
    getAudioTime: () => 0,
    getAudioSampleRate: () => 48000,
    reconcileAutoInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
    rearmCommittedTrackInputMonitoring: vi.fn(),
}));

const DEVICE_ID = 'toaster-current';
const OTHER_ID = 'toaster-other';
function controls() {
    return {
        ready: true,
        setParam: vi.fn(),
        setPadParam: vi.fn(),
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        allNotesOff: vi.fn(),
        cancelScheduled: vi.fn(),
        scheduleHit: vi.fn(),
        setFillActive: vi.fn(),
    };
}
const current = controls();
const other = controls();
function track(): Track {
    return {
        id: 'track-1',
        name: 'Toaster track',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices: [DEVICE_ID, OTHER_ID].map((id) => ({
            id,
            name: id,
            type: 'toaster',
            bypassed: false,
            parameterValues: {},
            deviceState: toToasterKitState(createDefaultKit()),
        })),
        midiFx: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}
function view(value: 'simple' | 'full'): void {
    fireEvent.change(screen.getByRole('combobox', { name: 'Toaster view' }), { target: { value } });
}
function selectedState() {
    const state = toasterStore.value?.[DEVICE_ID];
    if (!state) {
        throw new Error('Expected current Toaster instance');
    }
    return state;
}

describe('Toaster Simple and Full views keep the real performance connected', () => {
    let raf: MockInstance<typeof requestAnimationFrame>;
    let frames: FrameRequestCallback[];
    let disposePersistence: () => void;
    function flushFrame(): void {
        const queued = frames;
        frames = [];
        act(() => {
            for (const callback of queued) {
                callback(0);
            }
        });
    }
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Toaster disclosure');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
        trackStore.set({ tracks: [track()], selectedTrackId: 'track-1', ghostClips: [] });
        disposePersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE_ID);
        registerToasterDevice(OTHER_ID);
        const strip = {
            deviceNodes: [
                { deviceId: OTHER_ID, toasterControls: other },
                { deviceId: DEVICE_ID, toasterControls: current },
            ],
        };
        engine.getTrackStrip.mockReturnValue(strip);
        engine.ensureTrackStrip.mockReturnValue(strip);
        engine.getToasterDeviceControls.mockImplementation((id: string) => (id === DEVICE_ID ? current : other));
        frames = [];
        raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        settlePendingProjectWritesAndCaptureRevision();
    });
    afterEach(() => {
        disposePersistence();
        cleanup();
        stopSequencer(DEVICE_ID);
        stopSequencer(OTHER_ID);
        raf.mockRestore();
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        agentProjectRepairStateStore.set(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    it('starts in Simple and reveals every existing advanced region only in Full', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);
        expect(screen.getByRole('combobox', { name: 'Toaster view' })).toHaveValue('simple');
        expect(screen.getByRole('textbox', { name: 'Search Toaster kits' })).toBeInTheDocument();
        expect(screen.getByTestId('toaster-pad-0')).toBeInTheDocument();
        for (const name of ['Swing', 'Master', 'Space', 'Spray', 'Bits', 'Dust']) {
            expect(screen.getAllByRole('slider', { name })).toHaveLength(1);
        }
        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(screen.queryByTestId('toaster-step-0-0')).not.toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Hit' })).not.toBeInTheDocument();
        expect(screen.queryByText('Pattern story')).not.toBeInTheDocument();
        expect(screen.queryByText('Pad mixer')).not.toBeInTheDocument();
        expect(screen.queryByText('Fill tools')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Pattern groove template' })).not.toBeInTheDocument();
        view('full');
        expect(screen.getByTestId('toaster-step-0-0')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Hit' })).toBeInTheDocument();
        expect(screen.getByText('Pattern story')).toBeInTheDocument();
        expect(screen.getByText('Pad mixer')).toBeInTheDocument();
        expect(screen.getByText('Fill tools')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Pattern groove template' })).toBeInTheDocument();
        view('simple');
        expect(screen.queryByRole('button', { name: 'M' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('toaster-step-0-0')).not.toBeInTheDocument();
        expect(screen.getAllByRole('slider', { name: 'Master' })).toHaveLength(1);
    });
    it('keeps Master connected to the real owning bridge in both levels and isolates device identities', async () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);
        const untouched = toasterStore.value?.[OTHER_ID];
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Master' }), { key: 'Home' });
        flushFrame();
        expect(selectedState().kit.masterGain).toBe(0);
        expect(current.setParam).toHaveBeenCalledExactlyOnceWith('master_gain', 0);
        expect(engine.writeNativeBuiltinParameters).toHaveBeenCalledExactlyOnceWith('track-1', DEVICE_ID, {
            master_gain: 0,
        });
        await waitFor(() =>
            expect(
                trackStore.value?.tracks[0]?.devices.find((device) => device.id === DEVICE_ID)?.deviceState?.data
            ).toHaveProperty('kit.masterGain', 0)
        );
        view('full');
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Master' }), { key: 'End' });
        flushFrame();
        expect(selectedState().kit.masterGain).toBe(2);
        expect(current.setParam.mock.calls).toEqual([
            ['master_gain', 0],
            ['master_gain', 2],
        ]);
        expect(engine.writeNativeBuiltinParameters).toHaveBeenLastCalledWith('track-1', DEVICE_ID, { master_gain: 2 });
        expect(other.setParam).not.toHaveBeenCalled();
        expect(toasterStore.value?.[OTHER_ID]).toBe(untouched);
        await waitFor(() =>
            expect(
                trackStore.value?.tracks[0]?.devices.find((device) => device.id === DEVICE_ID)?.deviceState?.data
            ).toHaveProperty('kit.masterGain', 2)
        );
    });
    it('switches levels without kit, project, history, engine or playback effects and keeps Stop and modes reachable', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getByTestId('toaster-pad-3'));
        fireEvent.click(screen.getByRole('button', { name: '16 Levels mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Note repeat mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Play' }));
        const state = selectedState();
        const kit = state.kit;
        const revision = settlePendingProjectWritesAndCaptureRevision();
        const history = undoStore.value;
        vi.clearAllMocks();
        view('full');
        view('simple');
        expect(selectedState()).toBe(state);
        expect(selectedState().kit).toBe(kit);
        expect(selectedState().selectedPadIndex).toBe(3);
        expect(selectedState().isPlaying).toBe(true);
        expect(selectedState().currentStep).toBe(state.currentStep);
        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
        expect(undoStore.value).toBe(history);
        for (const control of [current, other]) {
            for (const spy of Object.values(control)) {
                if (typeof spy === 'function') {
                    expect(spy).not.toHaveBeenCalled();
                }
            }
        }
        expect(engine.writeNativeBuiltinParameters).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: '16 Levels mode' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Note repeat mode' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: '16 Levels mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Note repeat mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expect(selectedState().isPlaying).toBe(false);
        expect(screen.getByText(/Play sounds the pattern live only/)).toBeInTheDocument();
    });
    it('keeps the Simple pad grid connected to the addressed engine', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);
        fireEvent.mouseDown(screen.getByTestId('toaster-pad-2'), { button: 0 });
        fireEvent.mouseUp(screen.getByTestId('toaster-pad-2'));
        expect(current.noteOn).toHaveBeenCalledExactlyOnceWith(2, 100);
        expect(other.noteOn).not.toHaveBeenCalled();
    });
});
