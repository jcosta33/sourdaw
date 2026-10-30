import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFailed } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    createCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { glutenMeterStore, glutenStore } from '../../../stores/glutenStore';
import { GlutenPanel } from '../GlutenPanel';

async function selectTier(name: string): Promise<void> {
    const selector = screen.getByRole('group', { name: 'Effect control detail' });
    fireEvent.click(within(selector).getByRole('button', { name }));
    await waitFor(() => expect(within(selector).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true'));
}

const KNOB_FLOORS = [
    ['Threshold', 'Ratio', 'Makeup', 'Mix'],
    ['Knee', 'Attack', 'Release', 'Amount', 'Range', 'Link'],
    ['Stage 2'],
    ['SC HPF', 'SC LPF', 'SC EQ', 'EQ Gain', 'EQ Q'],
    ['Look', 'Color', 'VCA type'],
];

function expectKnobsThrough(level: number): void {
    for (const [floor, names] of KNOB_FLOORS.entries()) {
        for (const name of names) {
            if (floor <= level) {
                expect(screen.getByRole('slider', { name })).toBeVisible();
            } else {
                expect(screen.queryByRole('slider', { name })).toBeNull();
            }
        }
    }
}

function expectButtonsThrough(level: number): void {
    const floors = [
        [1, ['Auto rel', 'Auto gain']],
        [2, ['VCA', 'Opto', 'FET', 'Diode']],
        [
            3,
            [
                'HPF',
                'LPF',
                'SC EQ',
                'Ext SC',
                'RMS',
                'PEAK',
                'stereo',
                'mid',
                'side',
                'Dual mono',
                'Thrust off',
                'Thrust med',
                'Thrust loud',
            ],
        ],
        [4, ['1×', '2×', '4×', 'Delta', 'Match', 'Feedback', 'Feed forward']],
    ] as const;
    for (const [floor, names] of floors) {
        for (const name of names) {
            if (floor <= level) {
                expect(screen.getAllByRole('button', { name })[0]).toBeVisible();
            } else {
                expect(screen.queryByRole('button', { name })).toBeNull();
            }
        }
    }
}

describe('Gluten cumulative disclosure through the real project action', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Gluten disclosure view');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        glutenStore.set({});
        glutenMeterStore.set({});
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Compressor',
                        kind: 'audio',
                        devices: [
                            {
                                id: 'a',
                                name: 'Gluten A',
                                type: 'gluten',
                                bypassed: false,
                                parameterValues: { threshold: -27, ratio: 3, makeup: 5, mix: 0.63 },
                            },
                            { id: 'b', name: 'Gluten B', type: 'gluten', bypassed: false, parameterValues: {} },
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
        glutenStore.set({});
        glutenMeterStore.set({});
    });

    it('admits five named levels and retains every lower-level control cumulatively', async () => {
        let tier = 'initial';
        let phase = 'render';
        const completedTiers: string[] = [];
        onTestFailed(() => console.error('Gluten disclosure progress:', { tier, phase, completedTiers }));
        render(<GlutenPanel deviceId="a" />);
        phase = 'selector';
        const selector = screen.getByRole('group', { name: 'Effect control detail' });
        expect(
            within(selector)
                .getAllByRole('button')
                .map((button) => button.textContent)
        ).toEqual(['play', 'shape', 'build', 'route', 'lab']);
        for (const [level, nextTier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            tier = nextTier;
            phase = 'select';
            await selectTier(tier);
            phase = 'knobs';
            expectKnobsThrough(level);
            phase = 'buttons';
            expectButtonsThrough(level);
            phase = 'topology';
            if (level >= 1) {
                expect(screen.getByRole('button', { name: /VCA Bus duty/ })).toBeVisible();
            } else {
                expect(screen.queryByRole('button', { name: /VCA Bus duty/ })).toBeNull();
            }
            phase = 'preset';
            expect(screen.getByLabelText('Search Gluten presets')).toBeVisible();
            phase = 'threshold';
            expect(screen.getByRole('slider', { name: 'Threshold' })).toHaveAttribute('aria-valuenow', '-27');
            completedTiers.push(tier);
        }
    });

    it('restores Play for a mounted legacy device after its session store is reset', async () => {
        const project = structuredClone(trackStore.value!);
        const parameters = structuredClone(project.tracks[0]!.devices[0]!.parameterValues);
        expect(project.tracks[0]!.devices[0]!.deviceState).toBeUndefined();
        render(<GlutenPanel deviceId="a" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true')
        );

        act(() => {
            glutenStore.set({});
            projectCrdtToStores({ resetProjections: true });
        });

        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(screen.queryByRole('slider', { name: 'Attack' })).toBeNull();
        expect(screen.getByRole('slider', { name: 'Threshold' })).toHaveAttribute('aria-valuenow', '-27');
        expect(screen.getByRole('slider', { name: 'Makeup' })).toHaveAttribute('aria-valuenow', '5');
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual(parameters);
        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
    });

    it('restores distinct device choices after session loss and retains hidden audio values', async () => {
        const before = structuredClone(trackStore.value?.tracks[0]?.devices.map((device) => device.parameterValues));
        const panel = render(<GlutenPanel deviceId="a" />);
        await selectTier('lab');
        panel.rerender(<GlutenPanel deviceId="b" />);
        await selectTier('shape');
        panel.unmount();
        act(() => glutenStore.set({}));
        const restored = render(<GlutenPanel deviceId="a" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true')
        );
        await selectTier('play');
        expect(screen.queryByRole('slider', { name: 'Attack' })).toBeNull();
        expect(screen.getByRole('slider', { name: 'Makeup' })).toHaveAttribute('aria-valuenow', '5');
        await selectTier('shape');
        expect(screen.getByRole('slider', { name: 'Attack' })).toBeVisible();
        restored.rerender(<GlutenPanel deviceId="b" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.parameterValues)).toEqual(before);
    });
});
