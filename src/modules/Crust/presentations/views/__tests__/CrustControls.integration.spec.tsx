import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
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

import {
    crustMeterStore,
    crustStore,
    getCrustMeters,
    getCrustState,
    INITIAL_METERS,
    updateCrustMeters,
} from '../../../stores/crustStore';
import { paramBatcher } from '../../../useCases/crustParamBridge/helpers';
import { CrustPanel } from '../CrustPanel';

const audioEngine = vi.hoisted(() => ({ updateDeviceParam: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audioEngine.updateDeviceParam,
}));

function crustTracks() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'master',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'crust-a',
                        name: 'Crust A',
                        type: 'crust',
                        bypassed: false,
                        parameterValues: { attack: 0, release: 0, attackAuto: 1, releaseAuto: 1 },
                        deviceState: { version: 1, data: { unrelated: 'preserve-a' } },
                    },
                    {
                        id: 'crust-b',
                        name: 'Crust B',
                        type: 'crust',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: { version: 1, data: { unrelated: 'preserve-b' } },
                    },
                ],
            },
        ],
    }).tracks;
}

function projectDevice(deviceId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId);
}

function projectParameter(deviceId: string, parameter: string): number | undefined {
    return projectDevice(deviceId)?.parameterValues?.[parameter];
}

function rawParameter(deviceId: string, parameter: string): number | undefined {
    const root = getCrdtDoc<{ tracks: { tracks: NonNullable<typeof trackStore.value>['tracks'] } }>('root');
    return root?.tracks.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId)
        ?.parameterValues[parameter];
}

async function expectCrustParameter(deviceId: string, parameter: string, value: number): Promise<void> {
    await waitFor(() => expect(projectParameter(deviceId, parameter)).toBe(value));
}

describe('Crust rendered project controls', () => {
    beforeEach(async () => {
        setNotificationEventBus(
            createEventBus<{
                'ui.notify': NotifyPayload;
                'ui.confirm': ConfirmPayload;
                'ui.prompt': PromptPayload;
            }>()
        );
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Crust control integration');
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
        crustStore.set({});
        crustMeterStore.set({});
        audioEngine.updateDeviceParam.mockClear();
        paramBatcher.cancelAll();
        trackStore.set({ ...defaultTrackState, tracks: crustTracks() });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        cleanup();
        paramBatcher.cancelAll();
        clearHandlerRegistry();
        crustStore.set({});
        crustMeterStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
    });

    it('persists each detail tier per device and retains every lower tier control', async () => {
        // Covers each per-device disclosure tier and retains the
        // devicePanelAllTestId browser witness for application mount/routing.
        const panel = render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        const tiers = ['play', 'shape', 'build', 'route', 'lab'] as const;
        const controlWitnesses = [
            () => screen.queryByRole('button', { name: 'Style TRANSPARENT' }),
            () => screen.queryByRole('switch', { name: 'Attack auto' }),
            () => screen.queryByRole('switch', { name: 'Saturation' }),
            () => screen.queryByRole('combobox', { name: 'Dither mode' }),
            () => screen.queryByRole('group', { name: 'Loudness statistics' }),
        ];

        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true')
        );
        for (const [selected, tier] of tiers.entries()) {
            fireEvent.click(within(group).getByRole('button', { name: tier }));
            await waitFor(() => {
                expect(within(group).getByRole('button', { name: tier })).toHaveAttribute('aria-pressed', 'true');
                expect(getCrustState('crust-a').patch.uiLevel).toBe(selected + 1);
                expect(controlWitnesses[selected]?.()).not.toBeNull();
            });
            for (const [index, findWitness] of controlWitnesses.entries()) {
                const witness = findWitness();
                if (index <= selected) {
                    expect(witness).not.toBeNull();
                } else {
                    expect(witness).toBeNull();
                }
            }
            expect(projectDevice('crust-a')?.deviceState).toEqual({
                version: 1,
                data: { unrelated: 'preserve-a', disclosureTier: tier },
            });
            expect(projectDevice('crust-a')?.parameterValues).toEqual({
                attack: 0,
                release: 0,
                attackAuto: 1,
                releaseAuto: 1,
            });
            expect(projectDevice('crust-b')?.deviceState).toEqual({ version: 1, data: { unrelated: 'preserve-b' } });
        }

        panel.rerender(<CrustPanel deviceId="crust-b" />);
        const secondDeviceGroup = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(secondDeviceGroup).getByRole('button', { name: 'shape' }));
        await waitFor(() => {
            expect(within(secondDeviceGroup).getByRole('button', { name: 'shape' })).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            expect(getCrustState('crust-b').patch.uiLevel).toBe(2);
        });
        expect(projectDevice('crust-a')?.deviceState).toEqual({
            version: 1,
            data: { unrelated: 'preserve-a', disclosureTier: 'lab' },
        });
        expect(projectDevice('crust-b')?.deviceState).toEqual({
            version: 1,
            data: { unrelated: 'preserve-b', disclosureTier: 'shape' },
        });
    });

    it('toggles attack-auto and release-auto independently of their manual times', async () => {
        // Covers the independent Attack-auto and Release-auto switches with
        // the real panel, project eligibility and store-backed rendered state.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'shape' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );

        const attack = screen.getByRole('switch', { name: 'Attack auto' });
        const release = screen.getByRole('switch', { name: 'Release auto' });
        await waitFor(() => {
            expect(attack).toHaveAttribute('aria-pressed', 'true');
            expect(release).toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.attack).toBe(0);
            expect(getCrustState('crust-a').patch.release).toBe(0);
        });

        fireEvent.click(attack);
        await waitFor(() => expect(attack).toHaveAttribute('aria-pressed', 'false'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: false,
            attack: 0,
            releaseAuto: true,
            release: 0,
        });
        await expectCrustParameter('crust-a', 'attackAuto', 0);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'attackAuto', 0)
        );
        expect(getCrustState('crust-b').patch).toMatchObject({ attackAuto: true, releaseAuto: true });

        fireEvent.click(attack);
        await waitFor(() => expect(attack).toHaveAttribute('aria-pressed', 'true'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: true,
            attack: 0,
            releaseAuto: true,
            release: 0,
        });
        await expectCrustParameter('crust-a', 'attackAuto', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'attackAuto', 1)
        );

        fireEvent.click(release);
        await waitFor(() => expect(release).toHaveAttribute('aria-pressed', 'false'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: true,
            attack: 0,
            releaseAuto: false,
            release: 0,
        });
        await expectCrustParameter('crust-a', 'releaseAuto', 0);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'releaseAuto', 0)
        );
        expect(getCrustState('crust-b').patch).toMatchObject({ attackAuto: true, releaseAuto: true });

        fireEvent.click(release);
        await waitFor(() => expect(release).toHaveAttribute('aria-pressed', 'true'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: true,
            attack: 0,
            releaseAuto: true,
            release: 0,
        });
        await expectCrustParameter('crust-a', 'releaseAuto', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'releaseAuto', 1)
        );
    });

    it('updates Release and Lookahead through their own keyboard controls', async () => {
        // Covers the Release-time and Lookahead ArrowUp value obligations with
        // real Crust widgets and project state. The Attack-time E2E remains the
        // browser rotary-keyboard witness.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'shape' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );

        const releaseLabel = screen.getByText('Release', { exact: true });
        const releaseContainer = releaseLabel.parentElement;
        if (!releaseContainer) {
            throw new Error('Release timing control has no owner container');
        }
        const release = within(releaseContainer).getByRole('slider');
        expect(release).toHaveAttribute('aria-valuenow', '0');
        fireEvent.keyDown(release, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(release).toHaveAttribute('aria-valuenow', '5');
            expect(getCrustState('crust-a').patch.release).toBe(5);
            expect(getCrustState('crust-a').patch.releaseAuto).toBe(true);
            expect(getCrustState('crust-a').patch.lookahead).toBe(2);
        });
        await expectCrustParameter('crust-a', 'release', 5);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'release',
                5,
                expect.any(Symbol)
            )
        );

        const lookaheadLabel = screen.getByText('Lookahead', { exact: true });
        const lookaheadContainer = lookaheadLabel.parentElement;
        if (!lookaheadContainer) {
            throw new Error('Lookahead timing control has no owner container');
        }
        const lookahead = within(lookaheadContainer).getByRole('slider');
        expect(lookahead).toHaveAttribute('aria-valuenow', '2');
        fireEvent.keyDown(lookahead, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(lookahead).toHaveAttribute('aria-valuenow', '2.1');
            expect(getCrustState('crust-a').patch.lookahead).toBe(2.1);
            expect(getCrustState('crust-a').patch.release).toBe(5);
            expect(getCrustState('crust-a').patch.releaseAuto).toBe(true);
        });
        await expectCrustParameter('crust-a', 'lookahead', 2.1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'lookahead',
                2.1,
                expect.any(Symbol)
            )
        );
    });

    it('commits the Output ceiling number input to its device parameter', async () => {
        // Covers the Output ceiling number-input edit and project action contract.
        render(<CrustPanel deviceId="crust-a" />);
        const ceiling = screen.getByRole('spinbutton', { name: 'Output ceiling in dBTP' });
        expect(ceiling).toHaveValue(-0.3);
        fireEvent.focus(ceiling);
        expect(rawParameter('crust-a', 'ceiling')).toBeUndefined();
        fireEvent.change(ceiling, { target: { value: '-2' } });

        await waitFor(() => {
            expect(ceiling).toHaveValue(-2);
            expect(getCrustState('crust-a').patch).toMatchObject({
                attack: 0,
                attackAuto: true,
                release: 0,
                releaseAuto: true,
                ceiling: -2,
            });
        });
        expect(rawParameter('crust-a', 'ceiling')).toBeUndefined();
        expect(projectParameter('crust-a', 'ceiling')).toBeUndefined();
        fireEvent.keyDown(ceiling, { key: 'Enter' });
        fireEvent.blur(ceiling);
        await expectCrustParameter('crust-a', 'ceiling', -2);
        expect(rawParameter('crust-a', 'ceiling')).toBe(-2);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'ceiling',
                -2,
                expect.any(Symbol)
            )
        );
        expect(projectParameter('crust-b', 'ceiling')).toBeUndefined();
    });

    it('routes Link Trans Home and End through the real Radix slider', async () => {
        // Covers the Radix Slider Home/End contract rather than substituting
        // RotaryKnob keyboard behavior.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'shape' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        const link = screen.getByRole('slider', { name: 'Link Trans' });
        expect(link).toHaveAttribute('aria-valuenow', '100');

        fireEvent.keyDown(link, { key: 'Home' });
        await waitFor(() => {
            expect(link).toHaveAttribute('aria-valuenow', '0');
            expect(getCrustState('crust-a').patch.channelLinkTransient).toBe(0);
        });
        await expectCrustParameter('crust-a', 'channelLinkTransient', 0);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'channelLinkTransient',
                0,
                expect.any(Symbol)
            )
        );

        fireEvent.keyDown(link, { key: 'End' });
        await waitFor(() => {
            expect(link).toHaveAttribute('aria-valuenow', '100');
            expect(getCrustState('crust-a').patch.channelLinkTransient).toBe(100);
        });
        await expectCrustParameter('crust-a', 'channelLinkTransient', 100);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'channelLinkTransient',
                100,
                expect.any(Symbol)
            )
        );
        expect(getCrustState('crust-a').patch.channelLinkRelease).toBe(100);
    });

    it('updates Input gain through CrustGainStrip and refreshes the Push readout', async () => {
        // Covers the CrustGainStrip keyboard handler and its panel store projection.
        render(<CrustPanel deviceId="crust-a" />);
        const gain = screen.getByRole('slider', { name: 'Input gain' });
        expect(gain).toHaveAttribute('aria-valuenow', '0');
        fireEvent.keyDown(gain, { key: 'ArrowUp' });

        await waitFor(() => {
            expect(gain).toHaveAttribute('aria-valuenow', '0.1');
            expect(getCrustState('crust-a').patch).toMatchObject({ gain: 0.1, attackAuto: true, releaseAuto: true });
            expect(screen.getByText('0.1 dB', { exact: true })).toBeVisible();
        });
        await expectCrustParameter('crust-a', 'gain', 0.1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'gain',
                0.1,
                expect.any(Symbol)
            )
        );
    });

    it('selects OS off and clears the 4x chip in patch and project state', async () => {
        // Covers the OS off selection and its project parameter encoding.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'shape' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        const fourTimes = screen.getByRole('button', { name: '4×' });
        const off = screen.getByRole('button', { name: 'OS off' });
        expect(fourTimes).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(off);
        await waitFor(() => {
            expect(off).toHaveAttribute('aria-pressed', 'true');
            expect(fourTimes).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.oversampling).toBe(1);
            expect(getCrustState('crust-a').patch.truePeak).toBe(true);
        });
        await expectCrustParameter('crust-a', 'oversampling', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'oversampling',
                1,
                expect.any(Symbol)
            )
        );
    });

    it('round-trips True peak without changing oversampling or another device', async () => {
        // Covers the True peak control's round-trip state and engine parameter.
        render(<CrustPanel deviceId="crust-a" />);
        const truePeak = screen.getByRole('button', { name: 'True peak' });
        expect(truePeak).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(truePeak);
        await waitFor(() => {
            expect(truePeak).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.truePeak).toBe(false);
        });
        await expectCrustParameter('crust-a', 'truePeak', 0);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'truePeak', 0)
        );

        fireEvent.click(truePeak);
        await waitFor(() => {
            expect(truePeak).toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.truePeak).toBe(true);
        });
        await expectCrustParameter('crust-a', 'truePeak', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'truePeak', 1)
        );
        expect(getCrustState('crust-a').patch.oversampling).toBe(4);
        expect(getCrustState('crust-b').patch.truePeak).toBe(true);
        expect(getCrustState('crust-b').patch.oversampling).toBe(4);
    });

    it('round-trips the footer A=B and Delta buttons selected by the browser locators', async () => {
        // Covers the footer-chip A=B and Delta buttons selected by the old
        // role=button locator.
        // Preserve the distinct CrustControlZone DELTA role=switch control.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'build' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'build' })).toHaveAttribute('aria-pressed', 'true')
        );
        const unity = screen.getByRole('button', { name: 'A=B' });
        const delta = screen.getByRole('button', { name: 'Delta' });
        expect(unity).not.toHaveAttribute('aria-pressed', 'true');
        expect(delta).not.toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(unity);
        await waitFor(() => {
            expect(unity).toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.unityGain).toBe(true);
        });
        await expectCrustParameter('crust-a', 'unityGain', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'unityGain', 1)
        );
        expect(getCrustState('crust-a').patch.deltaListen).toBe(false);

        fireEvent.click(unity);
        await waitFor(() => {
            expect(unity).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.unityGain).toBe(false);
        });
        await expectCrustParameter('crust-a', 'unityGain', 0);

        fireEvent.click(delta);
        await waitFor(() => {
            expect(delta).toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.deltaListen).toBe(true);
        });
        await expectCrustParameter('crust-a', 'deltaListen', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'deltaListen', 1)
        );
        expect(getCrustState('crust-a').patch.unityGain).toBe(false);

        fireEvent.click(delta);
        await waitFor(() => {
            expect(delta).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.deltaListen).toBe(false);
        });
        await expectCrustParameter('crust-a', 'deltaListen', 0);
        expect(getCrustState('crust-b').patch).toMatchObject({ unityGain: false, deltaListen: false });
    });

    it('selects YouTube by name and persists its separate ceiling value', async () => {
        // Selects a named streaming target. Preset identity is store-only;
        // ceiling remains the distinct engine/project parameter.
        render(<CrustPanel deviceId="crust-a" />);
        const target = screen.getByRole('button', { name: /Target Spotify \/ Apple Music/ });
        expect(getCrustState('crust-a').patch.streamingPreset).toBe('spotify');
        expect(getCrustState('crust-a').patch.ceiling).toBe(-0.3);

        fireEvent.click(target);
        const listbox = screen.getByRole('listbox', { name: 'Streaming loudness targets' });
        const youtube = within(listbox).getByRole('option', { name: /YouTube/ });
        fireEvent.click(youtube);

        await waitFor(() => {
            expect(getCrustState('crust-a').patch.streamingPreset).toBe('youtube');
            expect(getCrustState('crust-a').patch.ceiling).toBe(-1);
            expect(target).toHaveTextContent('YouTube');
            expect(target).toHaveTextContent('-14 LUFS');
        });
        fireEvent.click(target);
        expect(
            within(screen.getByRole('listbox', { name: 'Streaming loudness targets' })).getByRole('option', {
                name: /YouTube/,
            })
        ).toHaveAttribute('aria-selected', 'true');
        await expectCrustParameter('crust-a', 'ceiling', -1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'ceiling',
                -1,
                expect.any(Symbol)
            )
        );
        expect(projectParameter('crust-b', 'ceiling')).toBeUndefined();
    });

    it('projects the PUNCHY style coupling and the Shape Dynamic description', async () => {
        // Covers the PUNCHY Play tile and Shape Dynamic algorithm projections.
        render(<CrustPanel deviceId="crust-a" />);
        const punchy = screen.getByRole('button', { name: 'Style PUNCHY' });
        expect(screen.getByRole('button', { name: 'Style TRANSPARENT' })).toHaveAttribute('aria-pressed', 'true');
        audioEngine.updateDeviceParam.mockClear();

        fireEvent.click(punchy);
        await waitFor(() => {
            expect(punchy).toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch).toMatchObject({ style: 'punchy', algorithm: 'punchy' });
        });
        await expectCrustParameter('crust-a', 'style', 1);
        await expectCrustParameter('crust-a', 'algorithm', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'style', 1)
        );

        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'shape' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        const dynamic = screen.getByRole('button', { name: 'Dynamic' });
        fireEvent.click(dynamic);
        await waitFor(() => {
            expect(dynamic).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByText('Enhances transients')).toBeVisible();
            expect(getCrustState('crust-a').patch).toMatchObject({ style: 'punchy', algorithm: 'dynamic' });
        });
        await expectCrustParameter('crust-a', 'algorithm', 2);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'algorithm', 2)
        );
        expect(projectParameter('crust-b', 'style')).toBeUndefined();
        expect(projectParameter('crust-b', 'algorithm')).toBeUndefined();
    });

    it('enables Build saturation, changes its transfer curve and uses the Build DELTA switch', async () => {
        // Covers the saturation enable/tape/curve and distinct Build DELTA
        // role=switch controls.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'build' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'build' })).toHaveAttribute('aria-pressed', 'true')
        );

        const saturation = screen.getByRole('switch', { name: 'Saturation' });
        const tape = screen.getByRole('button', { name: 'tape' });
        expect(saturation).toHaveAttribute('aria-checked', 'false');
        expect(tape).toBeDisabled();
        expect(screen.getByRole('button', { name: 'soft' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(saturation);
        await waitFor(() => {
            expect(saturation).toHaveAttribute('aria-checked', 'true');
            expect(tape).toBeEnabled();
            expect(getCrustState('crust-a').patch.satEnabled).toBe(true);
        });
        await expectCrustParameter('crust-a', 'satEnabled', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'satEnabled', 1)
        );

        fireEvent.click(tape);
        await waitFor(() => {
            expect(tape).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByRole('button', { name: 'soft' })).not.toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByLabelText('Saturation transfer curve: tape')).toBeInTheDocument();
            expect(getCrustState('crust-a').patch).toMatchObject({ satEnabled: true, satAlgorithm: 'tape' });
        });
        await expectCrustParameter('crust-a', 'satAlgorithm', 2);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'satAlgorithm', 2)
        );

        const delta = screen.getByRole('switch', { name: 'DELTA' });
        expect(delta).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(delta);
        await waitFor(() => {
            expect(delta).toHaveAttribute('aria-checked', 'true');
            expect(getCrustState('crust-a').patch.deltaListen).toBe(true);
        });
        await expectCrustParameter('crust-a', 'deltaListen', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'deltaListen', 1)
        );
        expect(projectParameter('crust-b', 'satAlgorithm')).toBeUndefined();
        expect(getCrustState('crust-b').patch.deltaListen).toBe(false);
    });

    it('uses the real saturation Drive and Mix rotary keyboard controls', async () => {
        // Covers both Build saturation ArrowUp value changes using actual rotary widgets.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'build' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'build' })).toHaveAttribute('aria-pressed', 'true')
        );
        fireEvent.click(screen.getByRole('switch', { name: 'Saturation' }));
        await waitFor(() => expect(getCrustState('crust-a').patch.satEnabled).toBe(true));

        const driveLabel = screen.getByText('Drive', { exact: true });
        const driveControl = driveLabel.parentElement;
        if (!driveControl) {
            throw new Error('Saturation Drive knob has no caption owner');
        }
        const drive = within(driveControl).getByRole('slider');
        expect(drive).toHaveAttribute('aria-valuenow', '0');
        fireEvent.keyDown(drive, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(drive).toHaveAttribute('aria-valuenow', '0.1');
            expect(getCrustState('crust-a').patch.satDrive).toBe(0.1);
        });
        await expectCrustParameter('crust-a', 'satDrive', 0.1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'satDrive',
                0.1,
                expect.any(Symbol)
            )
        );

        const mixLabel = screen.getByText('Mix', { exact: true });
        const mixControl = mixLabel.parentElement;
        if (!mixControl) {
            throw new Error('Saturation Mix knob has no caption owner');
        }
        const mix = within(mixControl).getByRole('slider');
        expect(mix).toHaveAttribute('aria-valuenow', '0');
        fireEvent.keyDown(mix, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(mix).toHaveAttribute('aria-valuenow', '1');
            expect(getCrustState('crust-a').patch.satMix).toBe(1);
            expect(getCrustState('crust-a').patch.satDrive).toBe(0.1);
        });
        await expectCrustParameter('crust-a', 'satMix', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'satMix',
                1,
                expect.any(Symbol)
            )
        );
        expect(projectParameter('crust-b', 'satMix')).toBeUndefined();
    });

    it('projects Route multiband, stereo, sidechain HPF, dither, and output depth actions', async () => {
        // Covers each Route control's selected value and parameter mapping.
        render(<CrustPanel deviceId="crust-a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        fireEvent.click(within(group).getByRole('button', { name: 'route' }));
        await waitFor(() =>
            expect(within(group).getByRole('button', { name: 'route' })).toHaveAttribute('aria-pressed', 'true')
        );

        const wide = screen.getByRole('button', { name: 'Wide' });
        const threeBand = screen.getByRole('button', { name: '3band' });
        fireEvent.click(threeBand);
        await waitFor(() => {
            expect(threeBand).toHaveAttribute('aria-pressed', 'true');
            expect(wide).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.multiBand).toBe('3band');
        });
        await expectCrustParameter('crust-a', 'multiBand', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'multiBand', 1)
        );

        const stereo = screen.getByRole('button', { name: 'STEREO' });
        const midSide = screen.getByRole('button', { name: 'MS' });
        fireEvent.click(midSide);
        await waitFor(() => {
            expect(midSide).toHaveAttribute('aria-pressed', 'true');
            expect(stereo).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch.stereoMode).toBe('ms');
        });
        await expectCrustParameter('crust-a', 'stereoMode', 1);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'stereoMode', 1)
        );

        const sidechainLabel = screen.getByText('SC HPF', { exact: true });
        const sidechainGroup = sidechainLabel.parentElement;
        const sidechainSwitch = document.getElementById('crust-sc-hpf');
        if (!sidechainGroup || !sidechainSwitch) {
            throw new Error('Sidechain HPF controls are missing their labeled group');
        }
        expect(sidechainSwitch).toHaveAttribute('aria-checked', 'false');
        expect(within(sidechainGroup).queryByRole('slider')).toBeNull();
        fireEvent.click(sidechainSwitch);
        await waitFor(() => expect(sidechainSwitch).toHaveAttribute('aria-checked', 'true'));
        const hpf = within(sidechainGroup).getByRole('slider');
        expect(hpf).toHaveAttribute('aria-valuenow', '60');
        fireEvent.keyDown(hpf, { key: 'ArrowUp' });
        await waitFor(() => {
            expect(hpf).toHaveAttribute('aria-valuenow', '61');
            expect(getCrustState('crust-a').patch.scHpfFreq).toBe(61);
            expect(getCrustState('crust-a').patch.scHpfEnabled).toBe(true);
        });
        await expectCrustParameter('crust-a', 'scHpfEnabled', 1);
        await expectCrustParameter('crust-a', 'scHpfFreq', 61);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'scHpfFreq',
                61,
                expect.any(Symbol)
            )
        );

        const dither = screen.getByRole('combobox', { name: 'Dither mode' });
        expect(dither).toHaveValue('off');
        fireEvent.change(dither, { target: { value: 'tpdf24' } });
        await waitFor(() => {
            expect(dither).toHaveValue('tpdf24');
            expect(getCrustState('crust-a').patch.dither).toBe('tpdf24');
        });
        await expectCrustParameter('crust-a', 'dither', 2);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'dither', 2)
        );

        const depth24 = screen.getByRole('button', { name: '24-bit' });
        const depth32 = screen.getByRole('button', { name: '32-bit' });
        expect(depth24).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(depth32);
        await waitFor(() => {
            expect(depth32).toHaveAttribute('aria-pressed', 'true');
            expect(depth24).not.toHaveAttribute('aria-pressed', 'true');
            expect(getCrustState('crust-a').patch).toMatchObject({ dither: 'tpdf24', outputBitDepth: 32 });
        });
        await expectCrustParameter('crust-a', 'outputBitDepth', 32);
        await waitFor(() =>
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith(
                'master',
                'crust-a',
                'outputBitDepth',
                32,
                expect.any(Symbol)
            )
        );
        expect(projectParameter('crust-b', 'multiBand')).toBeUndefined();
        expect(getCrustState('crust-b').patch.stereoMode).toBe('stereo');
    });

    it('resets the panel meters from held values without changing the patch or another device', async () => {
        // Covers Reset from held readings back to the displayed floor.
        updateCrustMeters('crust-a', {
            grDb: -8,
            inputDb: -12,
            outputDb: -10,
            lufsIntegrated: -9,
            lufsShortTerm: -7,
            lufsMomentary: -6,
            lra: 11,
            truepeakMax: -0.2,
            truepeakExceeded: true,
        });
        updateCrustMeters('crust-b', { outputDb: -6, lufsIntegrated: -15, truepeakMax: -2, truepeakExceeded: true });
        render(<CrustPanel deviceId="crust-a" />);
        const reset = screen.getByRole('button', { name: 'Reset' });
        const leftMeter = document.getElementById('crust-meter-l');
        if (!leftMeter) {
            throw new Error('Crust left output meter is missing');
        }
        expect(reset).toBeEnabled();
        expect(screen.getByLabelText('Integrated LUFS: -9.0')).toHaveTextContent('-9.0');
        expect(leftMeter).not.toHaveAttribute('aria-valuenow', '0');
        const patch = getCrustState('crust-a').patch;

        fireEvent.click(reset);

        await waitFor(() => {
            expect(getCrustMeters('crust-a')).toEqual(INITIAL_METERS);
            expect(screen.getByLabelText('Integrated LUFS: -100.0')).toHaveTextContent('—');
            expect(leftMeter).toHaveAttribute('aria-valuenow', '0');
            expect(screen.getByRole('group', { name: 'Effect control detail' })).toBeVisible();
            expect(reset).toBeEnabled();
        });
        expect(getCrustState('crust-a').patch).toBe(patch);
        expect(getCrustMeters('crust-b')).toMatchObject({ outputDb: -6, lufsIntegrated: -15, truepeakMax: -2 });
        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('resets only the true-peak hold and pushes the reset to the eligible engine target', async () => {
        // Covers the held true-peak reset's store and engine actions.
        updateCrustMeters('crust-a', {
            outputDb: -8,
            lufsIntegrated: -9,
            lufsShortTerm: -7,
            truepeakMax: -0.2,
            truepeakExceeded: true,
        });
        updateCrustMeters('crust-b', { truepeakMax: -2, truepeakExceeded: true });
        render(<CrustPanel deviceId="crust-a" />);
        const reset = screen.getByRole('button', { name: 'Reset true peak indicator' });
        expect(screen.getByText('Clip', { exact: true })).toBeVisible();
        expect(reset).toBeVisible();
        audioEngine.updateDeviceParam.mockClear();

        fireEvent.click(reset);

        await waitFor(() => {
            expect(getCrustMeters('crust-a')).toMatchObject({
                outputDb: -8,
                lufsIntegrated: -9,
                lufsShortTerm: -7,
                truepeakMax: -100,
                truepeakExceeded: false,
            });
            expect(screen.getByText('Clear', { exact: true })).toBeVisible();
            expect(screen.queryByText('Clip', { exact: true })).toBeNull();
            expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('master', 'crust-a', 'resetTruePeak', 1);
            expect(screen.getByRole('group', { name: 'Effect control detail' })).toBeVisible();
        });
        expect(getCrustMeters('crust-b')).toMatchObject({ truepeakMax: -2, truepeakExceeded: true });
        expect(getCrustState('crust-a').patch).toMatchObject({ ceiling: -0.3, truePeak: true });
    });
});
