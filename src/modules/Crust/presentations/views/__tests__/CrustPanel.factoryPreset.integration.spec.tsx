import { getObjectId } from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
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

import { crustMeterStore, crustStore } from '../../../stores/crustStore';
import { selectCrustFactoryPreset } from '../../../useCases/selectCrustFactoryPreset';
import { CrustPanel } from '../CrustPanel';

const updateDeviceParam = vi.hoisted(() =>
    vi.fn<(trackId: string, deviceId: string, key: string, value: number) => void>()
);
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam,
}));

// Style must precede algorithm because the engine derives an algorithm from style.
const PUNCHY = {
    gain: 2,
    ceiling: -0.3,
    style: 0,
    algorithm: 1,
    lookahead: 2,
    attack: 0,
    release: 0,
    attackAuto: 1,
    releaseAuto: 1,
    channelLinkTransient: 80,
    channelLinkRelease: 100,
    truePeak: 1,
    oversampling: 4,
    satEnabled: 0,
    satAlgorithm: 0,
    satDrive: 0,
    satMix: 0,
    deltaListen: 0,
    unityGain: 0,
    multiBand: 0,
    crossover1: 80,
    crossover2: 2000,
    scHpfEnabled: 0,
    scHpfFreq: 60,
    stereoMode: 0,
    dither: 0,
    outputBitDepth: 24,
};
const BEFORE_RUNTIME = {
    ...PUNCHY,
    gain: 7,
    ceiling: -1.5,
    style: 2,
    algorithm: 4,
    channelLinkTransient: 100,
    truePeak: 0,
    satAlgorithm: 3,
};
const PROJECT = 'crust-factory-preset-view';
type Root = { tracks: { tracks: Track[] } };
function rawTrack(): Track {
    const track = getCrdtDoc<Root>('root')?.tracks.tracks[0];
    if (!track) {
        throw new Error('Expected the Crust track');
    }
    return track;
}
function expectEngine(values: Record<string, number>): void {
    expect(updateDeviceParam.mock.calls).toEqual(
        Object.entries(values).map(([key, value]) => ['track', 'a', key, value])
    );
    updateDeviceParam.mockClear();
}
function openPreset(): HTMLElement {
    const trigger = within(screen.getByRole('group', { name: 'Preset selector' })).getByRole('button', {
        expanded: false,
    });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Crust presets' })).toBeVisible();
    return trigger;
}
async function queueSelection(change: (transaction: object) => void): Promise<void> {
    const entered = Promise.withResolvers<object>();
    const release = Promise.withResolvers<void>();
    const snapshot = transactSnapshot(async (transaction) => {
        entered.resolve(transaction);
        await release.promise;
    });
    const transaction = await entered.promise;
    const selection = selectCrustFactoryPreset('a', 'punchy-bus');
    try {
        change(transaction);
    } finally {
        release.resolve();
    }
    await snapshot;
    trackStore.hydrate();
    await selection;
}

describe('Crust factory preset history on the mounted panel', () => {
    beforeEach(async () => {
        updateDeviceParam.mockReset();
        clearUndoHistory();
        sessionStorage.removeItem('sourdaw-undo-session');
        configureAutomergeStoragePort(null);
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => {} });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        resetCrdtProjectAuthority(PROJECT);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        reconcileSessionUndoForProject({ projectId: PROJECT, captureWitness: captureDurableDocumentWitness });
        crustStore.set({});
        crustMeterStore.set({});
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Master',
                        kind: 'audio',
                        devices: [
                            {
                                id: 'a',
                                name: 'Crust A',
                                type: 'crust',
                                bypassed: false,
                                parameterValues: {
                                    gain: 7,
                                    ceiling: -1.5,
                                    style: 2,
                                    algorithm: 4,
                                    truePeak: 0,
                                    satAlgorithm: 3,
                                },
                                deviceState: { version: 1, data: { disclosureTier: 'shape', sentinel: 'keep' } },
                            },
                            { id: 'b', name: 'Crust B', type: 'crust', bypassed: false, parameterValues: { gain: 9 } },
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
        crustStore.set({});
        crustMeterStore.set({});
        clearUndoHistory();
        sessionStorage.removeItem('sourdaw-undo-session');
    });
    it('loads Punchy Bus as one replayable edit while retaining focus, tier, and sparse project state', async () => {
        render(<CrustPanel deviceId="a" />);
        await act(() => executeUserAppAction({ type: 'renameTrack', payload: { trackId: 'track', name: 'Drums' } }));
        const before = structuredClone(rawTrack());
        expect(before.devices[0]!.parameterValues).not.toHaveProperty('attackAuto');
        const tier = screen.getByRole('group', { name: 'Effect control detail' });
        expect(within(tier).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true');
        const ceiling = screen.getByRole('spinbutton', { name: 'Output ceiling in dBTP' });
        expect(ceiling).toHaveValue(-1.5);
        const trigger = openPreset();
        expect(trigger).toHaveTextContent('Init');
        const option = screen.getByRole('option', { name: /Punchy Bus/ });
        option.focus();
        fireEvent.keyDown(option, { key: 'Escape' });
        expect(trigger).toHaveFocus();
        expect(screen.queryByRole('listbox', { name: 'Crust presets' })).not.toBeInTheDocument();
        openPreset();
        fireEvent.click(screen.getByRole('option', { name: /Punchy Bus/ }));
        await waitFor(() => expect(undoHistoryStore.value?.past).toHaveLength(2));
        const after = structuredClone(rawTrack());
        expect(ceiling).toHaveValue(-0.3);
        expect(trigger).toHaveTextContent('Punchy Bus');
        expect(after.devices[0]!.parameterValues).toEqual(PUNCHY);
        expect(after.devices[0]!.deviceState).toEqual(before.devices[0]!.deviceState);
        expect(after.devices[1]).toEqual(before.devices[1]);
        expect(trackStore.value?.tracks[0]).toEqual(after);
        expect(within(tier).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true');
        expect(undoHistoryStore.value?.past).toMatchObject([
            { action: { type: 'renameTrack' } },
            {
                label: 'Load Punchy Bus',
                action: { type: 'setCrustFactoryPreset', payload: { presetId: 'punchy-bus' } },
            },
        ]);
        expectEngine(PUNCHY);
        await act(() => undo());
        expect(rawTrack()).toEqual(before);
        expect(trackStore.value?.tracks[0]).toEqual(before);
        expect(ceiling).toHaveValue(-1.5);
        expect(trigger).toHaveTextContent('Init');
        expect(Object.hasOwn(rawTrack().devices[0]!.parameterValues, 'attackAuto')).toBe(false);
        expect(Object.hasOwn(trackStore.value!.tracks[0]!.devices[0]!.parameterValues, 'attackAuto')).toBe(false);
        expectEngine(BEFORE_RUNTIME);
        await act(() => redo());
        expect(rawTrack()).toEqual(after);
        expect(trackStore.value?.tracks[0]).toEqual(after);
        expect(ceiling).toHaveValue(-0.3);
        expect(trigger).toHaveTextContent('Punchy Bus');
        expect(within(tier).getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true');
        expectEngine(PUNCHY);
        await act(() => undo());
        await act(() => undo());
        expect(rawTrack().name).toBe('Master');
    });
    it('refuses a queued preset when a peer changes a captured parameter', async () => {
        const before = structuredClone(rawTrack());
        await queueSelection((transaction) =>
            mutateCrdtDoc<Root>({
                id: 'root',
                snapshotTransaction: transaction,
                changeFn: (doc) => {
                    doc.tracks.tracks[0]!.devices[0]!.parameterValues.gain = 11;
                },
            })
        );
        const expected = structuredClone(before);
        expected.devices[0]!.parameterValues.gain = 11;
        expect(rawTrack()).toEqual(expected);
        expect(trackStore.value?.tracks[0]).toEqual(expected);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
    it('refuses a queued preset when its same-valued device is replaced', async () => {
        const original = rawTrack().devices[0]!;
        const originalId = getObjectId(original);
        const replacement = structuredClone(original);
        await queueSelection((transaction) =>
            mutateCrdtDoc<Root>({
                id: 'root',
                snapshotTransaction: transaction,
                changeFn: (doc) => {
                    doc.tracks.tracks[0]!.devices.splice(0, 1, replacement);
                },
            })
        );
        expect(rawTrack().devices[0]).toEqual(replacement);
        expect(getObjectId(rawTrack().devices[0]!)).not.toBe(originalId);
        expect(trackStore.value?.tracks[0]?.devices[0]).toEqual(replacement);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
    it('keeps the preset history and runtime untouched when Undo addresses a same-valued replacement', async () => {
        await selectCrustFactoryPreset('a', 'punchy-bus');
        expectEngine(PUNCHY);
        const original = rawTrack().devices[0]!;
        const originalId = getObjectId(original);
        const replacement = structuredClone(original);
        const history = structuredClone(undoHistoryStore.value);
        expect(history?.past).toHaveLength(1);

        await transactSnapshot((snapshotTransaction) => {
            mutateCrdtDoc<Root>({
                id: 'root',
                snapshotTransaction,
                changeFn: (doc) => {
                    doc.tracks.tracks[0]!.devices.splice(0, 1, replacement);
                },
            });
            return Promise.resolve();
        });
        expect(getObjectId(rawTrack().devices[0]!)).not.toBe(originalId);
        expect((await undo()).headConsumed).toBe(false);
        expect(rawTrack().devices[0]).toEqual(replacement);
        expect(trackStore.value?.tracks[0]?.devices[0]).toEqual(replacement);
        expect(undoHistoryStore.value).toEqual(history);
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
});
