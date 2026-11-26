import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initDeviceStateReconciliation } from '#/app/initDeviceStateReconciliation';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    setNotificationEventBus,
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { createDefaultKit } from '../../../models/ToasterKit';
import { fromToasterKitState, toToasterKitState } from '../../../models/ToasterKitState';
import { registerToasterDevice, resetToasterDeviceLifecycleState, toasterStore } from '../../../stores/toasterStore';
import { getToasterHandlers } from '../../../useCases/getToasterHandlers';
import { initToasterKitPersistence } from '../../../useCases/initToasterKitPersistence';
import { stopSequencer } from '../../../useCases/stopSequencer';
import { ToasterPanel } from '../ToasterPanel';

const engine = vi.hoisted(() => ({
    getTrackStrip: vi.fn(),
    ensureTrackStrip: vi.fn(),
    getToasterDeviceControls: vi.fn(),
    writeNativeBuiltinParameters: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...engine,
    getAudioTime: () => 0,
    getAudioSampleRate: () => 48000,
    reconcileAutoInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
    rearmCommittedTrackInputMonitoring: vi.fn(),
}));
const DEVICE = 'toaster-controls';
const OTHER = 'toaster-other';
const PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const controls = {
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
function state() {
    const instance = toasterStore.value?.[DEVICE];
    if (!instance) {
        throw new Error('Expected Toaster instance');
    }
    return instance;
}
function savedKit() {
    return fromToasterKitState(trackStore.value?.tracks[0]?.devices[0]?.deviceState);
}

describe('Toaster real controls', () => {
    let disposePersistence: (() => void) | undefined;
    let stopReconciliation: (() => void) | undefined;
    let stopProjection: (() => void) | undefined;
    beforeEach(async () => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        resetCrdtProjectAuthority(PROJECT_ID);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getToasterHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, projectId: PROJECT_ID, initialized: true, loading: false });
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'track', name: 'Track', kind: 'midi' }),
                    devices: [DEVICE, OTHER].map((id) => ({
                        id,
                        name: id,
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: toToasterKitState(createDefaultKit()),
                    })),
                },
            ],
            selectedTrackId: 'track',
            ghostClips: [],
        });
        disposePersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE);
        registerToasterDevice(OTHER);
        const strip = { deviceNodes: [{ deviceId: DEVICE, toasterControls: controls }] };
        engine.getTrackStrip.mockReturnValue(strip);
        engine.ensureTrackStrip.mockReturnValue(strip);
        engine.getToasterDeviceControls.mockReturnValue(controls);
        flushAutomergeStorageWrites();
        stopReconciliation = initDeviceStateReconciliation();
        stopProjection = setupProjectionBridge();
    });
    afterEach(() => {
        stopProjection?.();
        stopReconciliation?.();
        disposePersistence?.();
        stopProjection = undefined;
        stopReconciliation = undefined;
        disposePersistence = undefined;
        cleanup();
        stopSequencer(DEVICE);
        stopSequencer(OTHER);
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    it.each([
        ['Swing', 'swing', 0, 0.01, 'ArrowUp', 'swing', []],
        ['Space', 'reverbMix', 0.15, 0.16, 'ArrowUp', 'reverb_mix', []],
        ['Spray', 'delayMix', 0, 0.01, 'ArrowUp', 'delay_mix', []],
        ['Dust', 'lofiMix', 0, 0.01, 'ArrowUp', 'lofi_mix', []],
        ['Bits', 'lofiBits', 16, 15, 'ArrowDown', 'lofi_bits', []],
        ['Master', 'masterGain', 1, 1.01, 'ArrowUp', 'master_gain', ['setToasterMasterGain']],
    ] as const)(
        'routes %s keyboard step to its kit field',
        async (label, key, before, after, arrow, param, actions) => {
            render(<ToasterPanel deviceId={DEVICE} />);
            const other = toasterStore.value?.[OTHER];
            const previous = state().kit;
            const control = screen.getByRole('slider', { name: label });
            expect(control).toHaveAttribute('aria-valuenow', String(before));
            control.focus();
            fireEvent.keyDown(control, { key: arrow });
            fireEvent.keyUp(control, { key: arrow });
            await waitFor(() => {
                expect(control).toHaveAttribute('aria-valuenow', String(after));
                expect(state().kit[key]).toBeCloseTo(after, 5);
                expect(savedKit()[key]).toBeCloseTo(after, 5);
                expect(controls.setParam).toHaveBeenCalledWith(param, expect.closeTo(after, 5));
                expect(undoHistoryStore.value?.past).toMatchObject(actions.map((type) => ({ action: { type } })));
            });
            expect({ ...state().kit, [key]: before }).toEqual(previous);
            expect(toasterStore.value?.[OTHER]).toBe(other);
        }
    );
    it.each([
        ['Bright', 'filterCutoff', 20000, 19990, 'ArrowDown'],
        ['Hit', 'decay', 0.5, 0.51, 'ArrowUp'],
        ['Crunch', 'drive', 0, 0.1, 'ArrowUp'],
    ] as const)('routes Kick %s keyboard step to its pad field', async (label, key, before, after, arrow) => {
        render(<ToasterPanel deviceId={DEVICE} />);
        expect(screen.getByRole('combobox', { name: 'Toaster view' })).toHaveValue('simple');
        expect(screen.getByRole('combobox', { name: 'Toaster view' })).toBeVisible();
        fireEvent.change(screen.getByRole('combobox', { name: 'Toaster view' }), { target: { value: 'full' } });
        expect(screen.getByRole('combobox', { name: 'Toaster view' })).toHaveValue('full');
        expect(screen.getByRole('button', { name: 'Trigger Kick' })).toHaveAttribute('aria-pressed', 'true');
        const previous = state().kit;
        const other = toasterStore.value?.[OTHER];
        const control = screen.getByRole('slider', { name: label });
        expect(control).toHaveAttribute('aria-valuenow', String(before));
        control.focus();
        fireEvent.keyDown(control, { key: arrow });
        fireEvent.keyUp(control, { key: arrow });
        await waitFor(() => {
            expect(control).toHaveAttribute('aria-valuenow', String(after));
            expect(state().kit.pads[0]?.[key]).toBeCloseTo(after, 5);
            expect(savedKit().pads[0]?.[key]).toBeCloseTo(after, 5);
            expect(controls.setPadParam).toHaveBeenCalled();
        });
        expect({ ...state().kit.pads[0], [key]: before }).toEqual(previous.pads[0]);
        expect(state().kit.pads.slice(1)).toEqual(previous.pads.slice(1));
        expect({ ...state().kit, pads: previous.pads }).toEqual(previous);
        expect(toasterStore.value?.[OTHER]).toBe(other);
        if (label === 'Crunch') {
            fireEvent.keyDown(control, { key: 'ArrowDown' });
            fireEvent.keyUp(control, { key: 'ArrowDown' });
            await waitFor(() => {
                expect(control).toHaveAttribute('aria-valuenow', '0');
                expect(state().kit.pads[0]?.drive).toBe(0);
                expect(savedKit().pads[0]?.drive).toBe(0);
                expect(controls.setPadParam).toHaveBeenCalledWith(0, 'drive', 0);
            });
        }
    });
});
