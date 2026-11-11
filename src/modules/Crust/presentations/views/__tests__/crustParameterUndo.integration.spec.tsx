import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { crustStore, getCrustState } from '../../../stores/crustStore';
import { CrustPanel } from '../CrustPanel';

const audio = vi.hoisted(() => ({ updateDeviceParam: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audio.updateDeviceParam,
}));

const TRACK = 'crust-track';
const DEVICE = 'crust-device';

function projectedDevice() {
    const device = trackStore.value?.tracks
        .find((track) => track.id === TRACK)
        ?.devices.find((device) => device.id === DEVICE);
    if (!device) {
        throw new Error('Crust device is missing from projection');
    }
    return device;
}

function rawDevice() {
    const root = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const device = root?.tracks.tracks
        .find((track) => track.id === TRACK)
        ?.devices.find((device) => device.id === DEVICE);
    if (!device) {
        throw new Error('Crust device is missing from raw authority');
    }
    return device;
}

function gainDrag() {
    const gain = screen.getByRole('slider', { name: 'Input gain' });
    Object.defineProperties(gain, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(gain, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 20, 100));
    fireEvent.pointerDown(gain, { button: 0, pointerId: 1, clientY: 100 });
    return gain;
}

describe('Crust numeric gestures through real Command and CRDT', () => {
    beforeEach(async () => {
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        setNotificationEventBus(bus);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Crust parameter integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: TRACK, name: 'Crust', kind: 'audio' }),
                    color: '#123456',
                    devices: [
                        {
                            id: DEVICE,
                            type: 'crust',
                            name: 'Crust',
                            bypassed: false,
                            parameterValues: { gain: 0, ceiling: -0.3 },
                        },
                    ],
                },
            ],
            selectedTrackId: TRACK,
            ghostClips: [],
        });
        crustStore.set({});
        flushAutomergeStorageWrites();
        audio.updateDeviceParam.mockClear();
    });

    afterEach(() => {
        cleanup();
        agentProjectRepairStateStore.set(null);
        registerCrdtStorageRuntime();
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
    });

    it('makes a real Input gain keyboard change independently undoable', async () => {
        // A real earlier command distinguishes a new gain entry from Undo of an unrelated edit.
        await executeUserAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: DEVICE, paramId: 'ceiling', value: -0.4 },
        });
        const before = captureUndoHistory();
        expect(before.past).toHaveLength(1);
        expect(before.past[0]).toMatchObject({
            kind: 'action',
            action: { type: 'setDeviceParameter', payload: { paramId: 'ceiling', value: -0.4 } },
        });
        render(<CrustPanel deviceId={DEVICE} />);
        const gain = screen.getByRole('slider', { name: 'Input gain' });
        expect(gain).toHaveAttribute('aria-valuenow', '0');
        fireEvent.keyDown(gain, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(rawDevice().parameterValues.gain).toBe(0.1);
            expect(projectedDevice()).toEqual(rawDevice());
            expect(gain).toHaveAttribute('aria-valuenow', '0.1');
        });
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'gain', 0.1, expect.any(Symbol));
        const changed = captureUndoHistory();
        expect(changed.past).toHaveLength(before.past.length + 1);
        expect(changed.past.at(-1)).toMatchObject({
            kind: 'action',
            action: { type: 'setDeviceParameter', payload: { paramId: 'gain', value: 0.1 } },
            inverseAction: { type: 'setDeviceParameter', payload: { paramId: 'gain', value: 0 } },
        });
        await act(() => undo());
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '0'));
        expect(rawDevice().parameterValues).toMatchObject({ gain: 0, ceiling: -0.4 });
        expect(projectedDevice()).toEqual(rawDevice());
        await act(() => redo());
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '0.1'));
        expect(projectedDevice()).toEqual(rawDevice());
        await act(() => undo());
        expect(rawDevice().parameterValues.gain).toBe(0);
    });

    it('previews multiple real pointer samples without truth/history and commits exactly one terminal', async () => {
        render(<CrustPanel deviceId={DEVICE} />);
        const gain = gainDrag();
        fireEvent.pointerMove(gain, { pointerId: 1, clientY: 90 });
        fireEvent.pointerMove(gain, { pointerId: 1, clientY: 70 });
        expect(gain).toHaveAttribute('aria-valuenow', '5.4');
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);
        expect(audio.updateDeviceParam).toHaveBeenCalledTimes(2);
        const lastSample = audio.updateDeviceParam.mock.calls.at(-1)?.[3];
        expect(lastSample).toBeCloseTo(5.4);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'gain', lastSample, expect.any(Symbol));
        fireEvent.pointerUp(gain, { pointerId: 1 });
        await waitFor(() => expect(captureUndoHistory().past).toHaveLength(1));
        expect(rawDevice().parameterValues.gain).toBe(lastSample);
        expect(captureUndoHistory().past.at(-1)).toMatchObject({
            kind: 'action',
            action: { type: 'setDeviceParameter', payload: { paramId: 'gain', value: lastSample } },
        });
        expect(audio.updateDeviceParam).toHaveBeenCalledTimes(4);
        expect(audio.updateDeviceParam.mock.calls.slice(1)).toEqual([
            [TRACK, DEVICE, 'gain', lastSample, expect.any(Symbol)],
            [TRACK, DEVICE, 'gain', lastSample, expect.any(Symbol)],
            [TRACK, DEVICE, 'gain', lastSample, expect.any(Symbol)],
        ]);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'gain', lastSample, expect.any(Symbol));
        expect(projectedDevice()).toEqual(rawDevice());
        await act(() => undo());
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '0'));
        expect(rawDevice().parameterValues.gain).toBe(0);
    });

    it('keeps an external Link Trans edit when a second pointer replaces an abandoned preview', async () => {
        render(<CrustPanel deviceId={DEVICE} />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'shape' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        const link = screen.getByRole('slider', { name: 'Link Trans' });
        const root = link.closest('[data-slot="slider"]');
        if (!(root instanceof HTMLElement)) {
            throw new TypeError('Missing Link Trans slider root');
        }
        const capture = { held: false };
        Object.defineProperties(root, {
            setPointerCapture: { configurable: true, value: () => (capture.held = true) },
            releasePointerCapture: { configurable: true, value: () => (capture.held = false) },
            hasPointerCapture: { configurable: true, value: () => capture.held },
        });
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 20));

        fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 65, clientY: 10 });
        expect(link).toHaveAttribute('aria-valuenow', '65');
        expect(rawDevice().parameterValues.channelLinkTransient).toBeUndefined();
        expect(captureUndoHistory().past).toHaveLength(0);

        await act(() =>
            executeUserAppAction({
                type: 'setDeviceParameter',
                payload: {
                    deviceId: DEVICE,
                    paramId: 'channelLinkTransient',
                    value: 10,
                    automationRecordingPolicy: 'suppressed',
                },
            })
        );
        expect(rawDevice().parameterValues.channelLinkTransient).toBe(10);
        expect(captureUndoHistory().past).toHaveLength(1);

        await act(async () => {
            fireEvent.pointerDown(root, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
        });
        expect(rawDevice().parameterValues.channelLinkTransient).toBe(10);
        expect(captureUndoHistory().past).toHaveLength(1);
        expect(captureUndoHistory().past[0]).toMatchObject({
            kind: 'action',
            action: { type: 'setDeviceParameter', payload: { paramId: 'channelLinkTransient', value: 10 } },
        });

        await act(async () => {
            fireEvent.pointerUp(root, { pointerId: 1 });
            fireEvent.pointerCancel(root, { pointerId: 2 });
            fireEvent.lostPointerCapture(root, { pointerId: 1 });
            fireEvent.lostPointerCapture(root, { pointerId: 2 });
            fireEvent.blur(window);
        });
        expect(rawDevice().parameterValues.channelLinkTransient).toBe(10);
        expect(captureUndoHistory().past).toHaveLength(1);
        expect(projectedDevice()).toEqual(rawDevice());
    });

    it('keeps a sparse gain preview through an unrelated real ceiling commit and restores absence on Undo', async () => {
        const track = trackStore.value?.tracks[0];
        if (!track) {
            throw new Error('Missing test track');
        }
        const values = Object.fromEntries(
            Object.entries(projectedDevice().parameterValues).filter(([key]) => key !== 'gain')
        );
        trackStore.set({
            tracks: [{ ...track, devices: track.devices.map((device) => ({ ...device, parameterValues: values })) }],
            selectedTrackId: TRACK,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        render(<CrustPanel deviceId={DEVICE} />);
        const gain = gainDrag();
        fireEvent.pointerMove(gain, { pointerId: 1, clientY: 50 });
        expect(gain).toHaveAttribute('aria-valuenow', '9');
        expect(Object.hasOwn(rawDevice().parameterValues, 'gain')).toBe(false);
        await act(() =>
            executeUserAppAction({
                type: 'setDeviceParameter',
                payload: { deviceId: DEVICE, paramId: 'ceiling', value: -0.7, automationRecordingPolicy: 'suppressed' },
            })
        );
        expect(gain).toHaveAttribute('aria-valuenow', '9');
        expect(Object.hasOwn(rawDevice().parameterValues, 'gain')).toBe(false);
        fireEvent.pointerUp(gain, { pointerId: 1 });
        await waitFor(() => expect(captureUndoHistory().past).toHaveLength(2));
        expect(rawDevice().parameterValues).toMatchObject({ gain: 9, ceiling: -0.7 });
        await act(() => undo());
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '0'));
        expect(Object.hasOwn(rawDevice().parameterValues, 'gain')).toBe(false);
        expect(rawDevice().parameterValues.ceiling).toBe(-0.7);
        expect(projectedDevice()).toEqual(rawDevice());
        await act(() => redo());
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '9'));
        await act(() => undo());
        expect(Object.hasOwn(rawDevice().parameterValues, 'gain')).toBe(false);
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'unmount'] as const)(
        'cancels a real gain preview on %s without a ghost command',
        async (terminal) => {
            const view = render(<CrustPanel deviceId={DEVICE} />);
            const gain = gainDrag();
            fireEvent.pointerMove(gain, { pointerId: 1, clientY: 50 });
            if (terminal === 'unmount') {
                view.unmount();
            } else {
                fireEvent[terminal](gain, { pointerId: 1 });
            }
            expect(rawDevice().parameterValues.gain).toBe(0);
            expect(projectedDevice()).toEqual(rawDevice());
            expect(captureUndoHistory().past).toHaveLength(0);
            expect(getCrustState(DEVICE).patch.gain).toBe(0);
        }
    );

    it('settles typed ceiling once on Enter/blur and cancels an Escape draft', async () => {
        render(<CrustPanel deviceId={DEVICE} />);
        const input = screen.getByRole('spinbutton', { name: 'Output ceiling in dBTP' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '-1.2' } });
        expect(rawDevice().parameterValues.ceiling).toBe(-0.3);
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.blur(input);
        await waitFor(() => expect(captureUndoHistory().past).toHaveLength(1));
        expect(rawDevice().parameterValues.ceiling).toBe(-1.2);
        await act(() => undo());
        expect(rawDevice().parameterValues.ceiling).toBe(-0.3);
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '-2' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.blur(input);
        expect(captureUndoHistory().past).toHaveLength(0);
        expect(rawDevice().parameterValues.ceiling).toBe(-0.3);
        expect(input).toHaveValue(-0.3);
    });
    it('accepts a new ceiling edit after Escape without blur or refocus', async () => {
        render(<CrustPanel deviceId={DEVICE} />);
        const input = screen.getByRole('spinbutton', { name: 'Output ceiling in dBTP' });
        act(() => input.focus());
        fireEvent.change(input, { target: { value: '-2' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input).toHaveFocus();
        expect(input).toHaveValue(-0.3);
        expect(rawDevice().parameterValues.ceiling).toBe(-0.3);
        expect(captureUndoHistory().past).toHaveLength(0);
        fireEvent.change(input, { target: { value: '-1.5' } });
        expect(input).toHaveValue(-1.5);
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(rawDevice().parameterValues.ceiling).toBe(-1.5));
        expect(projectedDevice()).toEqual(rawDevice());
        expect(input).toHaveFocus();
        expect(captureUndoHistory().past).toHaveLength(1);
        fireEvent.blur(input);
        expect(captureUndoHistory().past).toHaveLength(1);
        await act(() => undo());
        expect(rawDevice().parameterValues.ceiling).toBe(-0.3);
    });

    it('accepts a second completed ceiling edit without blur or refocus', async () => {
        render(<CrustPanel deviceId={DEVICE} />);
        const input = screen.getByRole('spinbutton', { name: 'Output ceiling in dBTP' });
        act(() => input.focus());
        fireEvent.change(input, { target: { value: '-2' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(rawDevice().parameterValues.ceiling).toBe(-2));
        expect(captureUndoHistory().past).toHaveLength(1);
        expect(input).toHaveFocus();
        fireEvent.change(input, { target: { value: '-1.5' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(rawDevice().parameterValues.ceiling).toBe(-1.5));
        expect(projectedDevice()).toEqual(rawDevice());
        expect(captureUndoHistory().past).toHaveLength(2);
        fireEvent.blur(input);
        expect(captureUndoHistory().past).toHaveLength(2);
        await act(() => undo());
        expect(rawDevice().parameterValues.ceiling).toBe(-2);
        await act(() => redo());
        expect(rawDevice().parameterValues.ceiling).toBe(-1.5);
        await act(() => undo());
        expect(rawDevice().parameterValues.ceiling).toBe(-2);
    });
});
