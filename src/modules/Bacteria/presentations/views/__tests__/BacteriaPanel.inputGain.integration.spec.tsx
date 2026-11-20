import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { audioEngine, initEngineDeviceCollaborators, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore, captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';

import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { bacteriaStore, setBacteriaSnapshotValues } from '../../../stores/bacteriaStore';
import { applyBacteriaMorphWithAudio } from '../../../useCases/bacteriaParamBridge/applyBacteriaMorph';
import { BacteriaPanel } from '../BacteriaPanel';

const DEVICE_ID = 'bacteria-input';
const OTHER_DEVICE_ID = 'other-bacteria-input';
const TRACK_ID = 'input-track';
const INPUT = 'inputGain';

const notices = vi.fn<(notice: NotifyPayload) => void>();
const engineWrites = vi.fn<(trackId: string, deviceId: string, paramId: string, value: number) => void>();

function observeDeviceController(): void {
    const wire = vi.spyOn(audioEngine, 'setUseCaseDeviceCollaborators');
    initEngineDeviceCollaborators();
    const collaborators = wire.mock.calls[0]?.[0];
    if (!collaborators) {
        throw new Error('Expected the AudioEngine parameter receipt wiring');
    }
    // Replace the hardware-facing controller while retaining the real
    // producer receipt that TrackNode publishes for an applied value.
    vi.spyOn(audioEngine, 'updateDeviceParam').mockImplementation((trackId, deviceId, paramId, value) => {
        const complete = collaborators.captureParameterWriteReceipt(trackId, deviceId, paramId).begin();
        engineWrites(trackId, deviceId, paramId, value);
        complete();
    });
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function bacteriaTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'Guitar',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices: [
            {
                id: DEVICE_ID,
                name: 'Bacteria',
                type: 'bacteria',
                bypassed: false,
                parameterValues: {},
            },
            {
                id: OTHER_DEVICE_ID,
                name: 'Bacteria',
                type: 'bacteria',
                bypassed: false,
                parameterValues: { [INPUT]: -6 },
            },
        ],
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
        midiFx: [],
    };
}

function rawParameterValues(deviceId = DEVICE_ID): Record<string, number> {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const device = root?.tracks.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((entry) => entry.id === deviceId);
    if (!device) {
        throw new Error('Expected the Bacteria device in the raw project document');
    }
    return device.parameterValues;
}

function projectedParameterValues(): Record<string, number> | undefined {
    return trackStore.value?.tracks[0]?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues;
}

function inputKnob(): HTMLElement {
    const knob = screen.getByRole('slider', { name: 'Input' });
    Object.defineProperties(knob, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    return knob;
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

function inputWrites(): number[] {
    return engineWrites.mock.calls
        .filter(([trackId, deviceId, paramId]) => trackId === TRACK_ID && deviceId === DEVICE_ID && paramId === INPUT)
        .map(([, , , value]) => value);
}

function startDrag(knob: HTMLElement): void {
    fireEvent.pointerDown(knob, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 75 });
}

async function whileSnapshotHeld(run: () => void): Promise<void> {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const snapshot = transactSnapshot(async () => {
        entered.resolve();
        await resume.promise;
    });
    await entered.promise;
    try {
        run();
    } finally {
        await act(async () => {
            resume.resolve();
            await snapshot;
        });
    }
}

describe('Bacteria Play Input gain', () => {
    beforeEach(async () => {
        engineWrites.mockClear();
        notices.mockClear();
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', notices);
        setNotificationEventBus(bus);
        observeDeviceController();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const project = runProjectLoadTransaction();
        expect(await project.prepare()).toBe(true);
        expect(project.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Bacteria Input gain');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        bacteriaStore.set({});
        trackStore.set({ tracks: [bacteriaTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
    });

    afterEach(() => {
        cleanup();
        agentProjectRepairStateStore.set(null);
        audioEngine.setUseCaseDeviceCollaborators(null);
        vi.restoreAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        bacteriaStore.set({});
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('previews a drag, commits it once on release, and undoes to a missing parameter', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();
        const baseline = undoDepth();
        expect(knob).toHaveAttribute('aria-valuenow', String(DEFAULT_PATCH.inputGain));

        startDrag(knob);

        await waitFor(() => expect(inputWrites()).toEqual([8]));
        expect(knob).toHaveAttribute('aria-valuenow', '8');
        expect(projectedParameterValues()).not.toHaveProperty(INPUT);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        expect(undoDepth()).toBe(baseline);

        fireEvent.pointerMove(knob, { pointerId: 1, clientY: 50 });
        fireEvent.pointerUp(knob, { pointerId: 1 });
        await waitFor(() => expect(undoDepth()).toBe(baseline + 1));
        expect(projectedParameterValues()).toHaveProperty(INPUT, 16);
        expect(rawParameterValues()).toHaveProperty(INPUT, 16);
        expect(inputWrites().at(-1)).toBe(16);

        await act(undo);
        expect(projectedParameterValues()).not.toHaveProperty(INPUT);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        expect(undoDepth()).toBe(baseline);
        expect(knob).toHaveAttribute('aria-valuenow', String(DEFAULT_PATCH.inputGain));
        expect(inputWrites().at(-1)).toBe(DEFAULT_PATCH.inputGain);

        await act(redo);
        expect(projectedParameterValues()).toHaveProperty(INPUT, 16);
        expect(rawParameterValues()).toHaveProperty(INPUT, 16);
        expect(knob).toHaveAttribute('aria-valuenow', '16');
        expect(inputWrites().at(-1)).toBe(16);
        expect(rawParameterValues(OTHER_DEVICE_ID)).toHaveProperty(INPUT, -6);
        expect(engineWrites).not.toHaveBeenCalledWith(TRACK_ID, OTHER_DEVICE_ID, INPUT, expect.anything());
    });

    it('keeps consecutive keyboard changes and resets to an explicit zero in one step', async () => {
        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: DEVICE_ID, paramId: INPUT, value: 0 },
        });
        const baseline = undoDepth();
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();

        fireEvent.keyDown(knob, { key: 'ArrowUp' });
        fireEvent.keyDown(knob, { key: 'ArrowUp' });
        await waitFor(() => expect(undoDepth()).toBe(baseline + 2));
        expect(knob).toHaveAttribute('aria-valuenow', '1');
        expect(rawParameterValues()).toHaveProperty(INPUT, 1);

        fireEvent.doubleClick(knob);
        await waitFor(() => expect(undoDepth()).toBe(baseline + 3));
        expect(knob).toHaveAttribute('aria-valuenow', '0');
        expect(rawParameterValues()).toHaveProperty(INPUT, 0);

        await act(undo);
        expect(knob).toHaveAttribute('aria-valuenow', '1');
        await act(undo);
        expect(knob).toHaveAttribute('aria-valuenow', '0.5');
        await act(undo);
        expect(knob).toHaveAttribute('aria-valuenow', '0');
        expect(rawParameterValues()).toHaveProperty(INPUT, 0);
        expect(inputWrites().slice(-3)).toEqual([1, 0.5, 0]);
    });

    it('holds the audible preview through unrelated publication and leaves absence intact on a drag back', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();
        startDrag(knob);

        await act(async () => {
            await executeAppAction({
                type: 'setDeviceParameter',
                payload: { deviceId: DEVICE_ID, paramId: 'outputGain', value: -3 },
            });
        });
        expect(knob).toHaveAttribute('aria-valuenow', '8');
        expect(inputWrites()).toEqual([8]);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        const published = undoDepth();

        fireEvent.pointerMove(knob, { pointerId: 1, clientY: 100 });
        fireEvent.pointerUp(knob, { pointerId: 1 });
        expect(knob).toHaveAttribute('aria-valuenow', '0');
        expect(inputWrites()).toEqual([8, 0]);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        expect(undoDepth()).toBe(published);
    });

    it('retires cancelled and unmounted gestures, including a superseded Input frame', async () => {
        const panel = render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();

        // A morph queued before the drag must not flush Input afterwards.
        act(() => {
            for (let corner = 0; corner < 4; corner++) {
                setBacteriaSnapshotValues(DEVICE_ID, corner, { [INPUT]: -6 });
            }
            applyBacteriaMorphWithAudio(DEVICE_ID, 0.5, 0.5);
            startDrag(knob);
        });
        await act(async () => {
            await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        });
        expect(inputWrites()).toEqual([8]);
        fireEvent.pointerCancel(knob, { pointerId: 1 });
        expect(knob).toHaveAttribute('aria-valuenow', '0');

        startDrag(knob);
        panel.unmount();
        expect(inputWrites()).toEqual([8, 0, 8, 0]);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        expect(undoDepth()).toBe(0);
    });

    it('rejects a held edit after another action publishes an explicit zero', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();
        startDrag(knob);
        await act(async () => {
            await executeAppAction({
                type: 'setDeviceParameter',
                payload: { deviceId: DEVICE_ID, paramId: INPUT, value: 0 },
            });
        });

        fireEvent.pointerMove(knob, { pointerId: 1, clientY: 50 });
        fireEvent.pointerUp(knob, { pointerId: 1 });
        expect(knob).toHaveAttribute('aria-valuenow', '0');
        expect(inputWrites()).toEqual([8, 0]);
        expect(rawParameterValues()).toHaveProperty(INPUT, 0);
        expect(undoDepth()).toBe(1);
    });

    it('restores a preview when the action is refused', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();
        startDrag(knob);
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });

        fireEvent.pointerUp(knob, { pointerId: 1 });
        await waitFor(() => expect(knob).toHaveAttribute('aria-valuenow', '0'));
        expect(inputWrites()).toEqual([8, 0]);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        expect(undoDepth()).toBe(0);
        expect(notices).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'warning',
                message: 'Project repair is required before project actions can execute',
            })
        );
    });

    it('drops a drag as soon as a project switch revokes its edit authority', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();
        startDrag(knob);
        const identity = captureProjectIdentity();

        const takeover = runProjectLoadTransaction();
        await act(async () => {
            expect(await takeover.prepare()).toBe(true);
        });
        try {
            expect(captureProjectIdentity()).toBe(identity);
            fireEvent.pointerUp(knob, { pointerId: 1 });
            expect(knob).toHaveAttribute('aria-valuenow', '0');
            expect(inputWrites()).toEqual([8, 0]);
            expect(rawParameterValues()).not.toHaveProperty(INPUT);
            expect(undoDepth()).toBe(0);
        } finally {
            takeover.abandon();
        }
    });

    it('continues a held drag after its own pending keyboard action settles', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        const knob = inputKnob();
        await whileSnapshotHeld(() => {
            fireEvent.keyDown(knob, { key: 'ArrowUp' });
            startDrag(knob);
            expect(knob).toHaveAttribute('aria-valuenow', '8.5');
            expect(inputWrites()).toEqual([]);
            expect(projectedParameterValues()).not.toHaveProperty(INPUT);
            expect(undoDepth()).toBe(0);
        });
        await waitFor(() => expect(inputWrites()).toEqual([0.5, 8.5]));
        expect(undoDepth()).toBe(1);
        expect(rawParameterValues()).toHaveProperty(INPUT, 0.5);

        fireEvent.pointerMove(knob, { pointerId: 1, clientY: 50 });
        expect(inputWrites().at(-1)).toBe(16.5);
        expect(knob).toHaveAttribute('aria-valuenow', '16.5');
        expect(rawParameterValues()).toHaveProperty(INPUT, 0.5);
        expect(undoDepth()).toBe(1);

        fireEvent.pointerUp(knob, { pointerId: 1 });
        await waitFor(() => expect(undoDepth()).toBe(2));
        expect(rawParameterValues()).toHaveProperty(INPUT, 16.5);

        await act(undo);
        expect(rawParameterValues()).toHaveProperty(INPUT, 0.5);
        expect(knob).toHaveAttribute('aria-valuenow', '0.5');
        await act(undo);
        expect(rawParameterValues()).not.toHaveProperty(INPUT);
        expect(knob).toHaveAttribute('aria-valuenow', '0');
    });

    it.each(['release', 'keyboard', 'keyboard with a new held drag'] as const)(
        'leaves a newer runtime write alone while a %s is pending',
        async (kind) => {
            render(<BacteriaPanel deviceId={DEVICE_ID} />);
            const knob = inputKnob();
            await whileSnapshotHeld(() => {
                if (kind === 'release') {
                    startDrag(knob);
                    fireEvent.pointerUp(knob, { pointerId: 1 });
                } else {
                    fireEvent.keyDown(knob, { key: 'ArrowUp' });
                }
                if (kind === 'keyboard with a new held drag') {
                    startDrag(knob);
                }
                updateDeviceParam(TRACK_ID, DEVICE_ID, INPUT, -7);
            });

            await waitFor(() => expect(knob).toHaveAttribute('aria-valuenow', '0'));
            if (kind === 'keyboard with a new held drag') {
                fireEvent.pointerUp(knob, { pointerId: 1 });
            }
            expect(inputWrites()).toEqual(kind === 'release' ? [8, -7] : [-7]);
            expect(rawParameterValues()).not.toHaveProperty(INPUT);
            expect(undoDepth()).toBe(0);
        }
    );
});
