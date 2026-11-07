import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    sanitizeTrackSnapshot,
    trackStore,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { getProofState, proofStore, updateProofMeters } from '../../../stores/proofStore';
import { ProofPanel } from '../ProofPanel';

async function selectTier(tier: string): Promise<void> {
    const group = screen.getByRole('group', { name: 'Effect control detail' });
    fireEvent.click(within(group).getByRole('button', { name: tier }));
    await waitFor(() =>
        expect(within(group).getByRole('button', { name: tier })).toHaveAttribute('aria-pressed', 'true')
    );
}

describe('Proof cumulative disclosure in project truth', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Proof disclosure view');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        proofStore.set({ a: getProofState('a'), b: getProofState('b') });
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Mastering',
                        kind: 'audio',
                        devices: [
                            { id: 'a', name: 'Proof A', type: 'proof', bypassed: false, parameterValues: {} },
                            { id: 'b', name: 'Proof B', type: 'proof', bypassed: false, parameterValues: {} },
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
        proofStore.set({});
    });

    it('uses the shared five named tiers with Play selected', () => {
        render(<ProofPanel deviceId="a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        expect(
            within(group)
                .getAllByRole('button')
                .map((button) => button.textContent)
        ).toEqual(['play', 'shape', 'build', 'route', 'lab']);
        expect(within(group).getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('retains every earlier control region at each higher tier and preserves the patch', async () => {
        render(<ProofPanel deviceId="a" />);
        const patch = getProofState('a').patch;
        for (const [selected, tier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            await selectTier(tier);
            for (const [floor, name] of ['Play', 'Shape', 'Build', 'Route', 'Lab'].entries()) {
                if (floor <= selected) {
                    const region = screen.getByRole('region', { name: `${name} controls` });
                    expect(region).toBeVisible();
                    if (name === 'Lab') {
                        expect(within(region).getByLabelText('Loudness history graph')).toBeVisible();
                    } else {
                        const controls = [
                            'Mission limiter ceiling',
                            'Imager Width',
                            'EQ Low Cut frequency',
                            'Input gain',
                        ];
                        const control = controls[floor];
                        if (!control) {
                            throw new Error(`Missing control proof for ${name}`);
                        }
                        expect(within(region).getByRole('slider', { name: control })).toBeVisible();
                    }
                } else {
                    expect(screen.queryByRole('region', { name: `${name} controls` })).toBeNull();
                }
            }
            expect(screen.getByRole('slider', { name: 'Mission limiter ceiling' })).toBeVisible();
            expect(getProofState('a').patch).toBe(patch);
        }
    });

    it('restores independent saved choices after the panel and session store are recreated', async () => {
        const panel = render(<ProofPanel deviceId="a" />);
        await selectTier('lab');
        panel.rerender(<ProofPanel deviceId="b" />);
        await selectTier('shape');
        panel.unmount();
        act(() => proofStore.set({}));
        const restored = render(<ProofPanel deviceId="a" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(screen.getByRole('region', { name: 'Lab controls' })).toBeVisible();
        restored.rerender(<ProofPanel deviceId="b" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(screen.queryByRole('region', { name: 'Build controls' })).toBeNull();
        expect(screen.getByRole('region', { name: 'Play controls' })).toBeVisible();
    });

    it('shows restored sound parameters without an audio bridge and after cache resets', async () => {
        const project = trackStore.value;
        if (!project) {
            throw new Error('Expected the Proof fixture project');
        }
        trackStore.set({
            ...project,
            tracks: project.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) => {
                    if (device.id !== 'a') {
                        return device;
                    }
                    return {
                        ...device,
                        parameterValues: { lim_ceiling: -1.1 },
                        deviceState: { version: 1, data: { disclosureTier: 'lab' } },
                    };
                }),
            })),
        });
        flushAutomergeStorageWrites();
        proofStore.set({});
        render(<ProofPanel deviceId="a" />);

        expect(screen.getByRole('button', { name: /^lab$/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: /^Mission limiter ceiling$/ })).toHaveAttribute(
            'aria-valuenow',
            '-1.1'
        );
        await selectTier('play');
        act(() => proofStore.set({}));
        expect(screen.getByRole('button', { name: /^play$/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: /^Mission limiter ceiling$/ })).toHaveAttribute(
            'aria-valuenow',
            '-1.1'
        );
    });

    it('re-projects the saved choice after a module-cache reset while the panel stays mounted', async () => {
        render(<ProofPanel deviceId="a" />);
        await selectTier('lab');
        // Project loading resets this cache independently of project truth
        // (resetModuleStoresToDefault); a retained panel must read the saved tier.
        act(() => proofStore.set({}));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true')
        );
    });

    it('projects a legacy numeric choice without replacing sound or meter values', () => {
        render(<ProofPanel deviceId="a" />);
        // Compare against initialization, before the subsequent metadata projection.
        const instance = getProofState('a');
        act(() =>
            trackStore.set({
                ...trackStore.value!,
                tracks: trackStore.value!.tracks.map((track) => ({
                    ...track,
                    devices: track.devices.map((device) =>
                        device.id === 'a' ? { ...device, deviceState: { version: 1, data: { uiLevel: 4 } } } : device
                    ),
                })),
            })
        );
        expect(screen.getByRole('button', { name: 'route' })).toHaveAttribute('aria-pressed', 'true');
        expect(getProofState('a').patch).toBe(instance.patch);
        expect(getProofState('a').tapPeaks).toBe(instance.tapPeaks);
    });

    it('announces one loudness warning at every tier', async () => {
        updateProofMeters('a', { ...getProofState('a'), integratedLufs: -4 });
        render(<ProofPanel deviceId="a" />);
        for (const tier of ['play', 'shape', 'build', 'route', 'lab']) {
            await selectTier(tier);
            expect(screen.getAllByRole('alert')).toHaveLength(1);
            expect(screen.getByRole('alert')).toHaveTextContent(/LUFS/);
        }
    });

    it('keeps A/B compare runtime-only through the rendered wet/dry round-trip', async () => {
        // Replaces tests/e2e/proofAbCompareTestId.spec.ts; the retained
        // proofPanelTestId.spec.ts continues to exercise Proof application mount,
        // device routing and saved disclosure integration.
        render(<ProofPanel deviceId="a" />);
        const compare = screen.getByRole('button', { name: 'A/B compare' });

        expect(compare).toHaveAttribute('aria-pressed', 'false');
        expect(compare).toHaveTextContent('B / wet');
        expect(getProofState('a').abBypass).toBe(false);

        fireEvent.click(compare);
        await waitFor(() => {
            expect(compare).toHaveAttribute('aria-pressed', 'true');
            expect(compare).toHaveTextContent('A / dry');
            expect(getProofState('a').abBypass).toBe(true);
        });

        fireEvent.click(compare);
        await waitFor(() => {
            expect(compare).toHaveAttribute('aria-pressed', 'false');
            expect(compare).toHaveTextContent('B / wet');
            expect(getProofState('a').abBypass).toBe(false);
        });

        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({});
        expect(
            getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks[0]?.devices[0]
                ?.parameterValues
        ).toEqual({});
    });

    it('routes every Build module toggle to its own patch and persisted parameter', async () => {
        // Replaces the six Proof limiter/module toggle cases in
        // tests/e2e/proofLimiterBypassTestId.spec.ts and
        // tests/e2e/proofModuleTogglesTestId.spec.ts. The application-level
        // add/open/state witness remains in tests/e2e/proofPanelTestId.spec.ts.
        render(<ProofPanel deviceId="a" />);
        await selectTier('build');

        const modules = [
            { label: 'EQ', key: 'eqBypassed', parameter: 'eq_bypass', initial: false },
            { label: 'Dynamics', key: 'dynBypassed', parameter: 'dyn_bypass', initial: false },
            { label: 'Imager', key: 'imgBypassed', parameter: 'img_bypass', initial: false },
            { label: 'Exciter', key: 'excBypassed', parameter: 'exc_bypass', initial: true },
            { label: 'Limiter', key: 'limBypassed', parameter: 'lim_bypass', initial: false },
        ] as const;
        const buildControls = screen.getByRole('region', { name: 'Build controls' });

        for (const module of modules) {
            const toggle = within(buildControls).getByRole('button', { name: `${module.label} module` });
            const initialPatch = getProofState('a').patch;
            const initialParameters = { ...trackStore.value?.tracks[0]?.devices[0]?.parameterValues };
            expect(initialPatch[module.key]).toBe(module.initial);
            expect(toggle).toHaveAttribute('aria-pressed', String(!module.initial));
            expect(toggle).toHaveTextContent(module.initial ? 'OFF' : 'ON');

            const bypassed = !module.initial;
            fireEvent.click(toggle);
            await waitFor(() => {
                expect(getProofState('a').patch[module.key]).toBe(bypassed);
                expect(toggle).toHaveAttribute('aria-pressed', String(!bypassed));
                expect(toggle).toHaveTextContent(bypassed ? 'OFF' : 'ON');
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues?.[module.parameter]).toBe(
                    bypassed ? 1 : 0
                );
            });

            const currentPatch = getProofState('a').patch;
            for (const other of modules) {
                expect(currentPatch[other.key]).toBe(other.key === module.key ? bypassed : initialPatch[other.key]);
            }
            const currentParameters = trackStore.value?.tracks[0]?.devices[0]?.parameterValues;
            expect(currentParameters).toMatchObject({ ...initialParameters, [module.parameter]: bypassed ? 1 : 0 });
            expect(trackStore.value?.tracks[0]?.devices[1]?.parameterValues).toEqual({});

            fireEvent.click(toggle);
            await waitFor(() => {
                expect(getProofState('a').patch[module.key]).toBe(module.initial);
                expect(toggle).toHaveAttribute('aria-pressed', String(!module.initial));
                expect(toggle).toHaveTextContent(module.initial ? 'OFF' : 'ON');
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues?.[module.parameter]).toBe(
                    module.initial ? 1 : 0
                );
            });
            const restoredPatch = getProofState('a').patch;
            for (const other of modules) {
                expect(restoredPatch[other.key]).toBe(initialPatch[other.key]);
            }
        }
    });
});
