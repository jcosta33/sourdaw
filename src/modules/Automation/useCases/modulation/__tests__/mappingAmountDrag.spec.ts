import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { beginMappingAmountDrag } from '../beginMappingAmountDrag';
import { endMappingAmountDrag } from '../endMappingAmountDrag';
import { flushPendingMappingAmountDrag } from '../flushPendingMappingAmountDrag';
import { isMappingAmountDragActive } from '../isMappingAmountDragActive';
import { mappingAmountDragState } from '../mappingAmountDragState';
import { paintMappingAmountDrag } from '../paintMappingAmountDrag';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => void) => void>(),
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

const TARGET = { targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'cutoff' };

function seedStore(amount: number): void {
    modulationStore.set({
        modulators: [
            {
                id: 'mod-1',
                name: 'LFO 1',
                trackId: 'track-1',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                mappings: [{ ...TARGET, amount }],
                enabled: true,
            },
        ],
    });
}

function currentAmount(): number | undefined {
    return modulationStore.value?.modulators.find((m) => m.id === 'mod-1')?.mappings[0]?.amount;
}

function stubAnimationFrame() {
    let pendingCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback): number => {
        pendingCallback = callback;
        return 101;
    });
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    return {
        requestAnimationFrameMock,
        cancelAnimationFrameMock,
        flushFrame: () => {
            if (pendingCallback === null) {
                throw new Error('No animation frame is pending.');
            }
            const callback = pendingCallback;
            pendingCallback = null;
            callback(0);
        },
    };
}

describe('mappingAmountDrag', () => {
    beforeEach(() => {
        seedStore(0.2);
        mocks.pushUndoEntry.mockReset();
    });

    afterEach(() => {
        mappingAmountDragState.activeSession = null;
        vi.unstubAllGlobals();
        modulationStore.set({ modulators: [] });
        mocks.pushUndoEntry.mockReset();
    });

    it('coalesces many paints within one frame into a single store write', () => {
        const animationFrame = stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        beginMappingAmountDrag('mod-1', TARGET);
        paintMappingAmountDrag(0.4);
        paintMappingAmountDrag(0.6);
        paintMappingAmountDrag(0.8);

        expect(isMappingAmountDragActive()).toBe(true);
        expect(animationFrame.requestAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(setSpy).not.toHaveBeenCalled();
        expect(currentAmount()).toBe(0.2);

        animationFrame.flushFrame();

        expect(setSpy).toHaveBeenCalledTimes(1);
        expect(currentAmount()).toBe(0.8);
        setSpy.mockRestore();
    });

    it('writes once per frame across a multi-frame drag', () => {
        const animationFrame = stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        beginMappingAmountDrag('mod-1', TARGET);
        paintMappingAmountDrag(0.4);
        animationFrame.flushFrame();
        paintMappingAmountDrag(0.6);
        animationFrame.flushFrame();

        expect(setSpy).toHaveBeenCalledTimes(2);
        expect(currentAmount()).toBe(0.6);
        setSpy.mockRestore();
    });

    it('ends the gesture with one undo entry whose undo and redo restore the gesture bounds', () => {
        const animationFrame = stubAnimationFrame();
        beginMappingAmountDrag('mod-1', TARGET);
        paintMappingAmountDrag(0.9);

        endMappingAmountDrag();

        expect(animationFrame.cancelAnimationFrameMock).toHaveBeenCalledWith(101);
        expect(isMappingAmountDragActive()).toBe(false);
        expect(currentAmount()).toBe(0.9);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);

        const [label, undo, redo] = mocks.pushUndoEntry.mock.calls[0]!;
        expect(label).toBe('Adjust modulation amount');

        undo();
        expect(currentAmount()).toBe(0.2);

        redo();
        expect(currentAmount()).toBe(0.9);
    });

    it('registers no undo entry for a click that never changed the amount', () => {
        stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        beginMappingAmountDrag('mod-1', TARGET);
        endMappingAmountDrag();

        expect(setSpy).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        setSpy.mockRestore();
    });

    it('closes a stranded gesture with its undo entry when a new drag begins', () => {
        stubAnimationFrame();
        beginMappingAmountDrag('mod-1', TARGET);
        paintMappingAmountDrag(0.5);
        flushPendingMappingAmountDrag();

        beginMappingAmountDrag('mod-1', TARGET);

        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        expect(isMappingAmountDragActive()).toBe(true);

        endMappingAmountDrag();
    });

    it('ignores paints with no active session and begins nothing for an unknown mapping', () => {
        stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        paintMappingAmountDrag(0.9);
        expect(setSpy).not.toHaveBeenCalled();

        beginMappingAmountDrag('mod-1', { ...TARGET, targetParamId: 'missing' });
        expect(isMappingAmountDragActive()).toBe(false);
        setSpy.mockRestore();
    });
});
