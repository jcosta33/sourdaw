import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { audioEngine, initEngineDeviceCollaborators, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { grinderNeuralLibraryStore } from '../../../stores/grinderNeuralLibraryStore';
import { grinderStore } from '../../../stores/grinderStore';
import { GrinderPanel } from '../GrinderPanel';

registerDeviceEnginePorts();

vi.mock('../../../useCases/restoreGrinderNeuralLibrary', () => ({
    restoreGrinderNeuralLibrary: vi.fn(async () => undefined),
}));

async function selectTier(name: string): Promise<void> {
    const selector = screen.getByRole('group', { name: 'Effect control detail' });
    fireEvent.click(within(selector).getByRole('button', { name }));
    await waitFor(() => expect(within(selector).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true'));
}

describe('Grinder disclosure in project truth', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Grinder disclosure view');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        grinderStore.set({ a: { patch: { ...DEFAULT_PATCH, uiSection: 'lab' }, basePatch: DEFAULT_PATCH } });
        grinderNeuralLibraryStore.set({ hydrated: true, loading: false, importing: false, error: null, entries: [] });
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Guitar',
                        kind: 'audio',
                        devices: [
                            {
                                id: 'a',
                                name: 'Grinder A',
                                type: 'grinder',
                                bypassed: false,
                                parameterValues: { gain: 8, master: 4, bass: 3, mid: 6, treble: 7 },
                            },
                            { id: 'b', name: 'Grinder B', type: 'grinder', bypassed: false, parameterValues: {} },
                        ],
                    },
                ],
            }).tracks,
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        cleanup();
        clearHandlerRegistry();
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        grinderStore.set({});
    });

    it('renders the shared five-tier selector with Play selected by default', () => {
        render(<GrinderPanel deviceId="a" />);
        const selector = screen.getByRole('group', { name: 'Effect control detail' });
        expect(
            within(selector)
                .getAllByRole('button')
                .map((button) => button.textContent)
        ).toEqual(['play', 'shape', 'build', 'route', 'lab']);
        expect(within(selector).getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('hides a remembered Lab section at Play and exposes basic tone controls without changing sound', () => {
        render(<GrinderPanel deviceId="a" />);
        expect(screen.queryByRole('button', { name: 'Gate On' })).toBeNull();
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '8');
        expect(screen.getByRole('slider', { name: 'Master' })).toHaveAttribute('aria-valuenow', '4');
        expect(screen.getByLabelText('Search Grinder presets')).toBeVisible();
        expect(grinderStore.value?.a?.patch.uiSection).toBe('lab');
    });

    it('keeps all section controls reachable at their floor and every higher tier', async () => {
        render(<GrinderPanel deviceId="a" />);
        const floors = [
            { name: 'Browse', floor: 0, control: 'Gain', role: 'slider' },
            { name: 'Amp', floor: 1, control: 'Presence', role: 'slider' },
            { name: 'Drive', floor: 2, control: 'Overdrive', role: 'button' },
            { name: 'Cab', floor: 3, control: 'Room', role: 'slider' },
            { name: 'Neural', floor: 3, control: 'Blend', role: 'slider' },
            { name: 'Lab', floor: 4, control: 'Bias', role: 'slider' },
        ];
        for (const [level, tier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            await selectTier(tier);
            const sections = screen.getByRole('group', { name: 'Grinder sections' });
            for (const { name, floor, control, role } of floors) {
                if (level < floor) {
                    expect(within(sections).queryByRole('button', { name })).toBeNull();
                    expect(screen.queryByRole(role, { name: control })).toBeNull();
                    continue;
                }
                fireEvent.click(within(sections).getByRole('button', { name }));
                expect(within(sections).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
                for (const element of screen.getAllByRole(role, { name: control })) {
                    expect(element).toBeVisible();
                }
            }
            expect(screen.getByLabelText('Search Grinder presets')).toBeVisible();
        }
    });

    it('restores a hidden section and its values when returning to a higher tier', async () => {
        render(<GrinderPanel deviceId="a" />);
        await selectTier('lab');
        const sections = screen.getByRole('group', { name: 'Grinder sections' });
        fireEvent.click(within(sections).getByRole('button', { name: 'Amp' }));
        const instance = grinderStore.value?.a;
        const parameters = structuredClone(trackStore.value?.tracks[0]?.devices[0]?.parameterValues);
        await selectTier('play');
        expect(screen.queryByRole('slider', { name: 'Presence' })).toBeNull();
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '8');
        expect(grinderStore.value?.a).toBe(instance);
        await selectTier('shape');
        expect(screen.getByRole('slider', { name: 'Presence' })).toBeVisible();
        expect(grinderStore.value?.a).toBe(instance);
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual(parameters);
    });

    it('restores each device choice after a panel remount and complete session-store loss', async () => {
        const panel = render(<GrinderPanel deviceId="a" />);
        await selectTier('lab');
        panel.rerender(<GrinderPanel deviceId="b" />);
        await selectTier('shape');
        panel.unmount();
        act(() => grinderStore.set({}));
        const restored = render(<GrinderPanel deviceId="a" />);
        expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '8');
        restored.rerender(<GrinderPanel deviceId="b" />);
        expect(screen.getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('hydrates after duplicate identity becomes eligible with identical parameter values', () => {
        const track = trackStore.value!.tracks[0]!;
        const ambiguous = { ...track, devices: [...track.devices, track.devices[0]!] };
        trackStore.set({ ...defaultTrackState, tracks: [ambiguous] });
        render(<GrinderPanel deviceId="a" />);
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute(
            'aria-valuenow',
            String(DEFAULT_PATCH.gain)
        );
        act(() => trackStore.set({ ...defaultTrackState, tracks: [track] }));
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '8');
    });

    it('replays project parameters for a successor project even when their values match', () => {
        render(<GrinderPanel deviceId="a" />);
        act(() => grinderStore.set({ a: { patch: { ...DEFAULT_PATCH, gain: 2 }, basePatch: DEFAULT_PATCH } }));
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '2');
        const tracks = structuredClone(trackStore.value!.tracks);
        act(() => {
            resetCrdtProjectAuthority('Successor project with identical Grinder values');
            trackStore.set({ ...defaultTrackState, tracks });
        });
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '8');
    });

    describe('Gain in the mounted editor', () => {
        const writes = vi.fn<(trackId: string, deviceId: string, paramId: string, value: number) => void>();

        function rawValues(deviceId: string): Record<string, number> {
            flushAutomergeStorageWrites();
            const device = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.devices.find(
                (candidate) => candidate.id === deviceId
            );
            if (!device) {
                throw new Error('Grinder is missing from the raw project');
            }
            return device.parameterValues;
        }

        function gainKnob(): HTMLElement {
            const knob = screen.getByRole('slider', { name: /^Gain$/ });
            Object.defineProperties(knob, {
                setPointerCapture: { configurable: true, value: vi.fn() },
                releasePointerCapture: { configurable: true, value: vi.fn() },
            });
            return knob;
        }

        function dragGain(knob: HTMLElement): void {
            fireEvent.pointerDown(knob, { button: 0, pointerId: 1, clientY: 100 });
            fireEvent.pointerMove(knob, { pointerId: 1, clientY: 85 });
        }

        beforeEach(async () => {
            clearUndoHistory();
            resetActionReplayAuthority();
            setActionHistoryMetadataPort({
                record: () => [],
                markReverted: () => ({ status: 'unavailable' }),
                clear: () => undefined,
            });
            setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
            const transition = runProjectLoadTransaction();
            expect(await transition.prepare()).toBe(true);
            expect(transition.activate()).toBe(true);
            writes.mockClear();
            const wire = vi.spyOn(audioEngine, 'setUseCaseDeviceCollaborators');
            initEngineDeviceCollaborators();
            const collaborators = wire.mock.calls[0]?.[0];
            if (!collaborators) {
                throw new Error('Missing AudioEngine parameter receipt wiring');
            }
            vi.spyOn(audioEngine, 'updateDeviceParam').mockImplementation((trackId, deviceId, paramId, value) => {
                const complete = collaborators.captureParameterWriteReceipt(trackId, deviceId, paramId).begin();
                writes(trackId, deviceId, paramId, value);
                complete();
            });
        });

        afterEach(() => {
            cleanup();
            clearUndoHistory();
            resetActionReplayAuthority();
            audioEngine.setUseCaseDeviceCollaborators(null);
            vi.restoreAllMocks();
        });

        it('previews without writing, appends one release edit, and undoes to the absent key', async () => {
            await executeAppAction(
                {
                    type: 'setDeviceParameter',
                    payload: { deviceId: 'a', paramId: 'gain', value: 5, deleteParameter: true },
                },
                { skipUndo: true }
            );
            await executeAppAction({
                type: 'setDeviceParameter',
                payload: { deviceId: 'b', paramId: 'gain', value: 3 },
            });
            const original = captureUndoHistory().past;
            const raw = rawValues('a');
            expect(Object.hasOwn(raw, 'gain')).toBe(false);
            writes.mockClear();
            render(<GrinderPanel deviceId="a" />);
            const knob = gainKnob();

            dragGain(knob);
            expect(knob).toHaveAttribute('aria-valuenow', '6');
            expect(writes.mock.calls).toEqual([['track', 'a', 'gain', 6]]);
            expect(rawValues('a')).toEqual(raw);
            expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual(raw);
            expect(captureUndoHistory().past).toEqual(original);

            fireEvent.pointerMove(knob, { pointerId: 1, clientY: 70 });
            fireEvent.pointerUp(knob, { pointerId: 1 });
            await waitFor(() => expect(undoStore.value?.past).toHaveLength(original.length + 1));
            const released = captureUndoHistory().past.at(-1);
            expect(released).toMatchObject({
                kind: 'action',
                action: {
                    type: 'setDeviceParameter',
                    payload: { deviceId: 'a', paramId: 'gain', value: 7 },
                },
            });
            expect(captureUndoHistory().past.slice(0, -1)).toEqual(original);
            expect(rawValues('a')).toEqual({ ...raw, gain: 7 });
            expect(writes).toHaveBeenLastCalledWith('track', 'a', 'gain', 7);

            await act(undo);
            expect(captureUndoHistory().past).toEqual(original);
            expect(captureUndoHistory().future.map((entry) => entry.id)).toEqual([released?.id]);
            const restored = rawValues('a');
            expect(Object.hasOwn(restored, 'gain')).toBe(false);
            expect(restored).toEqual(raw);
            expect(knob).toHaveAttribute('aria-valuenow', '5');
            expect(writes).toHaveBeenLastCalledWith('track', 'a', 'gain', 5);

            await act(redo);
            expect(rawValues('a')).toEqual({ ...raw, gain: 7 });
            expect(knob).toHaveAttribute('aria-valuenow', '7');
            expect(writes).toHaveBeenLastCalledWith('track', 'a', 'gain', 7);
            expect(rawValues('b')).toEqual({ gain: 3 });
            expect(writes.mock.calls.every(([, deviceId]) => deviceId === 'a')).toBe(true);
        });

        it('cannot release Gain to a removed device or edit a replacement of another type', async () => {
            render(<GrinderPanel deviceId="a" />);
            const knob = gainKnob();
            const original = trackStore.value!;
            const track = original.tracks[0]!;
            const [owner, sentinel] = track.devices;
            if (!owner || !sentinel) {
                throw new Error('Expected both fixture devices');
            }
            const previousSentinel = rawValues(sentinel.id);

            dragGain(knob);
            expect(writes.mock.calls).toEqual([['track', 'a', 'gain', 9]]);
            act(() => trackStore.set({ ...original, tracks: [{ ...track, devices: [sentinel] }] }));
            await act(async () => {
                fireEvent.pointerUp(knob, { pointerId: 1 });
            });
            expect(trackStore.value?.tracks[0]?.devices.map(({ id }) => id)).toEqual([sentinel.id]);
            expect(rawValues(sentinel.id)).toEqual(previousSentinel);

            const replacement = { ...owner, type: 'bacteria', parameterValues: { inputGain: -3 } };
            act(() => trackStore.set({ ...original, tracks: [{ ...track, devices: [replacement, sentinel] }] }));
            await act(async () => {
                fireEvent.keyDown(knob, { key: 'ArrowUp' });
            });

            expect(rawValues('a')).toEqual(replacement.parameterValues);
            expect(trackStore.value?.tracks[0]?.devices[0]).toMatchObject(replacement);
            expect(writes.mock.calls).toEqual([['track', 'a', 'gain', 9]]);
            expect(captureUndoHistory().past).toHaveLength(0);
        });

        it('restores owned preview on pointer cancellation and cannot overwrite a competing runtime write', async () => {
            render(<GrinderPanel deviceId="a" />);
            const knob = gainKnob();
            dragGain(knob);
            expect(writes).toHaveBeenLastCalledWith('track', 'a', 'gain', 9);
            fireEvent.pointerCancel(knob, { pointerId: 1 });
            expect(writes).toHaveBeenLastCalledWith('track', 'a', 'gain', 8);
            expect(knob).toHaveAttribute('aria-valuenow', '8');

            dragGain(knob);
            act(() => updateDeviceParam('track', 'a', 'gain', 4));
            await act(async () => {
                fireEvent.pointerUp(knob, { pointerId: 1 });
            });
            expect(writes.mock.calls.map(([, , , value]) => value)).toEqual([9, 8, 9, 4]);
            expect(rawValues('a')).toHaveProperty('gain', 8);
            expect(knob).toHaveAttribute('aria-valuenow', '8');
            expect(undoStore.value?.past).toHaveLength(0);
        });
    });
});
