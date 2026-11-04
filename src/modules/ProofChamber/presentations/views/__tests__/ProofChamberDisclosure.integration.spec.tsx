import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

import { chamberStore } from '../../../stores/chamberStore';
import { ProofChamberPanel } from '../ProofChamberPanel';

function deviceState(id: string) {
    return trackStore.value?.tracks.flatMap((track) => track.devices).find((device) => device.id === id)?.deviceState;
}

async function selectTier(name: string): Promise<void> {
    const selector = screen.getByRole('group', { name: 'Effect control detail' });
    fireEvent.click(within(selector).getByRole('button', { name }));
    await waitFor(() => expect(within(selector).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true'));
}

describe('Dutch Oven cumulative disclosure through the real project action', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Dutch Oven disclosure view');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        chamberStore.set({ activeInstanceId: null, instances: {} });
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Reverb',
                        kind: 'audio',
                        devices: [
                            {
                                id: 'a',
                                name: 'Dutch Oven A',
                                type: 'dutch-oven',
                                bypassed: false,
                                parameterValues: { width: 1.37, gravity: 0.23, shimmer: 1, saturation: 1 },
                            },
                            { id: 'b', name: 'Dutch Oven B', type: 'dutch-oven', bypassed: false, parameterValues: {} },
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
        chamberStore.set({ activeInstanceId: null, instances: {} });
    });

    it('admits all five named tiers and shows each control only at its cumulative floor', async () => {
        render(<ProofChamberPanel deviceId="a" />);
        const selector = screen.getByRole('group', { name: 'Effect control detail' });
        expect(
            within(selector)
                .getAllByRole('button')
                .map((button) => button.textContent)
        ).toEqual(['play', 'shape', 'build', 'route', 'lab']);
        const sections = [
            ['Space tray', 'Core'],
            ['Flavor', 'Tone'],
            ['Switches', 'Motion'],
            ['IR tray'],
            ['Character', 'Engine'],
        ];
        for (const [level, tier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            await selectTier(tier);
            for (const [floor, headings] of sections.entries()) {
                for (const heading of headings) {
                    if (floor <= level) {
                        expect(screen.getByText(heading)).toBeVisible();
                    } else {
                        expect(screen.queryByText(heading)).toBeNull();
                    }
                }
            }
            const knobFloors = [
                ['Size', 'Decay', 'Mix', 'Pre'],
                ['Hi Cut', 'Lo Cut', 'Damp', 'Diffuse'],
                ['Rate', 'Depth', 'Width', 'E/L', 'Amount', 'Pitch'],
                [],
                ['Gravity', 'Vintage', 'Density'],
            ];
            for (const [floor, names] of knobFloors.entries()) {
                for (const name of names) {
                    if (floor <= level) {
                        expect(screen.getByRole('slider', { name })).toBeVisible();
                    } else {
                        expect(screen.queryByRole('slider', { name })).toBeNull();
                    }
                }
            }
            for (const [floor, names] of [
                [1, ['Plate', 'FDN 8', 'FDN 16', 'Spring', 'Reverse']],
                [2, ['Freeze', 'Shimmer', 'Saturation', 'Decay EQ', 'Tanh', 'Cheby', 'Clip']],
                [3, ['Flow']],
                [4, ['Modern', '80s', '70s']],
            ] as const) {
                for (const name of names) {
                    if (floor <= level) {
                        expect(screen.getAllByRole('button', { name })[0]).toBeVisible();
                    } else {
                        expect(screen.queryByRole('button', { name })).toBeNull();
                    }
                }
            }
        }
        expect(screen.getByRole('slider', { name: 'Gravity' })).toHaveAttribute('aria-valuenow', '0.23');
        expect(deviceState('a')).toEqual({ version: 1, data: { disclosureTier: 'lab' } });
        expect(deviceState('b')).toBeUndefined();
    });

    it('hides open overlays below their tier and restores them without writing audio parameters', async () => {
        const panel = render(<ProofChamberPanel deviceId="a" />);
        const before = structuredClone(trackStore.value?.tracks[0]?.devices[0]?.parameterValues);
        await selectTier('route');
        fireEvent.click(screen.getByRole('button', { name: 'Decay EQ' }));
        fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
        expect(panel.container.querySelector('canvas.absolute')).not.toBeNull();
        expect(screen.getByText('Signal flow')).toBeVisible();
        await selectTier('shape');
        expect(panel.container.querySelector('canvas.absolute')).toBeNull();
        expect(screen.queryByText('Signal flow')).toBeNull();
        expect(screen.getByText('Live tail')).toBeVisible();
        await selectTier('build');
        expect(panel.container.querySelector('canvas.absolute')).not.toBeNull();
        expect(screen.queryByText('Signal flow')).toBeNull();
        expect(screen.getByText('EQ overlay')).toBeVisible();
        await selectTier('route');
        expect(screen.getByText('Signal flow')).toBeVisible();
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual(before);
    });

    it('keeps distinct choices after unmount and session-store loss without changing audio values', async () => {
        const before = structuredClone(trackStore.value);
        const panel = render(<ProofChamberPanel deviceId="a" />);
        await selectTier('lab');
        panel.rerender(<ProofChamberPanel deviceId="b" />);
        await selectTier('shape');
        panel.unmount();
        act(() => chamberStore.set({ activeInstanceId: null, instances: {} }));
        const restored = render(<ProofChamberPanel deviceId="a" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true')
        );
        await selectTier('play');
        expect(screen.queryByRole('slider', { name: 'Width' })).toBeNull();
        await selectTier('build');
        expect(screen.getByRole('slider', { name: 'Width' })).toHaveAttribute('aria-valuenow', '1.37');
        restored.rerender(<ProofChamberPanel deviceId="b" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.parameterValues)).toEqual(
            before?.tracks[0]?.devices.map((device) => device.parameterValues)
        );
    });
});
