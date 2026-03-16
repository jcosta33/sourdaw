import { trackStore } from "../stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { recordAutomationValue } from "#/modules/Track/useCases/automationRecording";
import type { AutomationMode, InputMonitoring } from "../models/Track";

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(["write", "touch", "latch"]);

const maybeRecordAutomation = (trackId: string, parameterId: string, value: number): void => {
    const transport = transportStore.value;
    if (!transport?.isPlaying) {
        return;
    }

    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    recordAutomationValue(trackId, parameterId, value, transport.playheadPosition);
};

export const setTrackGain = (trackId: string, gain: number): void => {
    const state = trackStore.value;
    if (!state) return;

    const clamped = Math.max(0, Math.min(1, gain));
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, gain: clamped } : t,
        ),
    });

    maybeRecordAutomation(trackId, "gain", clamped);
};

export const setTrackPan = (trackId: string, pan: number): void => {
    const state = trackStore.value;
    if (!state) return;

    const clamped = Math.max(-50, Math.min(50, pan));
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, pan: clamped } : t,
        ),
    });

    maybeRecordAutomation(trackId, "pan", clamped);
};

export const setTrackColor = (trackId: string, color: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, color } : t,
        ),
    });
};

export const setTrackNotes = (trackId: string, notes: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, notes } : t,
        ),
    });
};

export const setInputMonitoring = (trackId: string, mode: InputMonitoring): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, inputMonitoring: mode } : t,
        ),
    });
};
