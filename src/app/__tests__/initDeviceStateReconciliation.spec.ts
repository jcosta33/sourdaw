import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    subscribe: vi.fn((_listener: (docId?: string) => void) => vi.fn()),
    toasterSweep: vi.fn(),
    levainSweep: vi.fn(),
    crumbsSweep: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    DOC_PREFIX_ROOT: 'root',
    subscribeToCrdtChanges: mocks.subscribe,
}));
// The seam is document glue and nothing else: three owner sweeps it runs in
// registration order and a document filter it owns.
vi.mock('#/modules/Toaster/useCases', () => ({ reconcileToasterKitsFromProject: mocks.toasterSweep }));
vi.mock('#/modules/Levain/useCases', () => ({ reconcileLevainDeviceStatesFromProject: mocks.levainSweep }));
vi.mock('#/modules/Crumbs/useCases', () => ({ reconcileCrumbsDeviceStatesFromProject: mocks.crumbsSweep }));

import { initDeviceStateReconciliation } from '../initDeviceStateReconciliation';

/** The sweep runs one microtask after the notification, coalesced. */
function flushSweep(): Promise<void> {
    return Promise.resolve();
}

function documentOriginListener(): (docId?: string) => void {
    const listener = mocks.subscribe.mock.calls.at(-1)?.[0];
    if (listener === undefined) {
        throw new Error('subscription was not registered');
    }
    return listener;
}

describe('initDeviceStateReconciliation', () => {
    let stop: (() => void) | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        stop = initDeviceStateReconciliation();
    });

    afterEach(() => {
        stop?.();
    });

    it('runs every owner sweep on a root-document change', async () => {
        documentOriginListener()('root');
        await flushSweep();

        expect(mocks.toasterSweep).toHaveBeenCalledTimes(1);
        expect(mocks.levainSweep).toHaveBeenCalledTimes(1);
        expect(mocks.crumbsSweep).toHaveBeenCalledTimes(1);
    });

    it('runs the sweeps on a bulk change that names no document', async () => {
        documentOriginListener()(undefined);
        await flushSweep();

        expect(mocks.toasterSweep).toHaveBeenCalledTimes(1);
        expect(mocks.crumbsSweep).toHaveBeenCalledTimes(1);
    });

    it('ignores a change to a document that backs no project store', async () => {
        documentOriginListener()('branch_snapshot_1');
        await flushSweep();

        expect(mocks.toasterSweep).not.toHaveBeenCalled();
        expect(mocks.levainSweep).not.toHaveBeenCalled();
        expect(mocks.crumbsSweep).not.toHaveBeenCalled();
    });

    it('coalesces a burst of notifications into one sweep', async () => {
        const listener = documentOriginListener();

        listener('root');
        listener('root');
        listener(undefined);
        await flushSweep();

        expect(mocks.toasterSweep).toHaveBeenCalledTimes(1);
        expect(mocks.crumbsSweep).toHaveBeenCalledTimes(1);
    });

    it('stops sweeping after the subscription is released', async () => {
        const listener = documentOriginListener();
        stop?.();
        stop = undefined;

        listener('root');
        await flushSweep();

        expect(mocks.toasterSweep).not.toHaveBeenCalled();
        expect(mocks.crumbsSweep).not.toHaveBeenCalled();
    });
});
