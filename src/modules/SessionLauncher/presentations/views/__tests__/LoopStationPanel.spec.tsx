import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Button } from '#/components/ui/button';
import { TooltipProvider } from '#/components/ui/tooltip';
import { playheadPositionRef } from '#/modules/Transport/stores';
import { cn } from '#/utils/Styles/cn';

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

// Wrap (not replace) the real Button/cn so the rest of the suite keeps
// exercising real rendering, while the F10 regression test below can assert
// call counts to prove a per-frame tick no longer re-invokes the cell body.
vi.mock('#/components/ui/button', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/components/ui/button')>();
    return { ...actual, Button: vi.fn(actual.Button) };
});
vi.mock('#/utils/Styles/cn', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/utils/Styles/cn')>();
    return { cn: vi.fn(actual.cn) };
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
        // the whole cell body (its five Buttons, its cn() calls) once per
        // frame, for every occupied cell, active or not. The fix isolates
        // the ticking readout into its own leaf (`LoopSlotProgressReadout`)
        // that writes straight to its own DOM node. This test drives real
        // rAF ticks with a genuinely changing playhead value (confirmed via
        // the progress text itself) and asserts the cell body's Button/cn
        // calls do not grow — the discriminating signal a flat call count
        // against the *unmodified* component could not have shown, since
        // those spies were never wired to the changing prop in the first
        // place.
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

        it('does not re-invoke the occupied cell body on a genuinely ticking playhead', () => {
            mocks.trackState.tracks = [{ id: 't1', name: 'Drums', color: null }];
            mocks.loopState.slots = [
                {
                    id: 'slot-1',
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
            ];
            playheadPositionRef.current = 0;

            renderPanel();

            const progressNode = screen.getByTestId('loop-slot-progress');
            const initialProgressText = progressNode.textContent;
            const callsAtMount = vi.mocked(Button).mock.calls.length;
            const cnCallsAtMount = vi.mocked(cn).mock.calls.length;

            // Drive several real ticks with a genuinely changing value —
            // this is the part the earlier (refuted) probe skipped, which
            // is why it could not tell a fixed grid from a broken one.
            for (let i = 1; i <= 5; i += 1) {
                playheadPositionRef.current = i * 0.5;
                tick();
            }

            expect(progressNode.textContent).not.toBe(initialProgressText);
            expect(vi.mocked(Button).mock.calls.length).toBe(callsAtMount);
            expect(vi.mocked(cn).mock.calls.length).toBe(cnCallsAtMount);
        });
    });
});
