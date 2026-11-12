import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
    createTrack,
    getArrangementHandlers,
    persistDevicePatch,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { fromFermenterDeviceState } from '../../../models/FermenterPatchState';
import { fermenterStore, getFermenterState } from '../../../stores/fermenterStore';
import { fermenterDependenciesHolder, setFermenterDependencies } from '../../../useCases/fermenterDependencies';
import { fermenterPatchBatcher } from '../../../useCases/fermenterParamBridge/fermenterParamBatcher';
import { getFermenterHandlers } from '../../../useCases/getFermenterHandlers';
import { FermenterPanel } from '../FermenterPanel';

const DEVICE = 'fermenter-keyboard';

describe('Fermenter real controls', () => {
    beforeEach(async () => {
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Fermenter control keyboard');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getFermenterHandlers());
        projectStore.set({ ...defaultProjectStoreState, loading: false });
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'track', name: 'Track', kind: 'midi' }),
                    devices: [
                        { id: DEVICE, type: 'fermenter', name: 'Fermenter', bypassed: false, parameterValues: {} },
                        { id: 'other', type: 'fermenter', name: 'Other', bypassed: false, parameterValues: {} },
                    ],
                },
            ],
            selectedTrackId: 'track',
            ghostClips: [],
        });
        fermenterStore.set({});
        setFermenterDependencies({
            clampDeviceParameterValue,
            persistDeviceParam,
            persistDevicePatch,
            resolveEligibleDeviceWriteTarget,
            updateDeviceParam: vi.fn(),
            getAllTracks: () => trackStore.value?.tracks ?? [],
        });
        flushAutomergeStorageWrites();
    });
    afterEach(() => {
        cleanup();
        fermenterPatchBatcher.cancel(DEVICE);
        fermenterPatchBatcher.cancel('other');
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        fermenterStore.set({});
        fermenterDependenciesHolder.current = null;
    });
    function renderPanel() {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <FermenterPanel deviceId={DEVICE} />
            </QueryClientProvider>
        );
    }
    it('routes oscillator Coarse and Fine keyboard steps to their own parameters', async () => {
        renderPanel();
        for (const [label, key, before, after] of [
            ['Coarse', 'oscCoarse', 0, 1],
            ['Fine', 'oscFine', 0, 0.1],
        ] as const) {
            const control = screen.getByRole('slider', { name: label });
            const previousPatch = getFermenterState(DEVICE).patch;
            const previousValues = trackStore.value?.tracks[0]?.devices[0]?.parameterValues;
            expect(control).toHaveAttribute('aria-valuenow', String(before));
            control.focus();
            fireEvent.keyDown(control, { key: 'ArrowUp' });
            fireEvent.keyUp(control, { key: 'ArrowUp' });
            await waitFor(() => {
                expect(Number(control.getAttribute('aria-valuenow'))).toBeCloseTo(after, 5);
                expect(getFermenterState(DEVICE).patch[key]).toBeCloseTo(after, 5);
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues[key]).toBeCloseTo(after, 5);
            });
            expect({ ...getFermenterState(DEVICE).patch, [key]: before }).toEqual(previousPatch);
            expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({
                ...previousValues,
                [key]: expect.closeTo(after, 5),
            });
            expect(trackStore.value?.tracks[0]?.devices[1]?.parameterValues).toEqual({});
        }
    });
    it('switches Dist to Comp and back with the real controls', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: 'Effects' }));
        const dist = screen.getByRole('button', { name: 'Dist' });
        const comp = screen.getByRole('button', { name: 'Comp' });
        expect(dist).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: 'Drive' })).toBeVisible();
        expect(screen.queryByRole('slider', { name: 'Ratio' })).toBeNull();
        fireEvent.click(comp);
        expect(comp).toHaveAttribute('aria-pressed', 'true');
        expect(dist).not.toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('slider', { name: 'Drive' })).toBeNull();
        expect(screen.getByRole('slider', { name: 'Ratio' })).toBeVisible();
        fireEvent.click(dist);
        expect(dist).toHaveAttribute('aria-pressed', 'true');
        expect(comp).not.toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: 'Drive' })).toBeVisible();
        expect(screen.queryByRole('slider', { name: 'Ratio' })).toBeNull();
    });

    it.each([
        ['Level', '', '', [['Level', 'oscLevel', 0.8, 0.81]]],
        ['Noise', '', '', [['Noise', 'noiseLevel', 0, 0.01]]],
        [
            'Unison',
            '',
            '',
            [
                ['Voices', 'unisonVoices', 1, 2],
                ['Detune', 'unisonDetune', 15, 16],
            ],
        ],
        [
            'amp Decay and Release',
            'Envelopes',
            '',
            [
                ['ampDecay', 'ampDecay', 0.2, 0.206],
                ['ampRelease', 'ampRelease', 0.3, 0.306],
            ],
        ],
        [
            'amp Attack and Sustain',
            'Envelopes',
            '',
            [
                ['ampAttack', 'ampAttack', 0.01, 0.016],
                ['ampSustain', 'ampSustain', 0.7, 0.71],
            ],
        ],
        [
            'Filter Cutoff and Env',
            'Filter',
            '',
            [
                ['filterCutoff', 'filterCutoff', 5000, 5010],
                ['Env', 'filterEnvAmount', 0.5, 0.51],
            ],
        ],
        [
            'Filter Reso Drive and Key',
            'Filter',
            '',
            [
                ['filterResonance', 'filterResonance', 1, 1.1],
                ['Drive', 'filterDrive', 0, 0.1],
                ['Key', 'filterKeytrack', 0, 0.01],
            ],
        ],
        ['LFO Rate', 'Envelopes', '', [['lfoRate', 'lfoRate', 0, 0.1]]],
        [
            'LFO Pitch and Filter',
            'Envelopes',
            '',
            [
                ['→ Pitch', 'lfoPitchAmount', 0, 0.01],
                ['→ Filter', 'lfoFilterAmount', 0, 0.01],
            ],
        ],
        [
            'Comp',
            'Effects',
            'Comp',
            [
                ['Thresh', 'compThreshold', -20, -19],
                ['Ratio', 'compRatio', 4, 4.5],
            ],
        ],
        [
            'Delay',
            'Effects',
            'Delay',
            [
                ['Time', 'delayTime', 375, 376],
                ['Feedback', 'delayFeedback', 0.35, 0.36],
            ],
        ],
        [
            'Dist',
            'Effects',
            '',
            [
                ['Drive', 'distDrive', 0, 0.1],
                ['Mix', 'distMix', 0, 0.01],
            ],
        ],
        [
            'Master',
            'Effects',
            'Master',
            [
                ['stereoWidth', 'stereoWidth', 1, 1.01],
                ['masterGain', 'masterGain', 1, 1.01],
            ],
        ],
        [
            'Reverb',
            'Effects',
            'Reverb',
            [
                ['Mix', 'reverbMix', 0.2, 0.21],
                ['Decay', 'reverbDecay', 0.5, 0.51],
            ],
        ],
        [
            'Chorus',
            'Effects',
            'Chorus/Phaser',
            [
                ['Chorus Rate', 'chorusRate', 1.2, 1.3],
                ['Chorus Mix', 'chorusMix', 0, 0.01],
            ],
        ],
    ] as const)('routes %s keyboard steps to their matching parameters', async (name, section, tab, controls) => {
        renderPanel();
        if (section) {
            fireEvent.click(screen.getAllByRole('tab', { name: section })[0]!);
        }
        if (tab) {
            fireEvent.click(screen.getByRole('button', { name: tab }));
        }
        const scope = name === 'Chorus' ? within(screen.getByText('Chorus', { exact: true }).parentElement!) : screen;
        for (const [label, key, before, after] of controls) {
            const control = scope.getByRole('slider', { name: label });
            const previousPatch = getFermenterState(DEVICE).patch;
            const previousValues = trackStore.value?.tracks[0]?.devices[0]?.parameterValues;
            expect(control).toHaveAttribute('aria-valuenow', String(before));
            control.focus();
            fireEvent.keyDown(control, { key: 'ArrowUp' });
            fireEvent.keyUp(control, { key: 'ArrowUp' });
            await waitFor(() => {
                expect(control).toHaveAttribute('aria-valuenow', String(after));
                expect(getFermenterState(DEVICE).patch[key]).toBeCloseTo(after, 5);
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues[key]).toBeCloseTo(after, 5);
            });
            expect({ ...getFermenterState(DEVICE).patch, [key]: before }).toEqual(previousPatch);
            expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({
                ...previousValues,
                [key]: expect.closeTo(after, 5),
            });
            expect(trackStore.value?.tracks[0]?.devices[1]?.parameterValues).toEqual({});
        }
    });

    // MacroStrip maps labels by index from MACRO_LABELS in models/FermenterPatch.ts.
    it.each([
        ['Brightness', 0],
        ['Motion', 1],
        ['Width', 2],
        ['Dirt', 3],
        ['Space', 4],
        ['Punch', 5],
        ['Texture', 6],
        ['Character', 7],
    ] as const)('routes %s to macro index %i', async (label, index) => {
        renderPanel();
        const control = screen.getByRole('slider', { name: label });
        const previous = [...getFermenterState(DEVICE).patch.macros];
        expect(control).toHaveAttribute('aria-valuenow', '0.5');
        control.focus();
        fireEvent.keyDown(control, { key: 'ArrowUp' });
        fireEvent.keyUp(control, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(control).toHaveAttribute('aria-valuenow', '0.51');
            expect(getFermenterState(DEVICE).patch.macros[index]).toBeCloseTo(0.51, 5);
            const document = getCrdtDoc<{
                tracks: { tracks: Array<{ devices: Array<{ id: string; deviceState?: unknown }> }> };
            }>('root');
            const device = document?.tracks.tracks
                .flatMap((track) => track.devices)
                .find((candidate) => candidate.id === DEVICE);
            expect(fromFermenterDeviceState(device?.deviceState)?.macros[index]).toBeCloseTo(0.51, 5);
            expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues.oscLevel ?? DEFAULT_PATCH.oscLevel).toBe(
                0.8
            );
        });
        const expected = [...previous];
        expected[index] = 0.51;
        expect(getFermenterState(DEVICE).patch.macros).toEqual(expected);
        expect(trackStore.value?.tracks[0]?.devices[1]?.parameterValues).toEqual({});
    });
});
