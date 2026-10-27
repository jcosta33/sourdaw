import { beforeEach, expect, it, vi } from 'vitest';

import { coordinateLevainDeviceState } from '../coordinateLevainDeviceState';

import type { executeAppAction } from '#/modules/Command/useCases';
import type { toLevainDeviceState } from '../../models/LevainDeviceState';

type DeviceState = ReturnType<typeof toLevainDeviceState>;
const mocks = vi.hoisted(() => ({
    execute: vi.fn<typeof executeAppAction>(),
    projectIdentity: 'project-a',
    trackStore: {
        value: {
            tracks: [
                {
                    id: 'owner',
                    devices: [{ id: 'a', type: 'levain', deviceState: undefined as DeviceState | undefined }],
                },
            ],
        },
    },
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/CrdtDocument/stores', () => ({ captureProjectIdentity: () => mocks.projectIdentity }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.execute, executeUserAppAction: mocks.execute }));

function deferred() {
    let complete!: () => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
        complete = resolve;
        fail = reject;
    });
    return { promise, resolve: complete, reject: fail };
}

function initialState(): DeviceState {
    return { version: 1, data: { instrumentId: 'cello', currentArticulation: 'pizzicato' } };
}

function expert(prior: DeviceState | undefined): DeviceState {
    return { version: 1, data: { ...prior?.data, disclosureTier: 'expert' } };
}

function commit(index: number): void {
    const call = mocks.execute.mock.calls[index];
    if (!call || call[0].type !== 'setDeviceState') {
        throw new Error('Expected a device-state action');
    }
    expect(call[1]?.shouldExecute?.()).toBe(true);
    mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState = call[0].payload.state;
    call[1]?.onCommitted?.();
}

beforeEach(() => {
    mocks.execute.mockReset();
    mocks.projectIdentity = 'project-a';
    mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState = initialState();
});

it('creates an idle action immediately, then creates the next facet only after its own commit settles', async () => {
    const first = deferred();
    const second = deferred();
    mocks.execute.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const identity = coordinateLevainDeviceState('a', 'identity', (prior) => ({
        version: 1,
        data: { ...prior?.data, instrumentId: 'horn', currentArticulation: 'sustain' },
    }));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const tier = coordinateLevainDeviceState('a', 'tier', expert);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    commit(0);
    first.resolve();
    await identity;
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[1]?.[0]).toMatchObject({
        payload: {
            state: {
                data: {
                    instrumentId: 'horn',
                    currentArticulation: 'sustain',
                    disclosureTier: 'expert',
                },
            },
        },
    });
    commit(1);
    second.resolve();
    await tier;
});

it('refuses peer bytes arriving after its own commit while completion is held', async () => {
    const first = deferred();
    mocks.execute.mockReturnValueOnce(first.promise);
    const identity = coordinateLevainDeviceState('a', 'identity', (prior) => ({
        version: 1,
        data: { ...prior?.data, instrumentId: 'horn', currentArticulation: 'sustain' },
    }));
    const stale = vi.fn();
    const tier = coordinateLevainDeviceState('a', 'tier', expert, stale);
    commit(0);
    const peer = { version: 1, data: { ...initialState().data, foreign: 'newer' } };
    mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState = peer;
    first.resolve();
    await Promise.all([identity, tier]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(stale).toHaveBeenCalledOnce();
    expect(mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState).toEqual(peer);
});

it('cleans a rejected chain so a new explicit request can proceed without retrying retained work', async () => {
    const first = deferred();
    mocks.execute.mockReturnValueOnce(first.promise);
    const identity = coordinateLevainDeviceState('a', 'identity', expert);
    const tier = coordinateLevainDeviceState('a', 'tier', expert);
    const error = new Error('Command failed');
    first.reject(error);
    const results = await Promise.allSettled([identity, tier]);
    expect(results).toEqual([
        { status: 'rejected', reason: error },
        { status: 'rejected', reason: error },
    ]);
    const next = deferred();
    mocks.execute.mockReturnValueOnce(next.promise);
    const fresh = coordinateLevainDeviceState('a', 'tier', expert);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    commit(1);
    next.resolve();
    await fresh;
});

it('keeps a successor project tail when the outgoing project request cleans up', async () => {
    const outgoing = deferred();
    const incoming = deferred();
    const last = deferred();
    mocks.execute
        .mockReturnValueOnce(outgoing.promise)
        .mockReturnValueOnce(incoming.promise)
        .mockReturnValueOnce(last.promise);
    const oldRequest = coordinateLevainDeviceState('a', 'tier', expert);
    mocks.projectIdentity = 'project-b';
    const newRequest = coordinateLevainDeviceState('a', 'tier', expert);
    expect(mocks.execute.mock.calls[0]?.[1]?.shouldExecute?.()).toBe(false);
    outgoing.resolve();
    await oldRequest;
    const latest = coordinateLevainDeviceState('a', 'identity', (prior) => ({
        version: 1,
        data: { ...prior?.data, instrumentId: 'horn', currentArticulation: 'sustain' },
    }));
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    commit(1);
    incoming.resolve();
    await newRequest;
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    commit(2);
    last.resolve();
    await latest;
});
