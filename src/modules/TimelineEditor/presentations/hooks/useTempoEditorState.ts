import { type RefObject, useState, useRef, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { tempoMapStore } from '#/modules/Transport/stores';
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

    const tempoField = resolveTempoFieldState({
        changes: tempoMap.changes,
        beat: transport.playheadPosition,
        defaultTempo: transport.tempo,
        isPlaying: transport.isPlaying,
    });

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

    const startTimeSigEdit = (): void => {
        setNumValue(String(transport.timeSignatureNumerator));
        setDenValue(String(transport.timeSignatureDenominator));
        setEditingTimeSig(true);
    };

    const commitTimeSig = (): void => {
        const num = parseInt(numValue, 10);
        const den = parseInt(denValue, 10);
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
     */
    const setTempoValue = (bpm: number): void => {
        if (!tempoField.editable) {
            return;
        }
        void executeAppAction({ type: 'setTempo', payload: { bpm } });
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
        setMapOpen,
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
