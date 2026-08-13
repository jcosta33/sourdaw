import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { formatLoopProgress } from '../../helpers/loopStationProgress';
import { LoopStationPanel } from '../LoopStationPanel';

type LoopSlotMock = {
    id: string;
    trackId: string;
    row: number;
    column: number;
    state: 'empty' | 'recording' | 'playing' | 'overdubbing' | 'stopped';
    lengthBeats: number;
    layers: Array<{ id: string; layerIndex: number; recordedAt: string; muted: boolean; volume: number }>;
    loopCount: number;
    volume: number;
    quantize: boolean;
    fadeBeats: number;
};

const mocks = vi.hoisted(() => ({
    loopState: {
        slots: [] as LoopSlotMock[],
        sceneCount: 2,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    },
    trackState: { tracks: [] as Array<{ id: string; name: string; color: string | null }> },
    transportState: { playheadPosition: 0, timeSignatureNumerator: 4 },
    toggleRecord: vi.fn(),
    stopAllSlots: vi.fn(),
    toggleArm: vi.fn(),
    toggleSync: vi.fn(),
    setFixedLoopLength: vi.fn(),
    createSlot: vi.fn(),
    triggerScene: vi.fn(),
    triggerSlot: vi.fn(),
    stopSlot: vi.fn(),
    undoLastLayer: vi.fn(),
    clearSlot: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: { __id?: string }, defaultValue: unknown) => {
        if (store.__id === 'loop') {
            return mocks.loopState;
        }
        if (store.__id === 'track') {
            return mocks.trackState;
        }
        if (store.__id === 'transport') {
            return mocks.transportState;
        }
        return defaultValue;
    },
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: { __id: 'loop' },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { __id: 'transport' },
    playheadPositionRef: { current: 0 },
}));

// Wrap (not replace) the real formatLoopProgress so the rest of the suite
// keeps exercising real rendering while the F10 regression test below can
// assert call counts. This is the one function that actually consumes the
// ticking playhead value — Button/cn call counts cannot discriminate this
// defect, because neither call site ever depended on the ticking value with
// or without the fix (the React Compiler memoizes them either way).
vi.mock('../../helpers/loopStationProgress', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../helpers/loopStationProgress')>();
    return { ...actual, formatLoopProgress: vi.fn(actual.formatLoopProgress) };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { __id: 'track' },
    defaultTrackState: { tracks: [], selectedTrackId: null },
}));

vi.mock('../../../useCases/loopStation/clearSlot', () => ({ clearSlot: mocks.clearSlot }));
vi.mock('../../../useCases/loopStation/createSlot', () => ({ createSlot: mocks.createSlot }));
vi.mock('../../../useCases/loopStation/setFixedLoopLength', () => ({
    setFixedLoopLength: mocks.setFixedLoopLength,
}));
vi.mock('../../../useCases/loopStation/stopAllSlots', () => ({ stopAllSlots: mocks.stopAllSlots }));
vi.mock('../../../useCases/loopStation/stopSlot', () => ({ stopSlot: mocks.stopSlot }));
vi.mock('../../../useCases/loopStation/toggleArm', () => ({ toggleArm: mocks.toggleArm }));
vi.mock('../../../useCases/loopStation/toggleRecord', () => ({ toggleRecord: mocks.toggleRecord }));
vi.mock('../../../useCases/loopStation/toggleSync', () => ({ toggleSync: mocks.toggleSync }));
vi.mock('../../../useCases/loopStation/triggerScene', () => ({ triggerScene: mocks.triggerScene }));
vi.mock('../../../useCases/loopStation/triggerSlot', () => ({ triggerSlot: mocks.triggerSlot }));
vi.mock('../../../useCases/loopStation/undoLastLayer', () => ({ undoLastLayer: mocks.undoLastLayer }));
vi.mock('#/modules/Transport/useCases', () => ({
    defaultTransportState: { playheadPosition: 0, timeSignatureNumerator: 4 },
}));

const renderPanel = () =>
    render(
        <TooltipProvider>
            <LoopStationPanel />
        </TooltipProvider>
    );

describe('LoopStationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loopState = {
            slots: [],
            sceneCount: 2,
            activeScene: 0,
            armed: false,
            syncToTransport: true,
            fixedLoopLength: 0,
        };
        mocks.trackState = { tracks: [] };
        mocks.transportState = { playheadPosition: 0, timeSignatureNumerator: 4 };
    });

    it('should render without crashing', () => {
        const { container } = renderPanel();
        expect(container.firstChild).not.toBeNull();
    });

    it('should expose a region role', () => {
        renderPanel();
        expect(screen.getByRole('region', { name: /loop station/i })).toBeInTheDocument();
    });

    it('should show empty state when there are no tracks', () => {
        renderPanel();
        expect(screen.getByText('No tracks to loop')).toBeInTheDocument();
    });

    it('should render a grid when tracks exist', () => {
        mocks.trackState.tracks = [
            { id: 't1', name: 'Drums', color: '#ff0000' },
            { id: 't2', name: 'Bass', color: '#00ff00' },
        ];
        renderPanel();
        expect(screen.getByRole('grid', { name: /loop slots/i })).toBeInTheDocument();
        expect(screen.getByText('Drums')).toBeInTheDocument();
        expect(screen.getByText('Bass')).toBeInTheDocument();
    });

    it('should trigger toggleRecord when the record button on a slot is clicked', () => {
        mocks.trackState.tracks = [{ id: 't1', name: 'Drums', color: null }];
        mocks.loopState.slots = [
            {
                id: 'slot-1',
                trackId: 't1',
                row: 0,
                column: 0,
                state: 'empty',
                lengthBeats: 0,
                layers: [],
                loopCount: 0,
                volume: 1,
                quantize: true,
                fadeBeats: 0,
            },
        ];
        renderPanel();
        const recButton = screen.getByRole('button', { name: /record or overdub slot 1/i });
        fireEvent.click(recButton);
        expect(mocks.toggleRecord).toHaveBeenCalledWith('slot-1');
    });

    it('plays only the clicked slot, leaving the other columns alone', () => {
        mocks.trackState.tracks = [{ id: 't1', name: 'Drums', color: null }];
        mocks.loopState.slots = [
            {
                id: 'slot-1',
                trackId: 't1',
                row: 0,
                column: 0,
                state: 'stopped',
                lengthBeats: 4,
                layers: [{ id: 'layer-1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                loopCount: 0,
                volume: 1,
                quantize: true,
                fadeBeats: 0,
            },
        ];
        renderPanel();

        fireEvent.click(screen.getByRole('button', { name: /play slot 1/i }));

        expect(mocks.triggerSlot).toHaveBeenCalledWith('slot-1');
        expect(mocks.triggerScene).not.toHaveBeenCalled();
    });

    it('should clear all slots via stop-all', () => {
        mocks.trackState.tracks = [{ id: 't1', name: 'Drums', color: null }];
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /stop all loops/i }));
        expect(mocks.stopAllSlots).toHaveBeenCalled();
    });

    it('should announce the sync indicator with aria-live', () => {
        mocks.trackState.tracks = [{ id: 't1', name: 'Drums', color: null }];
        renderPanel();
        const syncLabel = screen.getByText(/Bar\s1\.1|Free/i);
        expect(syncLabel).toHaveAttribute('aria-live', 'polite');
    });

    describe('per-frame ticking isolation (F10)', () => {
        // Regression: LoopStationSlotCell used to receive the ticking
        // playhead position as a prop (`positionBeats`), which made every
        // occupied cell's element depend on a value that changes every
        // animation frame — invalidating that reactive scope and re-invoking
        // the whole cell body once per frame, for every occupied cell,
        // active or not. `formatLoopProgress` is the one function that
        // actually consumes the ticking value: pre-fix it fires once per
        // occupied cell per frame regardless of that cell's own state;
        // post-fix it fires once per *active* slot per frame (via the
        // isolated leaf's own rAF effect), plus once per cell on a discrete
        // playhead change. A grid with several occupied slots and exactly
        // one active one tells these apart — Button/cn call counts cannot,
        // because neither call site ever depended on the ticking value
        // either way.
        let rafCallbacks: FrameRequestCallback[];

        beforeEach(() => {
            rafCallbacks = [];
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
                rafCallbacks.push(cb);
                return rafCallbacks.length;
            });
            vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        const tick = (): void => {
            const pending = rafCallbacks;
            rafCallbacks = [];
            act(() => {
                for (const cb of pending) {
                    cb(performance.now());
                }
            });
        };

        it('bounds formatLoopProgress growth to the active slot count, not the occupied cell count', () => {
            mocks.trackState.tracks = [{ id: 't1', name: 'Drums', color: null }];
            mocks.loopState.slots = [
                {
                    id: 'slot-active',
                    trackId: 't1',
                    row: 0,
                    column: 0,
                    state: 'playing',
                    lengthBeats: 4,
                    layers: [{ id: 'layer-1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0,
                },
                {
                    id: 'slot-stopped',
                    trackId: 't1',
                    row: 1,
                    column: 0,
                    state: 'stopped',
                    lengthBeats: 4,
                    layers: [{ id: 'layer-2', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0,
                },
                {
                    id: 'slot-empty',
                    trackId: 't1',
                    row: 2,
                    column: 0,
                    state: 'empty',
                    lengthBeats: 0,
                    layers: [],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0,
                },
            ];
            playheadPositionRef.current = 0;

            renderPanel();

            // Three occupied cells (rows 0-2), one of them ('slot-active')
            // actually playing. Any remaining rows up to the grid's minimum
            // of 8 are unoccupied "create slot" cells that never call
            // formatLoopProgress at all.
            const progressNodes = screen.getAllByTestId('loop-slot-progress');
            expect(progressNodes).toHaveLength(3);
            const [activeProgress, stoppedProgress, emptyProgress] = progressNodes;
            const activeTextAtMount = activeProgress!.textContent;
            const stoppedTextAtMount = stoppedProgress!.textContent;
            const emptyTextAtMount = emptyProgress!.textContent;
            const callsAtMount = vi.mocked(formatLoopProgress).mock.calls.length;

            const frameCount = 5;
            for (let i = 1; i <= frameCount; i += 1) {
                playheadPositionRef.current = i * 0.5;
                tick();
            }

            const callsAfterTicks = vi.mocked(formatLoopProgress).mock.calls.length;

            // Only the active slot's isolated readout re-invokes
            // formatLoopProgress on each of the 5 ticks (its own rAF loop).
            // Pre-fix, every occupied cell re-rendered on every tick, so
            // this delta would be 3 * frameCount (15), not frameCount (5).
            expect(callsAfterTicks - callsAtMount).toBe(frameCount);

            // Functional correctness: the active cell's displayed text
            // actually changed; the two inactive occupied cells' did not,
            // since nothing discrete (start/stop/seek) happened between
            // ticks.
            expect(activeProgress!.textContent).not.toBe(activeTextAtMount);
            expect(stoppedProgress!.textContent).toBe(stoppedTextAtMount);
            expect(emptyProgress!.textContent).toBe(emptyTextAtMount);
        });
    });
});
