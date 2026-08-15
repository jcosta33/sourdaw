import { type DeviceNodeEntry } from '../buildDeviceChain';

/**
 * A pending note event for a worklet instrument. Collected across all tracks,
 * then scheduled via suspend()/resume() on the OfflineAudioContext as a single
 * deduplicated pass.
 */
export type PendingWorkletEvent = {
    time: number;
    type: 'on' | 'off';
    pitch: number;
    velocity: number;
    instrumentControls: NonNullable<DeviceNodeEntry['instrumentControls']>;
    isToaster: boolean;
    /** For Toaster child tracks: fixed pad index (0-15). -1 means derive from pitch. */
    toasterPadIndex: number;
    /**
     * MPE member channel the note was recorded on, carried on the note-off as
     * well as the note-on. Live playback passes it to both; a bounce that
     * dropped it released every voice at that pitch, so an overlapping unison
     * on two member channels collapsed in the export but not in the session.
     */
    channel?: number;
    /** Levain-only per-note voice articulation, resolved from MIDI project truth. */
    articulationId?: number;
};

/**
 * What a render actually put into the graph, accumulated as it schedules.
 *
 * An *observation*, deliberately not a prediction. Whether a clip contributes
 * sound is decided by a long chain — comping, region trimming, loop iteration,
 * groove projection dropping notes past the clip's own length, probability
 * rolls, missing buffers, zero-length windows — and any second implementation
 * of that chain is a source of truth that agrees today and drifts tomorrow.
 * Counting what survived it cannot drift, because it is the same code.
 *
 * Consumed by the freeze/bounce silence guard: "nothing was scheduled" is
 * legitimate silence whatever the reason, and the reasons never have to be
 * enumerated.
 */
export type OfflineScheduleTally = {
    /** MIDI notes handed to an instrument, after every filter the scheduler applies. */
    scheduledNotes: number;
    /**
     * Source buffers actually started — audio clips and frozen-track playback.
     * The buffers themselves, not a count: a caller that has to distinguish a
     * silent take from a broken render needs to read them, and it can do that
     * lazily rather than making every render pay for a peak scan.
     */
    scheduledBuffers: AudioBuffer[];
};

export type OfflineTrackStrip = {
    inputNode: GainNode;
    preFaderTap: GainNode;
    faderNode: GainNode;
    postFaderGain: GainNode;
    panNode: StereoPannerNode;
    outputNode: GainNode;
    deviceEntries: DeviceNodeEntry[];
};

export type OfflineBusStrip = {
    gainNode: GainNode;
};

export type OfflineRenderOptions = {
    durationBeats: number;
    sampleRate?: number;
    /** Beat at which the render starts (project beat 0 by default). */
    startBeat?: number;
    /** Extra seconds rendered after the region end so reverb/delay tails can ring out. */
    tailSeconds?: number;
    onProgress?: (fraction: number) => void;
    /** Called when a non-fatal issue is detected (e.g. missing audio buffer). */
    onWarning?: (message: string) => void;
};
