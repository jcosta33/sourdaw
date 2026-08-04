import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTempoEditorState } from '../useTempoEditorState';

import type { TransportState } from '#/modules/Transport/stores';

// ── Store mocks ──────────────────────────────────────────────────────────
// `mockTransportStore`/`mockTempoMapStore` are plain identity markers — the
// real stores are Automerge-backed and heavy to construct, so we replace
// `useStore` outright and branch on which store object was passed in.
const { mockTransportStore, mockTempoMapStore } = vi.hoisted(() => ({
    mockTransportStore: { name: 'transportStore' },
    mockTempoMapStore: { name: 'tempoMapStore' },
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mockTransportStore,
    tempoMapStore: mockTempoMapStore,
}));

const baseTransportState: TransportState = {
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    overdubEnabled: false,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tempo: 120,
    timeSignatureNumerator: 3,
    timeSignatureDenominator: 8,
    playheadPosition: 0,
    loopStart: 0,
    loopEnd: 0,
    scheduleGrainMs: 10,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    countInEnabled: false,
    countInBars: 1,
    preRollEnabled: false,
    preRollBars: 2,
    masterGain: 80,
};

let mockTransportState: TransportState = baseTransportState;
let mockTempoMapState: { changes: Array<{ id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }> } = {
    changes: [],
};

const mockUseStore = vi.fn((store: unknown, _defaultState?: unknown) => {
    if (store === mockTransportStore) {
        return mockTransportState;
    }
    if (store === mockTempoMapStore) {
        return mockTempoMapState;
    }
    throw new Error('useTempoEditorState.spec: unexpected store passed to useStore');
});
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

const mockExecuteAppAction = vi.fn();
const mockAddTempoChange = vi.fn();
const mockRemoveTempoChange = vi.fn();
const mockUpdateTempoChange = vi.fn();

type TempoFieldState = {
    tempo: number;
    governedByMap: boolean;
    editable: boolean;
    lockReason: 'tempo-ramp' | 'playback' | null;
    minTempo: number;
    maxTempo: number;
};
// The tempo matches neither the base tempo nor any fixture map tempo, so
// `tempoField.tempo` can only be right by routing through the resolver.
const RESOLVED_TEMPO_SENTINEL = 77;
const editableFieldState: TempoFieldState = {
    tempo: RESOLVED_TEMPO_SENTINEL,
    governedByMap: true,
    editable: true,
    lockReason: null,
    minTempo: 20,
    maxTempo: 999,
};
let mockTempoFieldState: TempoFieldState = editableFieldState;
const mockResolveTempoFieldState = vi.fn((): TempoFieldState => mockTempoFieldState);
vi.mock('#/modules/Transport/useCases', () => ({
    addTempoChange: (...args: unknown[]): void => {
        mockAddTempoChange(...args);
    },
    removeTempoChange: (...args: unknown[]): void => {
        mockRemoveTempoChange(...args);
    },
    updateTempoChange: (...args: unknown[]): void => {
        mockUpdateTempoChange(...args);
    },
    resolveTempoFieldState: (...args: unknown[]): TempoFieldState => {
        return mockResolveTempoFieldState(...(args as []));
    },
    // useTransportState reads this as the `useStore` default; our `useStore`
    // mock ignores it and always resolves via store identity, but the real
    // module shape must still be present for the import to resolve.
    defaultTransportState: {},
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (action: unknown): void => {
        mockExecuteAppAction(action);
    },
}));

describe('useTempoEditorState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTransportState = baseTransportState;
        mockTempoMapState = { changes: [] };
        mockTempoFieldState = editableFieldState;
    });

    describe('tempo field state', () => {
        it('resolves the readout from the tempo map at the playhead when a change sits at beat 0', () => {
            mockTempoMapState = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
            mockTransportState = { ...baseTransportState, tempo: 120, playheadPosition: 6, isPlaying: true };

            const { result } = renderHook(() => useTempoEditorState());

            expect(mockResolveTempoFieldState).toHaveBeenCalledWith({
                changes: mockTempoMapState.changes,
                beat: 6,
                defaultTempo: 120,
                isPlaying: true,
            });
            expect(result.current.tempoField.tempo).toBe(RESOLVED_TEMPO_SENTINEL);
            expect(result.current.tempoField.governedByMap).toBe(true);
        });

        it('passes the empty map through so the resolver can report the base tempo', () => {
            mockTempoMapState = { changes: [] };
            mockTransportState = { ...baseTransportState, tempo: 120, playheadPosition: 0 };

            renderHook(() => useTempoEditorState());

            expect(mockResolveTempoFieldState).toHaveBeenCalledWith({
                changes: [],
                beat: 0,
                defaultTempo: 120,
                isPlaying: false,
            });
        });
    });

    describe('tempo writes', () => {
        it('routes a typed tempo through executeAppAction rather than the raw use case', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setTempoValue(133);
            });

            expect(mockExecuteAppAction).toHaveBeenCalledWith({ type: 'setTempo', payload: { bpm: 133 } });
        });

        it('drops the write when the field is locked instead of writing the wrong event', () => {
            mockTempoFieldState = { ...editableFieldState, editable: false, lockReason: 'playback' };
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setTempoValue(133);
            });

            expect(mockExecuteAppAction).not.toHaveBeenCalled();
        });

        it('offers no double-click reset while a tempo map governs', () => {
            const { result } = renderHook(() => useTempoEditorState());

            expect(result.current.resetTempoValue).toBeNull();
        });

        it('resets to the default base tempo through executeAppAction when no map governs', () => {
            mockTempoFieldState = { ...editableFieldState, governedByMap: false, maxTempo: 300 };
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.resetTempoValue?.();
            });

            expect(mockExecuteAppAction).toHaveBeenCalledWith({ type: 'setTempo', payload: { bpm: 120 } });
        });
    });

    describe('time signature editing', () => {
        it('seeds the edit fields from the live transport signature on start', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startTimeSigEdit();
            });

            expect(result.current.editingTimeSig).toBe(true);
            expect(result.current.numValue).toBe('3');
            expect(result.current.denValue).toBe('8');
        });

        it('commits the parsed numerator/denominator and closes the editor', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startTimeSigEdit();
            });
            act(() => {
                result.current.setNumValue('7');
                result.current.setDenValue('16');
            });
            act(() => {
                result.current.commitTimeSig();
            });

            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setTimeSignature',
                payload: { numerator: 7, denominator: 16 },
            });
            expect(result.current.editingTimeSig).toBe(false);
        });

        it('cancels without touching the transport', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startTimeSigEdit();
            });
            act(() => {
                result.current.cancelTimeSigEdit();
            });

            expect(mockExecuteAppAction).not.toHaveBeenCalled();
            expect(result.current.editingTimeSig).toBe(false);
        });
    });

    describe('adding a tempo change', () => {
        it.each([
            ['negative beat', '-1', '120'],
            ['non-numeric beat', 'nope', '120'],
            ['tempo below the 20bpm floor', '4', '19'],
            ['tempo above the 999bpm ceiling', '4', '1000'],
        ])('rejects %s without calling addTempoChange', (_label, beat, tempo) => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setNewBeat(beat);
                result.current.setNewTempo(tempo);
            });
            act(() => {
                result.current.handleAddTempoChange();
            });

            expect(mockAddTempoChange).not.toHaveBeenCalled();
            expect(result.current.newBeat).toBe(beat);
        });

        it('accepts a boundary-valid change and advances newBeat by 4', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setNewBeat('8');
                result.current.setNewTempo('20');
                result.current.setNewCurve('linear');
            });
            act(() => {
                result.current.handleAddTempoChange();
            });

            expect(mockAddTempoChange).toHaveBeenCalledWith(8, 20, 'linear');
            expect(result.current.newBeat).toBe('12');
        });
    });

    describe('editing an existing tempo change', () => {
        const change = { id: 'tc-1', beat: 4, tempo: 140, curve: 'instant' as const };

        it('seeds the edit fields for the selected change', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startEditChange(change);
            });

            expect(result.current.editingChangeId).toBe('tc-1');
            expect(result.current.editingChangeTempo).toBe('140');
        });

        it('commits a valid bpm and clears the editing id', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startEditChange(change);
            });
            act(() => {
                result.current.setEditingChangeTempo('200');
            });
            act(() => {
                result.current.commitEditChange();
            });

            expect(mockUpdateTempoChange).toHaveBeenCalledWith('tc-1', 200);
            expect(result.current.editingChangeId).toBeNull();
        });

        it('discards an out-of-range bpm but still clears the editing id', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startEditChange(change);
            });
            act(() => {
                result.current.setEditingChangeTempo('1000');
            });
            act(() => {
                result.current.commitEditChange();
            });

            expect(mockUpdateTempoChange).not.toHaveBeenCalled();
            expect(result.current.editingChangeId).toBeNull();
        });

        it('is a no-op when nothing is being edited', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.commitEditChange();
            });

            expect(mockUpdateTempoChange).not.toHaveBeenCalled();
        });

        it('cancels without committing', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startEditChange(change);
            });
            act(() => {
                result.current.cancelEditChange();
            });

            expect(mockUpdateTempoChange).not.toHaveBeenCalled();
            expect(result.current.editingChangeId).toBeNull();
        });

        it('forwards removeChange straight to the transport use case', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.removeChange('tc-1');
            });

            expect(mockRemoveTempoChange).toHaveBeenCalledWith('tc-1');
        });
    });

    describe('tap tempo', () => {
        // `performance.now()` is driven by a mutable cursor so unrelated
        // calls (React scheduling, RTL internals) can't desync a fragile
        // once-queue — only the value at the moment `handleTapTempo` runs
        // matters.
        let currentNow = 0;

        beforeEach(() => {
            currentNow = 0;
            vi.spyOn(performance, 'now').mockImplementation(() => currentNow);
        });

        it('waits for a second tap before computing a bpm', () => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.handleTapTempo();
            });

            expect(mockExecuteAppAction).not.toHaveBeenCalled();
        });

        it('derives bpm from the average interval between recent taps', () => {
            const { result } = renderHook(() => useTempoEditorState());

            currentNow = 0;
            act(() => {
                result.current.handleTapTempo();
            });
            currentNow = 500;
            act(() => {
                result.current.handleTapTempo();
            });

            // 500ms interval → 60000 / 500 = 120bpm.
            expect(mockExecuteAppAction).toHaveBeenCalledWith({ type: 'setTempo', payload: { bpm: 120 } });
        });

        it('does not tap a tempo into a locked field', () => {
            mockTempoFieldState = { ...editableFieldState, editable: false, lockReason: 'tempo-ramp' };
            const { result } = renderHook(() => useTempoEditorState());

            currentNow = 0;
            act(() => {
                result.current.handleTapTempo();
            });
            currentNow = 500;
            act(() => {
                result.current.handleTapTempo();
            });

            expect(mockExecuteAppAction).not.toHaveBeenCalled();
        });

        it('ignores a tap pair too fast to be a plausible tempo', () => {
            const { result } = renderHook(() => useTempoEditorState());

            currentNow = 0;
            act(() => {
                result.current.handleTapTempo();
            });
            currentNow = 50;
            act(() => {
                result.current.handleTapTempo();
            });

            // 50ms interval → 1200bpm, above the 300bpm ceiling.
            expect(mockExecuteAppAction).not.toHaveBeenCalled();
        });

        it('drops stale taps outside the 4s window instead of averaging across them', () => {
            const { result } = renderHook(() => useTempoEditorState());

            currentNow = 0;
            act(() => {
                result.current.handleTapTempo();
            });
            currentNow = 5000;
            act(() => {
                result.current.handleTapTempo();
            });

            // The first tap ages out of the 4s window, leaving only one
            // recent tap — too few to derive a bpm from.
            expect(mockExecuteAppAction).not.toHaveBeenCalled();
        });
    });

    describe('tempo map panel click-outside', () => {
        it('closes the panel when a mousedown lands outside it', () => {
            const { result } = renderHook(() => useTempoEditorState());
            const panel = document.createElement('div');
            const outside = document.createElement('div');
            document.body.append(panel, outside);
            result.current.mapPanelRef.current = panel;

            act(() => {
                result.current.setMapOpen(true);
            });
            act(() => {
                outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            });

            expect(result.current.mapOpen).toBe(false);
            panel.remove();
            outside.remove();
        });

        it('leaves the panel open when the mousedown lands inside it', () => {
            const { result } = renderHook(() => useTempoEditorState());
            const panel = document.createElement('div');
            document.body.append(panel);
            result.current.mapPanelRef.current = panel;

            act(() => {
                result.current.setMapOpen(true);
            });
            act(() => {
                panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            });

            expect(result.current.mapOpen).toBe(true);
            panel.remove();
        });
    });
});
