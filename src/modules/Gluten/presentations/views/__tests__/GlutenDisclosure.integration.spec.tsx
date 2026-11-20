import { getObjectId } from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, type Track, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
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

import { glutenMeterStore, glutenStore } from '../../../stores/glutenStore';
import { selectGlutenFactoryPreset } from '../../../useCases/selectGlutenFactoryPreset';
import { GlutenPanel } from '../GlutenPanel';

const updateDeviceParam = vi.hoisted(() =>
    vi.fn<(trackId: string, deviceId: string, key: string, value: number) => void>()
);

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam,
}));

const GENTLE_GLUE_PARAMETERS = {
    style: 0,
    topology: 0,
    amount: 50,
    threshold: -12,
    ratio: 2,
    attack: 30,
    release: 300,
    knee: 10,
    makeup: 0,
    mix: 1,
    autoMakeup: 0,
    autoRelease: 1,
    range: 10,
    scHpfFreq: 80,
    scHpfEnabled: 1,
    thrust: 0,
    detection: 0,
    stereoMode: 0,
    stereoLink: 1,
    oversampling: 1,
    lookahead: 0,
    scLpfFreq: 20000,
    scLpfEnabled: 0,
    scEqFreq: 1000,
    scEqGain: 0,
    scEqQ: 1,
    scEqEnabled: 0,
    deltaListen: 0,
    gainMatchBypass: 0,
    extSidechain: 0,
    inputGain: 0,
    outputGain: 0,
    xfmrDrive: 1.2,
    allButtons: 0,
    limitMode: 0,
    recovery: 3,
    vcaType: 1,
    vcaCharacter: 0.003,
    feedForward: 0,
    jfetK3: 0.15,
    xfmrK2: 0,
    blendTopology: 1,
    blendAmount: 0,
};

const INIT_PARAMETERS = { ...GENTLE_GLUE_PARAMETERS, threshold: -18, ratio: 4, attack: 10, knee: 6, range: 15 };
const PROJECT_ID = 'gluten-disclosure-view';
const SESSION_KEY = 'sourdaw-undo-session';
type Root = { tracks: { tracks: Track[] } };

function expectRuntimePreset(parameters: Record<string, number>): void {
    expect(updateDeviceParam.mock.calls).toEqual(
        Object.entries(parameters).map(([key, value]) => ['track', 'a', key, value])
    );
    updateDeviceParam.mockClear();
}

function rawTrack(): Track {
    const track = getCrdtDoc<Root>('root')?.tracks.tracks[0];
    if (!track) {
        throw new Error('Expected the committed Gluten track');
    }
    return track;
}

function registerHandlers(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function selectPresetRow(name: string): HTMLElement {
    const search = screen.getByLabelText('Search Gluten presets');
    fireEvent.change(search, { target: { value: name } });
    const preset = screen.getByRole('button', { name: new RegExp(name) });
    preset.focus();
    fireEvent.click(preset);
    return preset;
}

function expectPatchName(name: string): void {
    const overview = screen.getByRole('region', { name: 'Gluten dynamics overview' });
    expect(within(overview).getByText(name, { exact: true })).toBeVisible();
}

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

function controlsByName(role: 'slider' | 'button'): Map<string, HTMLElement[]> {
    const names = new Map<Element, string>();
    const controls = screen.queryAllByRole(role, {
        name: (name, element) => {
            names.set(element, name);
            return true;
        },
    });
    const byName = new Map<string, HTMLElement[]>();
    for (const control of controls) {
        const name = names.get(control);
        if (name === undefined) {
            throw new Error(`Missing accessible name for ${role}`);
        }
        const group = byName.get(name);
        if (group) {
            group.push(control);
        } else {
            byName.set(name, [control]);
        }
    }
    return byName;
}

function expectKnobsThrough(level: number): void {
    const controls = controlsByName('slider');
    for (const [floor, names] of KNOB_FLOORS.entries()) {
        for (const name of names) {
            const matches = controls.get(name) ?? [];
            if (floor <= level) {
                expect(matches).toHaveLength(1);
                expect(matches[0]).toBeVisible();
            } else {
                expect(matches).toHaveLength(0);
            }
        }
    }
}

function expectButtonsThrough(level: number): void {
    const controls = controlsByName('button');
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
            const matches = controls.get(name) ?? [];
            if (floor <= level) {
                expect(matches.length).toBeGreaterThan(0);
                expect(matches[0]).toBeVisible();
            } else {
                expect(matches).toHaveLength(0);
            }
        }
    }
}

describe('Gluten cumulative disclosure through the real project action', () => {
    beforeEach(async () => {
        updateDeviceParam.mockClear();
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
        configureAutomergeStoragePort(null);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => {} });
        setNotificationEventBus(
            createEventBus<{
                'ui.notify': NotifyPayload;
                'ui.confirm': ConfirmPayload;
                'ui.prompt': PromptPayload;
            }>()
        );
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        resetCrdtProjectAuthority(PROJECT_ID);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        registerHandlers();
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
                                parameterValues: {
                                    style: 1,
                                    topology: 0,
                                    amount: 50,
                                    threshold: -27,
                                    ratio: 3,
                                    makeup: 5,
                                    mix: 0.63,
                                },
                            },
                            {
                                id: 'b',
                                name: 'Gluten B',
                                type: 'gluten',
                                bypassed: false,
                                parameterValues: { threshold: -43, ratio: 6 },
                            },
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
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
    });

    it('undoes and redoes Gentle Glue as one edit on the still-mounted panel', async () => {
        render(<GlutenPanel deviceId="a" />);
        const deviceState = { version: 1, data: { sentinel: 'Keep this' } };
        await act(() =>
            executeUserAppAction({ type: 'setDeviceState', payload: { deviceId: 'a', state: deviceState } })
        );
        await selectTier('shape');
        const deviceStateWithDisclosure = { version: 1, data: { ...deviceState.data, disclosureTier: 'shape' } };
        await act(() => executeUserAppAction({ type: 'renameTrack', payload: { trackId: 'track', name: 'Drums' } }));
        const before = structuredClone(rawTrack());
        const beforeParameters = before.devices[0]!.parameterValues;
        expect(before.name).toBe('Drums');
        expect(before.devices[0]?.deviceState).toEqual(deviceStateWithDisclosure);
        const threshold = screen.getByRole('slider', { name: 'Threshold' });
        const ratio = screen.getByRole('slider', { name: 'Ratio' });
        const attack = screen.getByRole('slider', { name: 'Attack' });
        const knee = screen.getByRole('slider', { name: 'Knee' });
        expect(threshold).toHaveAttribute('aria-valuenow', '-27');
        expect(ratio).toHaveAttribute('aria-valuenow', '3');
        expect(attack).toHaveAttribute('aria-valuenow', '10');
        expect(knee).toHaveAttribute('aria-valuenow', '6');
        const preset = selectPresetRow('Gentle Glue');

        await waitFor(() => expectPatchName('Gentle Glue'));
        const after = structuredClone(rawTrack());
        expect(after.devices[0]!.parameterValues).toEqual(GENTLE_GLUE_PARAMETERS);
        expect(after.devices[0]?.deviceState).toEqual(deviceStateWithDisclosure);
        expect(after.devices[1]).toEqual(before.devices[1]);
        expect(threshold).toHaveAttribute('aria-valuenow', '-12');
        expect(ratio).toHaveAttribute('aria-valuenow', '2');
        expect(attack).toHaveAttribute('aria-valuenow', '30');
        expect(knee).toHaveAttribute('aria-valuenow', '10');
        expect(preset).toHaveFocus();
        expectRuntimePreset(GENTLE_GLUE_PARAMETERS);
        expect(undoHistoryStore.value?.past).toMatchObject([
            { action: { type: 'renameTrack' } },
            {
                label: 'Load Gentle Glue',
                action: { type: 'setGlutenFactoryPreset', payload: { presetId: 'glue-gentle' } },
            },
        ]);
        flushAutomergeStorageWrites();
        stampSessionUndoWitness();
        expect(sessionStorage.getItem(SESSION_KEY)).toContain('setGlutenFactoryPreset');
        registerHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(2);

        await act(() => undo());
        expect(rawTrack()).toEqual(before);
        expect(trackStore.value?.tracks[0]?.devices).toEqual(before.devices);
        expect(threshold).toHaveAttribute('aria-valuenow', '-27');
        expect(ratio).toHaveAttribute('aria-valuenow', '3');
        expect(attack).toHaveAttribute('aria-valuenow', '10');
        expect(knee).toHaveAttribute('aria-valuenow', '6');
        expectPatchName('Init');
        expect(preset).toHaveFocus();
        expectRuntimePreset({ ...INIT_PARAMETERS, ...beforeParameters });
        flushAutomergeStorageWrites();
        stampSessionUndoWitness();
        registerHandlers();
        expect(undoHistoryStore.value?.future).toHaveLength(1);

        await act(() => redo());
        expect(rawTrack()).toEqual(after);
        expect(trackStore.value?.tracks[0]?.devices).toEqual(after.devices);
        expect(threshold).toHaveAttribute('aria-valuenow', '-12');
        expect(ratio).toHaveAttribute('aria-valuenow', '2');
        expect(attack).toHaveAttribute('aria-valuenow', '30');
        expect(knee).toHaveAttribute('aria-valuenow', '10');
        expectPatchName('Gentle Glue');
        expect(preset).toHaveFocus();
        expectRuntimePreset(GENTLE_GLUE_PARAMETERS);
    });

    it('marks an equal explicit Bus Glue pick without changing project history', async () => {
        const project = trackStore.value!;
        const track = project.tracks[0]!;
        const devices = [{ ...track.devices[0]!, parameterValues: INIT_PARAMETERS }, ...track.devices.slice(1)];
        trackStore.set({ ...project, tracks: [{ ...track, devices }] });
        flushAutomergeStorageWrites();
        const before = structuredClone(rawTrack());
        render(<GlutenPanel deviceId="a" />);
        expectPatchName('Init');
        const preset = selectPresetRow('Bus Glue');
        await waitFor(() => expectPatchName('Bus Glue'));
        expect(rawTrack()).toEqual(before);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(preset).toHaveFocus();
        expectRuntimePreset(INIT_PARAMETERS);
    });

    it('refuses a frozen owner before project, history, or runtime changes', async () => {
        const project = trackStore.value!;
        trackStore.set({ ...project, tracks: [{ ...project.tracks[0]!, frozen: true }] });
        flushAutomergeStorageWrites();
        const before = structuredClone(rawTrack());
        render(<GlutenPanel deviceId="a" />);
        await act(async () => {
            selectPresetRow('Gentle Glue');
        });
        expect(rawTrack()).toEqual(before);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expectPatchName('Init');
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('refuses a queued load if the same-valued owner is replaced before admission', async () => {
        const original = rawTrack().devices[0]!;
        const replacement = structuredClone(original);
        const snapshotEntered = Promise.withResolvers<object>();
        const releaseSnapshot = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            snapshotEntered.resolve(transaction);
            await releaseSnapshot.promise;
        });
        const snapshotTransaction = await snapshotEntered.promise;
        const selection = selectGlutenFactoryPreset('a', 'glue-gentle');
        try {
            mutateCrdtDoc<Root>({
                id: 'root',
                snapshotTransaction,
                changeFn: (document) => {
                    document.tracks.tracks[0]!.devices.splice(0, 1, replacement);
                },
            });
        } finally {
            releaseSnapshot.resolve();
        }
        await snapshot;
        await selection;
        const current = rawTrack().devices[0]!;
        expect(current).toEqual(replacement);
        expect(getObjectId(current)).not.toBe(getObjectId(original));
        expect(trackStore.value?.tracks[0]?.devices[0]).toEqual(replacement);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not send a committed preset to a device replaced before runtime delivery', async () => {
        const original = rawTrack().devices[0]!;
        let published = false;
        const unsubscribe = undoHistoryStore.subscribe((history) => {
            const entry = history?.past.at(-1);
            if (published || entry?.kind !== 'action' || entry.action.type !== 'setGlutenFactoryPreset') {
                return;
            }
            published = true;
            const replacement = structuredClone(rawTrack().devices[0]!);
            expect(replacement.parameterValues).toEqual(GENTLE_GLUE_PARAMETERS);
            mutateCrdtDoc<Root>({
                id: 'root',
                changeFn: (document) => {
                    document.tracks.tracks[0]!.devices.splice(0, 1, replacement);
                },
            });
        });
        try {
            await selectGlutenFactoryPreset('a', 'glue-gentle');
        } finally {
            unsubscribe();
        }
        expect(published).toBe(true);
        const current = rawTrack().devices[0]!;
        expect(current.parameterValues).toEqual(GENTLE_GLUE_PARAMETERS);
        expect(getObjectId(current)).not.toBe(getObjectId(original));
        expect(updateDeviceParam).not.toHaveBeenCalled();
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
