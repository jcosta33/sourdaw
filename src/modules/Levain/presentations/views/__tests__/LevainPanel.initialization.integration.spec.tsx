import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initLevainDeviceStateProjectAccess } from '#/app/initLevainDeviceStateProjectAccess';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
    sanitizeTrackSnapshot,
    trackStore,
} from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { levainStore } from '../../../stores/levainStore';
import { configureLevainDeviceStateProjectAccess } from '../../../useCases/configureLevainDeviceStateProjectAccess';
import { levainBridge } from '../../../useCases/levainParamBridge/levainBridge';
import { registerLevainDevice } from '../../../useCases/levainParamBridge/registerLevainDevice';
import { reconcileLevainDeviceStateFromProject } from '../../../useCases/reconcileLevainDeviceStateFromProject';
import { LevainPanel } from '../LevainPanel';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

const deviceId = 'levain-init';
const saved = {
    version: 1,
    data: { instrumentId: 'cello', currentArticulation: 'pizzicato', disclosureTier: 'basic' },
};
let channel: MessageChannel;

function projectState() {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks[0]?.devices[0]?.deviceState;
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Levain initialization integration');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    agentProjectRepairStateStore.set(null);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    initLevainDeviceStateProjectAccess();
    const tracks = sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Cello',
                kind: 'midi',
                devices: [
                    {
                        id: deviceId,
                        name: 'Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: saved,
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
    trackStore.set({ ...defaultTrackState, tracks });
    flushAutomergeStorageWrites();
    levainStore.set({});
    channel = new MessageChannel();
    injectDependencies(levainBridge, {
        persistDeviceParam,
        resolveEligibleDeviceWriteTarget,
        autoLoadLevainSamples: vi.fn(() => Promise.resolve(null)),
        setLoadedMicPositions: vi.fn(),
        writeNativeBuiltinParameters: vi.fn(),
        sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
    });
});

afterEach(() => {
    configureLevainDeviceStateProjectAccess(null);
    trackStore.set({ ...defaultTrackState, tracks: [] });
    flushAutomergeStorageWrites();
    levainStore.set({});
    removeCrdtDoc('root');
    configureAutomergeStoragePort(null);
    channel.port1.close();
    channel.port2.close();
});

it('admits layout choices only after registration, even while the engine is loading', async () => {
    render(<LevainPanel deviceId={deviceId} />);
    const group = screen.getByRole('group', { name: 'Levain control detail' });
    const basic = within(group).getByRole('button', { name: 'Basic' });
    const expert = within(group).getByRole('button', { name: 'Expert' });
    expect(basic).toBeDisabled();
    expect(expert).toBeDisabled();
    expert.click();
    expect(projectState()).toEqual(saved);

    await act(async () => {
        await registerLevainDevice(deviceId, { setParam: vi.fn(), handleCc: vi.fn() }, channel.port1);
    });
    expect(levainStore.value?.[deviceId]?.engineReady).toBe(false);
    expect(basic).toBeEnabled();
    expect(expert).toBeEnabled();
    await act(async () => {
        expert.click();
    });
    await waitFor(() => expect(projectState()?.data.disclosureTier).toBe('expert'));
    expect(projectState()?.data).toMatchObject({ instrumentId: 'cello', currentArticulation: 'pizzicato' });
    act(() => reconcileLevainDeviceStateFromProject(deviceId));
    expect(expert).toHaveAttribute('aria-pressed', 'true');
    expect(levainStore.value?.[deviceId]?.patch).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'pizzicato',
    });
});
