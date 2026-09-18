import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { type GrooveTemplateState } from '#/modules/MIDI/stores';

import { decodeArpPatternParams } from '../../../models/ArpPattern';
import { type YeastState } from '../../../stores/yeastStore';
import { YeastPanel } from '../YeastPanel';

const storeMock = vi.hoisted(
    (): {
        yeastState: YeastState | null;
        grooveState: GrooveTemplateState | null;
        setYeastState: ReturnType<typeof vi.fn>;
    } => ({
        yeastState: null,
        grooveState: null,
        setYeastState: vi.fn(),
    })
);
const runtimeMocks = vi.hoisted(() => ({
    applyProjection: vi.fn((_projection: readonly { id: string }[]): Promise<void> => Promise.resolve()),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: YeastState | GrooveTemplateState | TrackStoreState) => {
        if ('templates' in defaultValue) {
            return storeMock.grooveState ?? defaultValue;
        }
        if ('tracks' in defaultValue) {
            return defaultValue;
        }
        return storeMock.yeastState ?? defaultValue;
    }),
}));

vi.mock('../../../useCases/getYeastGrooveAssignment', () => ({
    getYeastGrooveAssignment: () => undefined,
    YEAST_GROOVE_OWNER_ID: 'yeast-rack',
}));

vi.mock('../../../useCases/proposeYeastGrooveExtraction', () => ({
    proposeYeastGrooveExtraction: vi.fn(),
}));

vi.mock('../../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return storeMock.yeastState;
        },
        set: storeMock.setYeastState,
    },
    setActiveYeastDevice: vi.fn(),
    readAllYeastRacks: () => [storeMock.yeastState ?? { processors: [], uiLevel: 1 }],
}));

vi.mock('../../../engine/yeastRuntime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/yeastRuntime')>()),
    applyYeastRuntimeProjection: runtimeMocks.applyProjection,
    getYeastRuntimeStatus: vi.fn(() => 'ready'),
    getYeastRuntimeError: vi.fn(() => undefined),
}));

/**
 * The step-velocity stroke's undo contract: every cell a stroke crosses
 * dispatches once, and the stroke's dispatches coalesce into ONE undo group
 * (#2111). Dropping `coalesceWithPrevious` in the deck's commit reds the group
 * assertion; dropping the stroke's own dispatch count reds it too.
 */
describe('YeastPanel arp stroke undo coalescing (#2111)', () => {
    beforeEach(() => {
        undoHistoryStore.set({ past: [], future: [] });
        storeMock.yeastState = {
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Lead arp lane', bypassed: false, params: {} }],
            uiLevel: 3,
        };
        storeMock.setYeastState.mockImplementation((state: YeastState | null) => {
            storeMock.yeastState = state;
        });
        runtimeMocks.applyProjection.mockResolvedValue(undefined);

        // jsdom gives every element a zero-height box, which the velocity
        // paint correctly refuses (NaN guard) — give the cells real geometry.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            height: 100,
            top: 0,
            width: 28,
            left: 0,
            right: 28,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearHandlerRegistry();
    });

    it('coalesces a paint stroke across cells into one undo group', async () => {
        render(<YeastPanel />);

        // Press on step 1, drag across step 2, release. clientY 80 against a
        // 100px cell paints velocity 25 at both cells.
        act(() => {
            fireEvent.pointerDown(screen.getByRole('button', { name: 'Step 1' }), { pointerId: 1, clientY: 80 });
            fireEvent.pointerEnter(screen.getByRole('button', { name: 'Step 2' }), { pointerId: 1, clientY: 80 });
            fireEvent.pointerUp(screen.getByRole('button', { name: 'Step 2' }), { pointerId: 1 });
        });

        await waitFor(() => {
            expect(undoHistoryStore.value?.past.length).toBe(2);
        });

        const past = undoHistoryStore.value?.past ?? [];
        expect(new Set(past.map((entry) => entry.groupId)).size).toBe(1);
        for (const entry of past) {
            if (entry.kind !== 'action') {
                throw new Error('Expected every stroke entry to be an action entry');
            }
            expect(entry.label).toBe('Set arp pattern');
            expect(entry.inverseAction).not.toBeNull();
        }

        // One undo reverts the whole stroke.
        const { undo } = await import('#/modules/Command/useCases');
        const result = await undo();
        expect(result.headConsumed).toBe(true);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        const restored = decodeArpPatternParams(storeMock.yeastState?.processors[0]?.params);
        expect(restored[0]?.velocity).toBe(100);
        expect(restored[1]?.velocity).toBe(100);
    });

    it('keeps each discrete cell edit its own undo unit', async () => {
        render(<YeastPanel />);

        // A context-menu toggle is a discrete edit — no stroke, no coalescing.
        act(() => {
            fireEvent.contextMenu(screen.getByRole('button', { name: 'Step 3' }), { preventDefault: vi.fn() });
        });

        await waitFor(() => {
            expect(undoHistoryStore.value?.past.length).toBe(1);
        });
        expect(undoHistoryStore.value?.past[0]?.groupId).toBeUndefined();
    });
});
