import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores/handlerRegistry';
import { executeAppAction } from '#/modules/Command/useCases';
import { getCommandHandler } from '#/modules/Command/useCases/getCommandHandler';
import { undo } from '#/modules/Command/useCases/undo';
import { undoStore } from '#/modules/Command/stores/undoStore';
import { setActiveYeastDevice, yeastStore, type YeastState } from '../../stores/yeastStore';

type RootDocument = { yeast?: unknown };

// The knobs' undo contract, end to end: N coalesced settles land as ONE undo
// group, one undo() call reverts the whole gesture atomically through the
// handlers' guarded inverses, and every member resolves to a handler flagged
// `canReportConflict` so the step-over contract (#2881) holds for the group.

const DEVICE_ID = 'device-coalesce';

function arpProcessor(gate: number): YeastState['processors'][number] {
    return { id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params: { gate } };
}

async function dispatchGate(value: number, coalesceWithPrevious: boolean): Promise<void> {
    await executeAppAction(
        { type: 'setYeastProcessorParam', payload: { processorId: 'arp-1', paramId: 'gate', value } },
        coalesceWithPrevious ? { coalesceWithPrevious: true } : undefined
    );
}

describe('Yeast knob gesture undo coalescing (#2111)', () => {
    let document: Doc<RootDocument>;

    beforeEach(() => {
        // The undo stack is a session-wide singleton; a previous test's
        // entries would coalesce into (or wedge) this test's gesture.
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
        yeastStore.set({ processors: [arpProcessor(0.8)], uiLevel: 3 });

        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
    });

    it('lands N coalesced knob settles as one undo group', async () => {
        await dispatchGate(1.0, false);
        await dispatchGate(1.2, true);
        await dispatchGate(1.4, true);

        const past = undoStore.value?.past ?? [];
        expect(past).toHaveLength(3);
        const groupIds = new Set(past.map((entry) => entry.groupId));
        expect(groupIds.size).toBe(1);
        expect([...groupIds][0]).toBeDefined();
        // The gesture is one takeCandidate unit: the whole group shares it.
        expect(yeastStore.value?.processors[0]?.params?.gate).toBe(1.4);
    });

    it('reverts the whole gesture atomically with one undo', async () => {
        await dispatchGate(1.0, false);
        await dispatchGate(1.2, true);
        await dispatchGate(1.4, true);

        const result = await undo();

        expect(result.headConsumed).toBe(true);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(yeastStore.value?.processors[0]?.params?.gate).toBe(0.8);
    });

    it('keeps unrelated settles in separate undo groups', async () => {
        await dispatchGate(1.0, false);
        await dispatchGate(1.2, false);

        const past = undoStore.value?.past ?? [];
        expect(past).toHaveLength(2);
        expect(past[0]?.groupId).toBeUndefined();
        expect(past[1]?.groupId).toBeUndefined();
    });

    it('resolves every group member to a conflict-capable inverse handler', async () => {
        await dispatchGate(1.0, false);
        await dispatchGate(1.2, true);

        const members = undoStore.value?.past ?? [];
        expect(members).toHaveLength(2);
        for (const entry of members) {
            expect(entry.inverseAction).not.toBeNull();
            expect(getCommandHandler(entry.inverseAction!)?.canReportConflict).toBe(true);
        }
    });
});
