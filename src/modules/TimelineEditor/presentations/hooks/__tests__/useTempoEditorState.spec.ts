import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTempoEditorState } from '../useTempoEditorState';

import type { TransportState } from '#/modules/Transport/stores';

// ── Store mocks ──────────────────────────────────────────────────────────
// `mockTransportStore`/`mockTempoMapStore` are plain identity markers — the
// real stores are Automerge-backed and heavy to construct, so we replace
// `useStore` outright and branch on which store object was passed in.
const { mockTransportStore, mockTempoMapStore, mockPlayheadPositionRef, hoistedDefaultTransportState } = vi.hoisted(
    () => ({
        mockTransportStore: { name: 'transportStore' },
        mockTempoMapStore: { name: 'tempoMapStore' },
        // Stands in for the non-reactive high-frequency playhead channel the
        // scheduler writes ~100×/s. Tests set `.current` to place the live
        // playhead somewhere the *store* playhead is not.
        mockPlayheadPositionRef: { current: 0 },
        hoistedDefaultTransportState: {
            isPlaying: false,
            tempo: 120,
            playheadPosition: 0,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        },
    })
);
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mockTransportStore,
    tempoMapStore: mockTempoMapStore,
    playheadPositionRef: mockPlayheadPositionRef,
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

/** `null` reproduces `transportStore` before it has hydrated. */
let mockTransportState: TransportState | null = baseTransportState;
let mockTempoMapState: { changes: Array<{ id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }> } = {
    changes: [],
};

// Mirrors the real `useStore`, which is `getSnapshot() ?? defaultValue`. A hook
// that passes `null` as the default therefore observes the unhydrated store,
// while one that passes `defaultTransportState` observes the substituted default
// — the exact divergence that let the field render editable before hydration.
const mockUseStore = vi.fn((store: unknown, defaultState?: unknown) => {
    if (store === mockTransportStore) {
        return mockTransportState ?? defaultState;
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
    lockReason: 'tempo-ramp' | 'no-transport-state' | null;
    tempoChangeId: string | null;
    minTempo: number;
    maxTempo: number;
};
type ResolveTempoFieldStateInput = {
    changes: readonly { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }[];
    beat: number;
    defaultTempo: number;
    hasTransportState: boolean;
};
// The tempo matches neither the base tempo nor any fixture map tempo, so
// `tempoField.tempo` can only be right by routing through the resolver.
const RESOLVED_TEMPO_SENTINEL = 77;
const editableFieldState: TempoFieldState = {
    tempo: RESOLVED_TEMPO_SENTINEL,
    governedByMap: true,
    editable: true,
    lockReason: null,
    tempoChangeId: 'tc-resolved',
    minTempo: 20,
    maxTempo: 999,
};
let mockTempoFieldState: TempoFieldState = editableFieldState;
/**
 * Default stand-in: one fixed answer regardless of beat. The live-playhead tests
 * swap in a beat-sensitive implementation so the two playhead positions they
 * drive between produce visibly different answers.
 */
let mockResolveImplementation: (input: ResolveTempoFieldStateInput) => TempoFieldState = () => mockTempoFieldState;
const mockResolveTempoFieldState = vi.fn((input: ResolveTempoFieldStateInput): TempoFieldState =>
    mockResolveImplementation(input)
);
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
    resolveTempoFieldState: (input: ResolveTempoFieldStateInput): TempoFieldState => {
        return mockResolveTempoFieldState(input);
    },
    // `useTransportState` passes this as the `useStore` default, exactly as in
    // production — which is why an unhydrated store still yields a usable-looking
    // transport object and the field needs its own null-aware subscription.
    defaultTransportState: hoistedDefaultTransportState,
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
        mockResolveImplementation = () => mockTempoFieldState;
        mockPlayheadPositionRef.current = 0;
    });

    describe('tempo field state', () => {
        it('resolves the readout from the tempo map at the stopped playhead', () => {
            mockTempoMapState = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
            mockTransportState = { ...baseTransportState, tempo: 120, playheadPosition: 6, isPlaying: false };

            const { result } = renderHook(() => useTempoEditorState());

            expect(mockResolveTempoFieldState).toHaveBeenCalledWith({
                changes: mockTempoMapState.changes,
                beat: 6,
                defaultTempo: 120,
                hasTransportState: true,
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
                hasTransportState: true,
            });
        });

        it('tells the resolver the transport store has not hydrated instead of passing off the defaults', () => {
            // `useTransportState` substitutes `defaultTransportState`, so the
            // transport object still looks usable here. Without a null-aware
            // subscription the field renders editable at 120 and a drag reaches
            // `getTempoWriteTarget`, resolves `null`, and vanishes silently.
            mockTransportState = null;

            renderHook(() => useTempoEditorState());

            expect(mockResolveTempoFieldState).toHaveBeenCalledWith(
                expect.objectContaining({ hasTransportState: false })
            );
        });
    });

    describe('live playhead during playback', () => {
        // 120 BPM from bar 1, 160 BPM from bar 9 (beat 32 at 4/4). Two positions
        // on the same map that the resolver answers differently, so a readout
        // taken from the store playhead and one taken from the live ref cannot be
        // confused for each other.
        const BEAT_AT_BAR_9 = 32;
        const bandedMap = [
            { id: 'tc-bar1', beat: 0, tempo: 120, curve: 'instant' as const },
            { id: 'tc-bar9', beat: BEAT_AT_BAR_9, tempo: 160, curve: 'instant' as const },
        ];

        const bandedResolver = (input: ResolveTempoFieldStateInput): TempoFieldState => {
            const inSecondBand = input.beat >= BEAT_AT_BAR_9;
            return {
                tempo: inSecondBand ? 160 : 120,
                governedByMap: true,
                editable: input.hasTransportState,
                lockReason: input.hasTransportState ? null : 'no-transport-state',
                tempoChangeId: inSecondBand ? 'tc-bar9' : 'tc-bar1',
                minTempo: 20,
                maxTempo: 999,
            };
        };

        beforeEach(() => {
            mockTempoMapState = { changes: bandedMap };
            mockResolveImplementation = bandedResolver;
        });

        it('reads out the tempo sounding now, not the one at the beat playback started from', () => {
            // Play from bar 1 to bar 12: the store playhead still holds bar 1
            // (it is written only on start/pause/stop/seek) while the scheduler
            // has advanced the ref past bar 9.
            mockTransportState = { ...baseTransportState, tempo: 100, playheadPosition: 0, isPlaying: true };
            mockPlayheadPositionRef.current = 44;

            const { result } = renderHook(() => useTempoEditorState());

            expect(result.current.tempoField.tempo).toBe(160);
            expect(result.current.tempoField.tempoChangeId).toBe('tc-bar9');
        });

        it('stays editable while the transport runs, since the write path resolves the same live beat', () => {
            mockTransportState = { ...baseTransportState, tempo: 100, playheadPosition: 0, isPlaying: true };
            mockPlayheadPositionRef.current = 44;

            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setTempoValue(150);
            });

            expect(result.current.tempoField.editable).toBe(true);
            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setTempo',
                payload: { bpm: 150, tempoChangeId: 'tc-bar9' },
            });
        });

        it('follows the ref across a tempo event mid-playback rather than freezing on the first reading', () => {
            const frames: FrameRequestCallback[] = [];
            vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
                frames.push(callback);
                return frames.length;
            });
            vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);

            mockTransportState = { ...baseTransportState, tempo: 100, playheadPosition: 0, isPlaying: true };
            mockPlayheadPositionRef.current = 4;

            const { result } = renderHook(() => useTempoEditorState());
            expect(result.current.tempoField.tempo).toBe(120);

            mockPlayheadPositionRef.current = 40;
            act(() => {
                frames.shift()?.(0);
            });

            expect(result.current.tempoField.tempo).toBe(160);
            expect(result.current.tempoField.tempoChangeId).toBe('tc-bar9');
        });

        it('ignores the live ref when stopped, so a seek is what moves the readout', () => {
            mockTransportState = { ...baseTransportState, tempo: 100, playheadPosition: 0, isPlaying: false };
            mockPlayheadPositionRef.current = 44;

            const { result } = renderHook(() => useTempoEditorState());

            expect(result.current.tempoField.tempo).toBe(120);
            expect(result.current.tempoField.tempoChangeId).toBe('tc-bar1');
        });
    });

    describe('tempo writes', () => {
        it('pins the write to the event the readout came from rather than re-resolving it later', () => {
            // Without the id on the payload, `setTempo` resolves its target again
            // at execute time — which under `commitMode="release"` is seconds
            // after the drag started. A seek, a collaborator, or an AI
            // `seekPlayhead` in between lands the value on a different event.
            mockTempoFieldState = { ...editableFieldState, tempoChangeId: 'tc-displayed' };
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setTempoValue(133);
            });

            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setTempo',
                payload: { bpm: 133, tempoChangeId: 'tc-displayed' },
            });
        });

        it('names no event when the base tempo governs, where there is none to name', () => {
            mockTempoFieldState = {
                ...editableFieldState,
                governedByMap: false,
                tempoChangeId: null,
                maxTempo: 300,
            };
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setTempoValue(133);
            });

            expect(mockExecuteAppAction).toHaveBeenCalledWith({ type: 'setTempo', payload: { bpm: 133 } });
        });

        it('drops the write when the field is locked instead of writing the wrong event', () => {
            mockTempoFieldState = { ...editableFieldState, editable: false, lockReason: 'no-transport-state' };
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
            mockTempoFieldState = {
                ...editableFieldState,
                governedByMap: false,
                tempoChangeId: null,
                maxTempo: 300,
            };
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

        it.each([
            ['an empty numerator field', '', '4'],
            ['non-numeric numerator text', 'nope', '4'],
            ['an out-of-range numerator', '99', '4'],
        ])('rejects %s without dispatching or closing the editor', (_label, num, den) => {
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.startTimeSigEdit();
            });
            act(() => {
                result.current.setNumValue(num);
                result.current.setDenValue(den);
            });
            act(() => {
                result.current.commitTimeSig();
            });

            // `parseInt('', 10)` and `parseInt('nope', 10)` are both NaN, and
            // `NaN < 1 || NaN > 32` is false for either bound — the pre-fix range
            // check alone let this reach `executeAppAction`.
            expect(mockExecuteAppAction).not.toHaveBeenCalled();
            expect(result.current.editingTimeSig).toBe(true);
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

            // 500ms interval → 60000 / 500 = 120bpm, landing on the same event the
            // field is reading out.
            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setTempo',
                payload: { bpm: 120, tempoChangeId: 'tc-resolved' },
            });
        });

        it('taps a tempo onto the event governing the live playhead while the transport runs', () => {
            // Tap tempo means "the music is at this BPM", so the state it is most
            // for is tapping along to a running transport. It used to early-return
            // there against a `playback` lock, silently.
            mockTransportState = { ...baseTransportState, isPlaying: true, playheadPosition: 0 };
            mockPlayheadPositionRef.current = 44;
            mockTempoFieldState = { ...editableFieldState, tempoChangeId: 'tc-live' };
            const { result } = renderHook(() => useTempoEditorState());

            currentNow = 0;
            act(() => {
                result.current.handleTapTempo();
            });
            currentNow = 500;
            act(() => {
                result.current.handleTapTempo();
            });

            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setTempo',
                payload: { bpm: 120, tempoChangeId: 'tc-live' },
            });
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

    describe('opening the tempo map panel', () => {
        it('seeds the new-change beat from the stopped playhead instead of leaving it at 0', () => {
            // Inserting a change *at the playhead* is the escape route from the
            // ramp lock. Seeding '0' made the user transcribe a beat number off
            // the ruler to use it.
            mockTransportState = { ...baseTransportState, playheadPosition: 12, isPlaying: false };
            const { result } = renderHook(() => useTempoEditorState());

            expect(result.current.newBeat).toBe('0');

            act(() => {
                result.current.setMapOpen(true);
            });

            expect(result.current.newBeat).toBe('12');
        });

        it('seeds from the live playhead while the transport runs, not the beat playback started at', () => {
            mockTransportState = { ...baseTransportState, playheadPosition: 0, isPlaying: true };
            mockPlayheadPositionRef.current = 44.5;
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setMapOpen(true);
            });

            expect(result.current.newBeat).toBe('44.5');
        });

        it('leaves the seeded beat alone when the panel closes', () => {
            mockTransportState = { ...baseTransportState, playheadPosition: 12, isPlaying: false };
            const { result } = renderHook(() => useTempoEditorState());

            act(() => {
                result.current.setMapOpen(true);
            });
            act(() => {
                result.current.setNewBeat('20');
            });
            act(() => {
                result.current.setMapOpen(false);
            });

            expect(result.current.newBeat).toBe('20');
            expect(result.current.mapOpen).toBe(false);
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
