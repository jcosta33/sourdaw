import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { beginMappingAmountDrag } from '../beginMappingAmountDrag';
import { endMappingAmountDrag } from '../endMappingAmountDrag';
import { isMappingAmountDragActive } from '../isMappingAmountDragActive';
import { mappingAmountDragState } from '../mappingAmountDragState';
import { paintMappingAmountDrag } from '../paintMappingAmountDrag';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => void) => void>(),
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

const TARGET_A = { targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'cutoff' };
const TARGET_B = { targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'resonance' };

function seedStore(amountA: number, amountB: number): void {
    modulationStore.set({
        modulators: [
            {
                id: 'mod-1',
                name: 'LFO 1',
                trackId: 'track-1',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                mappings: [
                    { ...TARGET_A, amount: amountA },
                    { ...TARGET_B, amount: amountB },
                ],
                enabled: true,
            },
        ],
    });
}

function currentAmount(target: { targetParamId: string }): number | undefined {
    return modulationStore.value?.modulators[0]?.mappings.find((m) => m.targetParamId === target.targetParamId)?.amount;
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
        seedStore(0.2, 0.4);
        mocks.pushUndoEntry.mockReset();
    });

    afterEach(() => {
        mappingAmountDragState.activeSessions.clear();
        vi.unstubAllGlobals();
        modulationStore.set({ modulators: [] });
        mocks.pushUndoEntry.mockReset();
    });

    it('coalesces many paints within one frame into a single store write', () => {
        const animationFrame = stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        beginMappingAmountDrag('mod-1', TARGET_A);
        paintMappingAmountDrag('mod-1', TARGET_A, 0.4);
        paintMappingAmountDrag('mod-1', TARGET_A, 0.6);
        paintMappingAmountDrag('mod-1', TARGET_A, 0.8);

        expect(isMappingAmountDragActive('mod-1', TARGET_A)).toBe(true);
        expect(animationFrame.requestAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(setSpy).not.toHaveBeenCalled();
        expect(currentAmount(TARGET_A)).toBe(0.2);

        animationFrame.flushFrame();

        expect(setSpy).toHaveBeenCalledTimes(1);
        expect(currentAmount(TARGET_A)).toBe(0.8);
        setSpy.mockRestore();
    });

    it('writes once per frame across a multi-frame drag', () => {
        const animationFrame = stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        beginMappingAmountDrag('mod-1', TARGET_A);
        paintMappingAmountDrag('mod-1', TARGET_A, 0.4);
        animationFrame.flushFrame();
        paintMappingAmountDrag('mod-1', TARGET_A, 0.6);
        animationFrame.flushFrame();

        expect(setSpy).toHaveBeenCalledTimes(2);
        expect(currentAmount(TARGET_A)).toBe(0.6);
        setSpy.mockRestore();
    });

    it('keeps two mappings’ gestures isolated: one ends without touching the other', () => {
        stubAnimationFrame();
        beginMappingAmountDrag('mod-1', TARGET_A);
        beginMappingAmountDrag('mod-1', TARGET_B);

        // Both sessions are live at once, each with its own restore point.
        expect(isMappingAmountDragActive('mod-1', TARGET_A)).toBe(true);
        expect(isMappingAmountDragActive('mod-1', TARGET_B)).toBe(true);

        paintMappingAmountDrag('mod-1', TARGET_A, 0.9);
        paintMappingAmountDrag('mod-1', TARGET_B, -0.5);

        endMappingAmountDrag('mod-1', TARGET_A);

        expect(currentAmount(TARGET_A)).toBe(0.9);
        expect(currentAmount(TARGET_B)).toBe(0.4);
        expect(isMappingAmountDragActive('mod-1', TARGET_A)).toBe(false);
        // B’s gesture survives A’s end and still commits its own amount.
        expect(isMappingAmountDragActive('mod-1', TARGET_B)).toBe(true);

        endMappingAmountDrag('mod-1', TARGET_B);
        expect(currentAmount(TARGET_B)).toBe(-0.5);

        // Two independent undo entries, one per gesture.
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(2);
    });

    it('ends the gesture with one undo entry whose undo and redo restore the gesture bounds', () => {
        const animationFrame = stubAnimationFrame();
        beginMappingAmountDrag('mod-1', TARGET_A);
        paintMappingAmountDrag('mod-1', TARGET_A, 0.9);

        endMappingAmountDrag('mod-1', TARGET_A);

        expect(animationFrame.cancelAnimationFrameMock).toHaveBeenCalledWith(101);
        expect(isMappingAmountDragActive('mod-1', TARGET_A)).toBe(false);
        expect(currentAmount(TARGET_A)).toBe(0.9);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);

        const [label, undo, redo] = mocks.pushUndoEntry.mock.calls[0]!;
        expect(label).toBe('Adjust modulation amount');

        undo();
        expect(currentAmount(TARGET_A)).toBe(0.2);

        redo();
        expect(currentAmount(TARGET_A)).toBe(0.9);
    });

    it('registers no undo entry for a click that never changed the amount', () => {
        stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        beginMappingAmountDrag('mod-1', TARGET_A);
        endMappingAmountDrag('mod-1', TARGET_A);

        expect(setSpy).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        setSpy.mockRestore();
    });

    it('closes a stranded gesture with its undo entry when the same mapping begins again', () => {
        const animationFrame = stubAnimationFrame();
        beginMappingAmountDrag('mod-1', TARGET_A);
        paintMappingAmountDrag('mod-1', TARGET_A, 0.5);
        animationFrame.flushFrame();

        beginMappingAmountDrag('mod-1', TARGET_A);

        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        expect(isMappingAmountDragActive('mod-1', TARGET_A)).toBe(true);

        endMappingAmountDrag('mod-1', TARGET_A);
    });

    it('ignores paints with no active session and begins nothing for an unknown mapping', () => {
        stubAnimationFrame();
        const setSpy = vi.spyOn(modulationStore, 'set');

        paintMappingAmountDrag('mod-1', TARGET_A, 0.9);
        expect(setSpy).not.toHaveBeenCalled();

        beginMappingAmountDrag('mod-1', { ...TARGET_A, targetParamId: 'missing' });
        expect(isMappingAmountDragActive('mod-1', TARGET_A)).toBe(false);
        setSpy.mockRestore();
    });
});
