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
