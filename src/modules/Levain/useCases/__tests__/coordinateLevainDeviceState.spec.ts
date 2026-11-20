import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { configureLevainDeviceStateProjectAccess } from '../configureLevainDeviceStateProjectAccess';
import { coordinateLevainDeviceState } from '../coordinateLevainDeviceState';

import type { executeUserAppAction } from '#/modules/Command/useCases';
import type { toLevainDeviceState } from '../../models/LevainDeviceState';

type DeviceState = ReturnType<typeof toLevainDeviceState>;
const mocks = vi.hoisted(() => ({
    execute: vi.fn<typeof executeUserAppAction>(),
    projectIdentity: 'project-a',
    committed: true,
    projectListeners: new Set<() => void>(),
    trackListeners: new Set<() => void>(),
    trackStore: {
        subscribe: (listener: () => void) => {
            mocks.trackListeners.add(listener);
            return () => mocks.trackListeners.delete(listener);
        },
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
vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: mocks.execute }));

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
    mocks.committed = true;
    configureLevainDeviceStateProjectAccess({
        hasDevice: () => mocks.committed,
        subscribe: (listener) => {
            mocks.projectListeners.add(listener);
            return () => mocks.projectListeners.delete(listener);
        },
    });
});

afterEach(() => {
    expect(mocks.projectListeners.size).toBe(0);
    expect(mocks.trackListeners.size).toBe(0);
    configureLevainDeviceStateProjectAccess(null);
});

it('creates an idle tier action immediately and waits for its settled commit before the next choice', async () => {
    const first = deferred();
    const second = deferred();
    mocks.execute.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstTier = coordinateLevainDeviceState('a', (prior) => ({
        version: 1,
        data: { ...prior?.data, disclosureTier: 'basic' },
    }));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    commit(0);
    const tier = coordinateLevainDeviceState('a', expert);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    first.resolve();
    await firstTier;
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[1]?.[0]).toMatchObject({
        payload: {
            state: {
                data: {
                    instrumentId: 'cello',
                    currentArticulation: 'pizzicato',
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
    const firstTier = coordinateLevainDeviceState('a', (prior) => ({
        version: 1,
        data: { ...prior?.data, disclosureTier: 'basic' },
    }));
    commit(0);
    const stale = vi.fn();
    const tier = coordinateLevainDeviceState('a', expert, stale);
    const peer = { version: 1, data: { ...initialState().data, foreign: 'newer' } };
    mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState = peer;
    first.resolve();
    await Promise.all([firstTier, tier]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(stale).toHaveBeenCalledOnce();
    expect(mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState).toEqual(peer);
});

it('cleans a rejected chain so a new explicit request can proceed without retrying retained work', async () => {
    const first = deferred();
    mocks.execute.mockReturnValueOnce(first.promise);
    const firstTier = coordinateLevainDeviceState('a', expert);
    const tier = coordinateLevainDeviceState('a', expert);
    const error = new Error('Command failed');
    first.reject(error);
    const results = await Promise.allSettled([firstTier, tier]);
    expect(results).toEqual([
        { status: 'rejected', reason: error },
        { status: 'rejected', reason: error },
    ]);
    const next = deferred();
    mocks.execute.mockReturnValueOnce(next.promise);
    const fresh = coordinateLevainDeviceState('a', expert);
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
    const oldRequest = coordinateLevainDeviceState('a', expert);
    mocks.projectIdentity = 'project-b';
    const newRequest = coordinateLevainDeviceState('a', expert);
    expect(mocks.execute.mock.calls[0]?.[1]?.shouldExecute?.()).toBe(false);
    outgoing.resolve();
    await oldRequest;
    commit(1);
    const latest = coordinateLevainDeviceState('a', (prior) => ({
        version: 1,
        data: { ...prior?.data, disclosureTier: 'basic' },
    }));
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    incoming.resolve();
    await newRequest;
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    commit(2);
    last.resolve();
    await latest;
});

it('rejects a write explicitly when committed project access has not been bound', async () => {
    configureLevainDeviceStateProjectAccess(null);
    await expect(coordinateLevainDeviceState('a', expert)).rejects.toThrow(
        'Levain device-state project access is not configured'
    );
    expect(mocks.execute).not.toHaveBeenCalled();
});

it('retires a held tier entry and its queued choice without removing a fresh queue', async () => {
    const held = deferred();
    const fresh = deferred();
    const last = deferred();
    mocks.execute
        .mockReturnValueOnce(held.promise)
        .mockReturnValueOnce(fresh.promise)
        .mockReturnValueOnce(last.promise);
    const first = coordinateLevainDeviceState('a', expert);
    commit(0);
    const oldFactory = vi.fn(expert);
    const oldSecond = coordinateLevainDeviceState('a', oldFactory);
    mocks.committed = false;
    for (const listener of [...mocks.projectListeners]) {
        listener();
    }
    expect(mocks.projectListeners.size).toBe(0);
    expect(mocks.trackListeners.size).toBe(0);
    mocks.committed = true;
    expect(mocks.execute.mock.calls[0]?.[1]?.shouldExecute?.()).toBe(false);
    const newFirst = coordinateLevainDeviceState('a', expert);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    held.resolve();
    await Promise.all([first, oldSecond]);
    expect(oldFactory).not.toHaveBeenCalled();
    commit(1);
    const newSecond = coordinateLevainDeviceState('a', expert);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    fresh.resolve();
    await newFirst;
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    commit(2);
    last.resolve();
    await newSecond;
});

it('does not adopt a request whose never-committed visible target was lost', async () => {
    mocks.committed = false;
    const held = deferred();
    mocks.execute.mockReturnValueOnce(held.promise);
    const request = coordinateLevainDeviceState('a', expert);
    const devices = mocks.trackStore.value.tracks[0]!.devices;
    mocks.trackStore.value.tracks[0]!.devices = [];
    for (const listener of [...mocks.trackListeners]) {
        listener();
    }
    mocks.trackStore.value.tracks[0]!.devices = devices;
    mocks.committed = true;
    expect(mocks.execute.mock.calls[0]?.[1]?.shouldExecute?.()).toBe(false);
    held.resolve();
    await request;
});

it('fences a replacement project-access provider without reviving an old submitted action', async () => {
    const held = deferred();
    mocks.execute.mockReturnValueOnce(held.promise);
    const request = coordinateLevainDeviceState('a', expert);
    configureLevainDeviceStateProjectAccess({ hasDevice: () => true, subscribe: () => () => undefined });
    expect(mocks.execute.mock.calls[0]?.[1]?.shouldExecute?.()).toBe(false);
    held.resolve();
    await request;
});
