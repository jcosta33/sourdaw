import { change, from, type Doc } from '@automerge/automerge';
import { act, render, waitFor } from '@testing-library/react';
import { type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores/handlerRegistry';
import { undoStore } from '#/modules/Command/stores/undoStore';
import { undo } from '#/modules/Command/useCases/undo';

import { useYeastParamActions, type YeastParamActions } from '../useYeastParamActions';
import { setActiveYeastDevice, yeastStore, type YeastState } from '../../../stores/yeastStore';

const runtimeMocks = vi.hoisted(() => ({
    applyProjection: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../engine/yeastRuntime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/yeastRuntime')>()),
    applyYeastRuntimeProjection: runtimeMocks.applyProjection,
    getYeastRuntimeStatus: vi.fn(() => 'ready'),
    getYeastRuntimeError: vi.fn(() => undefined),
}));

type RootDocument = { yeast?: unknown };

const DEVICE_ID = 'device-hook';

function Harness({ onReady }: { onReady: (actions: YeastParamActions) => void }): ReactElement {
    const actions = useYeastParamActions();
    onReady(actions);
    return null;
}

/** Lets the chained settle dispatches (and the undo entries they record) land. */
async function flushDispatches(entryCount = 0): Promise<void> {
    await waitFor(() => {
        expect(undoStore.value?.past.length ?? 0).toBeGreaterThanOrEqual(entryCount);
    });
}

describe('useYeastParamActions knob settle coalescing (#2111)', () => {
    let document: Doc<RootDocument>;
    let actions: YeastParamActions | null = null;

    beforeEach(() => {
        undoStore.set({ past: [], future: [] });
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        yeastStore.hydrate();
        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params: { gate: 0.8 } }],
            uiLevel: 3,
        });
        runtimeMocks.applyProjection.mockResolvedValue(undefined);

        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
    });

    afterEach(async () => {
        await flushDispatches();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
        actions = null;
    });

    it('coalesces two settles inside the window into one undo group that one undo reverts', async () => {
        render(<Harness onReady={(captured) => (actions = captured)} />);

        // A drag (transient samples, then its settle), then a NEW gesture — a
        // keyboard tweak with no drag open — arriving within the coalescing
        // window. The tweak coalesces into the drag's undo group.
        act(() => {
            actions!.setParam('arp-1', 'gate', 1.0, true);
            actions!.setParam('arp-1', 'gate', 1.0);
            actions!.setParam('arp-1', 'gate', 1.2);
        });
        await flushDispatches(2);

        const past = undoStore.value?.past ?? [];
        expect(past).toHaveLength(2);
        expect(new Set(past.map((entry) => entry.groupId)).size).toBe(1);
        expect(yeastStore.value?.processors[0]?.params?.gate).toBe(1.2);

        const result = await undo();
        expect(result.headConsumed).toBe(true);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(yeastStore.value?.processors[0]?.params?.gate).toBe(0.8);
    });

    it('carries the expected guard read at commit time, not from a stale prop', async () => {
        render(<Harness onReady={(captured) => (actions = captured)} />);

        act(() => {
            actions!.setParam('arp-1', 'gate', 1.0);
        });
        await flushDispatches();

        const entry = undoStore.value?.past[0];
        expect(entry?.kind).toBe('action');
        if (entry?.kind === 'action') {
            expect(entry.action.payload).toMatchObject({ processorId: 'arp-1', paramId: 'gate', value: 1.0, expectedValue: 0.8 });
        }
    });

    it('keeps the knob drawing the thumb value mid-gesture and drops it once the write lands', async () => {
        render(<Harness onReady={(captured) => (actions = captured)} />);

        // Transient sample: the display overlay moves while truth does not.
        act(() => {
            actions!.setParam('arp-1', 'gate', 1.3, true);
        });
        expect(actions!.displayValue('arp-1', 'gate', 0.8)).toBe(1.3);
        expect(yeastStore.value?.processors[0]?.params?.gate).toBe(0.8);

        // Settle: the overlay holds until the dispatch lands, then yields.
        act(() => {
            actions!.setParam('arp-1', 'gate', 1.2);
        });
        await waitFor(() => {
            expect(yeastStore.value?.processors[0]?.params?.gate).toBe(1.2);
        });
        expect(actions!.displayValue('arp-1', 'gate', 1.2)).toBe(1.2);
    });
});
