import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { crustMeterStore, crustStore, getCrustState } from '../../../stores/crustStore';
import { CrustPanel } from '../CrustPanel';

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
                        parameterValues: { attack: 17, release: 731, attackAuto: 1, releaseAuto: 1 },
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

describe('Crust rendered project controls', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Crust control integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        crustStore.set({});
        crustMeterStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: crustTracks() });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        cleanup();
        clearHandlerRegistry();
        crustStore.set({});
        crustMeterStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
    });

    it('persists each detail tier per device and retains every lower tier control', async () => {
        // Replaces tests/e2e/crustLevelChipsTestId.spec.ts. The retained
        // devicePanelAllTestId browser witness continues to cover application
        // mount/routing rather than these component-owned controls.
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
                attack: 17,
                release: 731,
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
        // Replaces tests/e2e/crustAttackAutoTestId.spec.ts and
        // tests/e2e/crustReleaseAutoTestId.spec.ts with the real Crust panel,
        // project eligibility and store-backed rendered state.
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
            expect(getCrustState('crust-a').patch.attack).toBe(17);
            expect(getCrustState('crust-a').patch.release).toBe(731);
        });

        fireEvent.click(attack);
        await waitFor(() => expect(attack).toHaveAttribute('aria-pressed', 'false'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: false,
            attack: 17,
            releaseAuto: true,
            release: 731,
        });
        expect(getCrustState('crust-b').patch).toMatchObject({ attackAuto: true, releaseAuto: true });

        fireEvent.click(attack);
        await waitFor(() => expect(attack).toHaveAttribute('aria-pressed', 'true'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: true,
            attack: 17,
            releaseAuto: true,
            release: 731,
        });

        fireEvent.click(release);
        await waitFor(() => expect(release).toHaveAttribute('aria-pressed', 'false'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: true,
            attack: 17,
            releaseAuto: false,
            release: 731,
        });
        expect(getCrustState('crust-b').patch).toMatchObject({ attackAuto: true, releaseAuto: true });

        fireEvent.click(release);
        await waitFor(() => expect(release).toHaveAttribute('aria-pressed', 'true'));
        expect(getCrustState('crust-a').patch).toMatchObject({
            attackAuto: true,
            attack: 17,
            releaseAuto: true,
            release: 731,
        });
    });
});
