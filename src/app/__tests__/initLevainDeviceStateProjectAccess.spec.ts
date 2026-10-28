import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { batchStoreUpdates } from '#/infra/store/createStore';
import { sanitizeTrackSnapshot } from '#/modules/Arrangement/stores';
import { createCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { initLevainDeviceStateProjectAccess } from '../initLevainDeviceStateProjectAccess';

import type { configureLevainDeviceStateProjectAccess } from '#/modules/Levain/useCases';

type ProjectAccess = NonNullable<Parameters<typeof configureLevainDeviceStateProjectAccess>[0]>;
const registration = vi.hoisted(() => ({
    configure: vi.fn<(next: ProjectAccess | null) => void>(),
    subscribe: vi.fn<(listener: (docId?: string) => void) => void>(),
}));
vi.mock('#/modules/Levain/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Levain/useCases')>()),
    configureLevainDeviceStateProjectAccess: registration.configure,
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...original,
        subscribeToCrdtChanges: (listener: (docId?: string) => void) => {
            registration.subscribe(listener);
            return original.subscribeToCrdtChanges(listener);
        },
    };
});

function access(): ProjectAccess {
    const provider = registration.configure.mock.calls.at(-1)?.[0];
    if (!provider) {
        throw new Error('Expected registered Levain project access');
    }
    return provider;
}

function publish(owner = 'owner', type = 'levain'): void {
    const snapshot = sanitizeTrackSnapshot({
        tracks: [
            {
                id: owner,
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'a',
                        name: 'Instrument',
                        type,
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            },
        ],
    });
    mutateCrdtDoc({
        id: 'root',
        changeFn: (document) => {
            document.tracks = JSON.parse(JSON.stringify(snapshot));
        },
    });
}

let unsubscribe: (() => void) | undefined;
beforeEach(() => {
    registration.configure.mockClear();
    registration.subscribe.mockClear();
    createCrdtDoc('root');
    initLevainDeviceStateProjectAccess();
});
afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    removeCrdtDoc('root');
    removeCrdtDoc('unrelated-levain-test');
});

it('binds fresh committed owner/device/type reads without retaining the initial project', () => {
    expect(access().hasDevice('owner', 'a')).toBe(false);
    publish();
    expect(access().hasDevice('owner', 'a')).toBe(true);
    expect(access().hasDevice('owner', 'other')).toBe(false);
    publish('other-owner');
    expect(access().hasDevice('owner', 'a')).toBe(false);
    publish('owner', 'crust');
    expect(access().hasDevice('owner', 'a')).toBe(false);
    publish();
    expect(access().hasDevice('owner', 'a')).toBe(true);
    removeCrdtDoc('root');
    expect(access().hasDevice('owner', 'a')).toBe(false);
});

it('observes every root commit synchronously through projection batching, filters other docs and disposes', () => {
    publish();
    expect(registration.subscribe).not.toHaveBeenCalled();
    const observed: boolean[] = [];
    unsubscribe = access().subscribe(() => observed.push(access().hasDevice('owner', 'a')));
    createCrdtDoc('unrelated-levain-test');
    mutateCrdtDoc({
        id: 'unrelated-levain-test',
        changeFn: (document) => {
            document.test = true;
        },
    });
    expect(observed).toEqual([]);
    batchStoreUpdates(() => {
        publish('other-owner');
        expect(observed).toEqual([false]);
        publish();
        expect(observed).toEqual([false, true]);
    });
    const listener = registration.subscribe.mock.calls[0]?.[0];
    if (!listener) {
        throw new Error('Expected registered root-change listener');
    }
    listener(undefined);
    expect(observed).toEqual([false, true, true]);
    unsubscribe();
    publish('other-owner');
    expect(observed).toEqual([false, true, true]);
});
