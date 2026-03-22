/**
 * Continuous Background Punch Recording (QuickPunch)
 *
 * Non-destructive punch-in/punch-out recording that continuously
 * captures audio in the background. Users can retroactively define
 * punch boundaries, keeping only the desired portions.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type PunchRegion = {
    id: string;
    trackId: string;
    /** Beat position where punch-in occurs */
    punchInBeat: number;
    /** Beat position where punch-out occurs */
    punchOutBeat: number;
    /** The source recording clip ID (full background capture) */
    sourceClipId: string;
    /** Pre-roll captured before punch-in (in beats) */
    preRollBeats: number;
    /** Post-roll captured after punch-out (in beats) */
    postRollBeats: number;
    /** Has this punch been committed? */
    committed: boolean;
    /** Crossfade duration at boundaries (beats) */
    crossfadeBeats: number;
};

export type BackgroundCapture = {
    id: string;
    trackId: string;
    /** Start beat of the background recording */
    startBeat: number;
    /** Current end beat (grows as recording continues) */
    endBeat: number;
    /** Is this capture currently recording? */
    recording: boolean;
    /** Associated punch regions carved from this capture */
    punchRegions: PunchRegion[];
};

export type PunchRecordingState = {
    /** Active background captures per track */
    captures: BackgroundCapture[];
    /** Default pre-roll duration in beats */
    defaultPreRoll: number;
    /** Default post-roll duration in beats */
    defaultPostRoll: number;
    /** Default crossfade duration in beats */
    defaultCrossfade: number;
    /** Is continuous background capture enabled? */
    enabled: boolean;
};

export const punchRecordingStore = new Store<PunchRecordingState>(logger, {
    initialData: {
        captures: [],
        defaultPreRoll: 4,
        defaultPostRoll: 2,
        defaultCrossfade: 0.25,
        enabled: false,
    },
});

let captureId = 1;
let punchId = 1;

// ── Background Capture Control ────────────────────────────────────────

export function togglePunchRecording(): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({ ...state, enabled: !state.enabled });
}

export function startBackgroundCapture(trackId: string, startBeat: number): void {
    const state = punchRecordingStore.value;
    if (!state || !state.enabled) {
        return;
    }

    const capture: BackgroundCapture = {
        id: `cap-${captureId++}`,
        trackId,
        startBeat,
        endBeat: startBeat,
        recording: true,
        punchRegions: [],
    };

    punchRecordingStore.set({
        ...state,
        captures: [...state.captures, capture],
    });
}

export function updateCapturePosition(captureId: string, currentBeat: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureId ? { ...c, endBeat: currentBeat } : c
        ),
    });
}

export function stopBackgroundCapture(captureIdVal: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureIdVal ? { ...c, recording: false } : c
        ),
    });
}

// ── Punch Regions ─────────────────────────────────────────────────────

export function definePunchRegion(
    captureIdVal: string,
    punchInBeat: number,
    punchOutBeat: number
): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }

    const capture = state.captures.find((c) => c.id === captureIdVal);
    if (!capture) {
        return;
    }

    const region: PunchRegion = {
        id: `punch-${punchId++}`,
        trackId: capture.trackId,
        punchInBeat,
        punchOutBeat,
        sourceClipId: capture.id,
        preRollBeats: state.defaultPreRoll,
        postRollBeats: state.defaultPostRoll,
        committed: false,
        crossfadeBeats: state.defaultCrossfade,
    };

    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureIdVal
                ? { ...c, punchRegions: [...c.punchRegions, region] }
                : c
        ),
    });
}

export function commitPunchRegion(captureIdVal: string, regionId: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureIdVal
                ? {
                      ...c,
                      punchRegions: c.punchRegions.map((r) =>
                          r.id === regionId ? { ...r, committed: true } : r
                      ),
                  }
                : c
        ),
    });
}

export function discardCapture(captureIdVal: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.filter((c) => c.id !== captureIdVal),
    });
}

// ── Settings ──────────────────────────────────────────────────────────

export function setPreRoll(beats: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({ ...state, defaultPreRoll: beats });
}

export function setPostRoll(beats: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({ ...state, defaultPostRoll: beats });
}
