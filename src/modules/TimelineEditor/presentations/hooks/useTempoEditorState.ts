import { type RefObject, useState, useRef, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { playheadPositionRef, tempoMapStore, transportStore, type TransportState } from '#/modules/Transport/stores';
import {
    addTempoChange,
    removeTempoChange,
    updateTempoChange,
    resolveTempoFieldState,
} from '#/modules/Transport/useCases';

import { useTransportState } from './useTransportState';

type TempoCurve = 'instant' | 'linear';

type TempoChangeView = {
    id: string;
    beat: number;
    tempo: number;
    curve: TempoCurve;
};

type TempoMapViewState = {
    changes: TempoChangeView[];
};

const defaultTempoMapState: TempoMapViewState = { changes: [] };

/** What double-click reset restores the transport's *base* tempo to. */
const DEFAULT_BASE_TEMPO = 120;

const useTempoMapState = (): TempoMapViewState => {
    return useStore<TempoMapViewState>(tempoMapStore, defaultTempoMapState);
};

/**
 * Whether `transportStore` has actually hydrated.
 *
 * `useTransportState` subscribes with `defaultTransportState` as its fallback,
 * so an unhydrated store still hands back a complete-looking transport at 120
 * BPM. The tempo field cannot tell the two apart from that value, and a drag
 * against the substituted default reaches `getTempoWriteTarget`, resolves
 * `null`, and disappears as a silent `no-write`. Subscribing again with a `null`
 * fallback is the only way to see the difference.
 */
const useHasTransportState = (): boolean => {
    return useStore<TransportState | null>(transportStore, null) !== null;
};

/** Precision the field renders at, so the readout is only re-committed when it visibly changes. */
function toDisplayedTempo(tempo: number): number {
    return Math.round(tempo * 100) / 100;
}

export type TempoEditorState = {
    transport: ReturnType<typeof useTransportState>;
    tempoMap: TempoMapViewState;

    /**
     * Readout, edit gate and clamp bounds for the transport tempo field. The
     * tempo here — not `transport.tempo` — is what the field shows and what an
     * edit writes back to, because with any non-empty tempo map the base tempo
     * governs nothing the schedulers read.
     */
    tempoField: ReturnType<typeof resolveTempoFieldState>;

    // Time signature editing
    editingTimeSig: boolean;
    numValue: string;
    denValue: string;
    setNumValue: (v: string) => void;
    setDenValue: (v: string) => void;
    startTimeSigEdit: () => void;
    commitTimeSig: () => void;
    cancelTimeSigEdit: () => void;

    // Tempo map panel
    mapOpen: boolean;
    setMapOpen: (v: boolean) => void;
    mapPanelRef: RefObject<HTMLDivElement | null>;

    // Tempo change editing
    newBeat: string;
    setNewBeat: (v: string) => void;
    newTempo: string;
    setNewTempo: (v: string) => void;
    newCurve: TempoCurve;
    setNewCurve: (v: TempoCurve) => void;
    editingChangeId: string | null;
    editingChangeTempo: string;
    setEditingChangeTempo: (v: string) => void;
    handleAddTempoChange: () => void;
    startEditChange: (change: TempoChangeView) => void;
    commitEditChange: () => void;
    cancelEditChange: () => void;
    removeChange: (id: string) => void;

    // Tap tempo
    handleTapTempo: () => void;
    setTempoValue: (bpm: number) => void;
    /** Double-click reset. `null` while a tempo map governs — see the hook body. */
    resetTempoValue: (() => void) | null;
};

/**
 * Encapsulates all state and interaction logic for the TempoEditor view.
 */
export const useTempoEditorState = (): TempoEditorState => {
    const transport = useTransportState();
    const tempoMap = useTempoMapState();
    const hasTransportState = useHasTransportState();

    const [livePlayheadBeat, setLivePlayheadBeat] = useState(0);

    let beat = transport.playheadPosition;
    if (transport.isPlaying) {
        beat = livePlayheadBeat;
    }

    const tempoField = resolveTempoFieldState({
        changes: tempoMap.changes,
        beat,
        defaultTempo: transport.tempo,
        hasTransportState,
    });

    /**
     * Track the live playhead while the transport runs.
     *
     * `transportStore.playheadPosition` is written only on start, pause, stop
     * and seek — the scheduler advances `playheadPositionRef` alone, ~100×/s,
     * deliberately outside React. Reading the store during playback therefore
     * shows the tempo at the beat playback *began* at: play a 120@bar1 /
     * 160@bar9 map from bar 1 and the field still says 120 at bar 12.
     *
     * `PlayheadDisplay` solves the same problem with a rAF loop off the same
     * ref. This one commits to React state only when the quantities the field
     * renders or writes would actually change, so a step map costs no re-renders
     * at all between tempo events; only a `linear` ramp, whose readout genuinely
     * moves every frame, re-renders per frame.
     */
    useEffect(() => {
        if (!transport.isPlaying) {
            return undefined;
        }

        const resolveAt = (atBeat: number): ReturnType<typeof resolveTempoFieldState> => {
            return resolveTempoFieldState({
                changes: tempoMap.changes,
                beat: atBeat,
                defaultTempo: transport.tempo,
                hasTransportState,
            });
        };

        const sampleLivePlayhead = (): void => {
            setLivePlayheadBeat((previousBeat) => {
                const nextBeat = playheadPositionRef.current;
                if (nextBeat === previousBeat) {
                    return previousBeat;
                }
                const previousField = resolveAt(previousBeat);
                const nextField = resolveAt(nextBeat);
                const readoutUnchanged =
                    previousField.tempoChangeId === nextField.tempoChangeId &&
                    previousField.editable === nextField.editable &&
                    toDisplayedTempo(previousField.tempo) === toDisplayedTempo(nextField.tempo);
                if (readoutUnchanged) {
                    return previousBeat;
                }
                return nextBeat;
            });
        };

        // Sampled once synchronously as well as per frame: on the render that
        // starts playback the field is still showing the store's beat, and
        // waiting a frame to correct it would flash the wrong tempo. The extra
        // render pass is the point, not an oversight — `@eslint-react/
        // set-state-in-effect` warns on it, and the gate is right to be warn-only
        // here because the source being sampled is deliberately non-reactive.
        sampleLivePlayhead();
        let frame = 0;
        const loop = (): void => {
            sampleLivePlayhead();
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [transport.isPlaying, transport.tempo, tempoMap.changes, hasTransportState]);

    const [editingTimeSig, setEditingTimeSig] = useState(false);
    const [numValue, setNumValue] = useState('');
    const [denValue, setDenValue] = useState('');
    const tapTimesRef = useRef<number[]>([]);
    const [mapOpen, setMapOpen] = useState(false);
    const mapPanelRef = useRef<HTMLDivElement>(null);
    const [newBeat, setNewBeat] = useState('0');
    const [newTempo, setNewTempo] = useState('120');
    const [newCurve, setNewCurve] = useState<TempoCurve>('instant');
    const [editingChangeId, setEditingChangeId] = useState<string | null>(null);
    const [editingChangeTempo, setEditingChangeTempo] = useState('');

    // Click-outside to close tempo map panel
    useEffect(() => {
        if (!mapOpen) {
            return undefined;
        }
        const handleClickOutside = (event: MouseEvent): void => {
            if (mapPanelRef.current && !mapPanelRef.current.contains(event.target as Node)) {
                setMapOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [mapOpen]);

    /**
     * Inserting a change *at the playhead* is the escape route from the ramp
     * lock, so opening the panel seeds the beat field with where the playhead
     * actually is. It used to seed `'0'` (or last + 4), making the user read a
     * beat number off the ruler and retype it.
     *
     * Reads the live ref while playing rather than the gated `beat` above: that
     * one is only re-committed when the *readout* changes, so mid-segment it can
     * lag the true position by many beats.
     */
    const openTempoMapPanel = (open: boolean): void => {
        if (!open) {
            setMapOpen(false);
            return;
        }
        let playheadBeat = transport.playheadPosition;
        if (transport.isPlaying) {
            playheadBeat = playheadPositionRef.current;
        }
        setNewBeat(String(Math.max(0, Math.round(playheadBeat * 100) / 100)));
        setMapOpen(true);
    };

    const startTimeSigEdit = (): void => {
        setNumValue(String(transport.timeSignatureNumerator));
        setDenValue(String(transport.timeSignatureDenominator));
        setEditingTimeSig(true);
    };

    const commitTimeSig = (): void => {
        const num = parseInt(numValue, 10);
        const den = parseInt(denValue, 10);
        // Mirrors `handleAddTempoChange`'s guard below: a bad `parseInt` (empty
        // field, stray text) must not reach `executeAppAction` as NaN — the old
        // `numerator < 1 || numerator > 32` range check silently passes NaN
        // through since both comparisons are false against it.
        if (isNaN(num) || isNaN(den) || num < 1 || num > 32) {
            return;
        }
        void executeAppAction({ type: 'setTimeSignature', payload: { numerator: num, denominator: den } });
        setEditingTimeSig(false);
    };

    const cancelTimeSigEdit = (): void => {
        setEditingTimeSig(false);
    };

    const handleAddTempoChange = (): void => {
        const beat = parseFloat(newBeat);
        const tempo = parseFloat(newTempo);
        if (isNaN(beat) || beat < 0 || isNaN(tempo) || tempo < 20 || tempo > 999) {
            return;
        }
        addTempoChange(beat, tempo, newCurve);
        setNewBeat(String(beat + 4));
    };

    const startEditChange = (change: TempoChangeView): void => {
        setEditingChangeId(change.id);
        setEditingChangeTempo(String(change.tempo));
    };

    const commitEditChange = (): void => {
        if (!editingChangeId) {
            return;
        }
        const bpm = parseFloat(editingChangeTempo);
        if (!isNaN(bpm) && bpm >= 20 && bpm <= 999) {
            updateTempoChange(editingChangeId, bpm);
        }
        setEditingChangeId(null);
    };

    const cancelEditChange = (): void => {
        setEditingChangeId(null);
    };

    /**
     * Every tempo write from this surface goes through `executeAppAction`.
     *
     * Before the field became live, calling the raw use case here was harmless:
     * it wrote `transportStore.tempo`, which no scheduler reads once a tempo map
     * exists. The same call now rewrites a *project* tempo event, and a project
     * mutation outside the command layer leaves no undo entry and no CRDT
     * history — Ctrl+Z would silently undo whatever came before it instead.
     *
     * The action names the event the field was *displaying* when the value was
     * chosen. A bare `setTempo` re-resolves its target from the playhead at
     * execute time, and with `commitMode="release"` that is seconds after the
     * drag began — long enough for a seek, a collaborator, or an AI
     * `seekPlayhead` to move the write onto an event the user never saw.
     */
    const setTempoValue = (bpm: number): void => {
        /**
         * Not redundant with `ValueField`'s own read-only handling, and not to be
         * removed as such. It is redundant only for the drag path, and only
         * because the field now aborts a gesture the lock catches mid-flight. It
         * still carries every other caller: `setTempoValue` is a public field of
         * the exported `TempoEditorState`, and `handleTapTempo` and
         * `resetTempoValue` both reach it on paths gated by different mechanisms
         * — a disabled button and a suppressed `onReset`, neither of which is the
         * field's `readOnly`.
         *
         * Deleting it would also make the write path depend on the control, which
         * is the inversion the abort exists to correct: a second consumer that
         * renders the tempo through some other widget would inherit an ungated
         * write.
         */
        if (!tempoField.editable) {
            return;
        }
        if (tempoField.tempoChangeId === null) {
            void executeAppAction({ type: 'setTempo', payload: { bpm } });
            return;
        }
        void executeAppAction({ type: 'setTempo', payload: { bpm, tempoChangeId: tempoField.tempoChangeId } });
    };

    /**
     * Double-click reset, suppressed while a tempo map governs: 120 is the
     * default *base* tempo and means nothing to a tempo-map event, so resetting
     * would silently overwrite a composed tempo change with an unrelated number.
     */
    let resetTempoValue: (() => void) | null = null;
    if (!tempoField.governedByMap) {
        resetTempoValue = (): void => {
            setTempoValue(DEFAULT_BASE_TEMPO);
        };
    }

    const handleTapTempo = (): void => {
        const now = performance.now();
        const taps = tapTimesRef.current;
        taps.push(now);

        if (taps.length > 8) {
            taps.shift();
        }
        if (taps.length < 2) {
            return;
        }

        const recentTaps = taps.filter((time) => now - time < 4000);
        tapTimesRef.current = recentTaps;

        if (recentTaps.length < 2) {
            return;
        }

        let totalInterval = 0;
        for (let index = 1; index < recentTaps.length; index++) {
            totalInterval += recentTaps[index]! - recentTaps[index - 1]!;
        }
        const avgInterval = totalInterval / (recentTaps.length - 1);
        if (avgInterval <= 0) {
            return;
        }
        const bpm = Math.round((60000 / avgInterval) * 100) / 100;

        if (bpm >= 20 && bpm <= 300) {
            setTempoValue(bpm);
        }
    };

    return {
        transport,
        tempoMap,
        tempoField,
        editingTimeSig,
        numValue,
        denValue,
        setNumValue,
        setDenValue,
        startTimeSigEdit,
        commitTimeSig,
        cancelTimeSigEdit,
        mapOpen,
        setMapOpen: openTempoMapPanel,
        mapPanelRef,
        newBeat,
        setNewBeat,
        newTempo,
        setNewTempo,
        newCurve,
        setNewCurve,
        editingChangeId,
        editingChangeTempo,
        setEditingChangeTempo,
        handleAddTempoChange,
        startEditChange,
        commitEditChange,
        cancelEditChange,
        removeChange: removeTempoChange,
        handleTapTempo,
        setTempoValue,
        resetTempoValue,
    };
};
