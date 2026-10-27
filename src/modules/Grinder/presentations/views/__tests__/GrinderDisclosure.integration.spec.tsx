import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { grinderNeuralLibraryStore } from '../../../stores/grinderNeuralLibraryStore';
import { grinderStore } from '../../../stores/grinderStore';
import { GrinderPanel } from '../GrinderPanel';

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
});
