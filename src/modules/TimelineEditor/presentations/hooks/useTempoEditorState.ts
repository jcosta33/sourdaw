import { type RefObject, useState, useRef, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { tempoMapStore } from '#/modules/Transport/stores';
import {
    setTempo,
    addTempoChange,
    removeTempoChange,
    updateTempoChange,
    resolveTempoAtBeat,
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

const useTempoMapState = (): TempoMapViewState => {
    return useStore<TempoMapViewState>(tempoMapStore, defaultTempoMapState);
};

export type TempoEditorState = {
    transport: ReturnType<typeof useTransportState>;
    tempoMap: TempoMapViewState;

    /**
     * Tempo actually in force at the playhead — the tempo map's value when a map
     * exists, the transport base tempo when it does not. This, not
     * `transport.tempo`, is what the tempo field reads out and writes back to.
     */
    effectiveTempo: number;
    /** True when a tempo-map event, not the base tempo, governs the playhead. */
    tempoGovernedByMap: boolean;

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
};

/**
 * Encapsulates all state and interaction logic for the TempoEditor view.
 */
export const useTempoEditorState = (): TempoEditorState => {
    const transport = useTransportState();
    const tempoMap = useTempoMapState();

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
            setTempo(bpm);
        }
    };

    const tempoGovernedByMap = tempoMap.changes.length > 0;
    const effectiveTempo = resolveTempoAtBeat({
        changes: tempoMap.changes,
        beat: transport.playheadPosition,
        defaultTempo: transport.tempo,
    });

    return {
        transport,
        tempoMap,
        effectiveTempo,
        tempoGovernedByMap,
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
        setTempoValue: setTempo,
    };
};
