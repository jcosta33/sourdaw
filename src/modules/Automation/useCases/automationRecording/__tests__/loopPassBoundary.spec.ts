import { describe, it, expect, beforeEach, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { recordAutomationValue } from '../recordAutomationValue';
import { setAutomationRecordingDependencies } from '../recordingDependencies';
import { activeRecording, laneBaselines, pendingPoints, touchActive } from '../recordingSessionState';
import { stopAutomationRecording } from '../stopAutomationRecording';

vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: vi.fn() }));

/**
 * Riding a fader around a loop must leave lap two's curve, not a splice of both
 * laps.
 *
 * All passes accumulated into one `pendingPoints` buffer, so a loop wrap made it
 * non-monotonic in beat: RDP then ran over a polyline that doubles back on
 * itself, and `clearPointsInRange` ran once at stop over the union of both
 * passes. When the two passes happened to sample the same beat grid the later
 * value replaced the earlier one and it looked fine; off-grid — which is the
 * normal case, since pointer samples do not align to the transport — lap one's
 * points survived interleaved with lap two's. Live, Logic, Pro Tools and REAPER
 * all replace the previous pass on lap two.
 */

const TRACK_ID = 'looped-track';

function seedWriteModeTrack(): void {
    // Local structural literal rather than Arrangement's `TrackDummy`: a spec in
    // this module may not reach across the module boundary for a fixture.
    trackStore.set({
        tracks: [
            {
                id: TRACK_ID,
                name: 'Looped',
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                color: '#ff0000',
                clips: [],
                devices: [],
                midiFx: [],
                sends: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: null,
                collapsed: false,
                inputMonitoring: 'auto',
                hidden: false,
                disabled: false,
                height: 80,
                outputId: 'master',
                automationMode: 'write',
                groupId: null,
                soloSafe: false,
                notes: '',
                inputId: null,
                activeAlternativeId: 'alt-1',
                alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    automationStore.set({ lanes: [createAutomationLane(TRACK_ID, 'gain', 'Gain')] });
}

function recordedPoints(): Array<{ beat: number; value: number }> {
    const lane = automationStore.value?.lanes[0];
    return (lane?.points ?? []).map((point) => ({ beat: point.beat, value: point.value }));
}

/** One pass of samples, `[beat, value]`, played at the transport's own clock. */
function playPass(samples: Array<[number, number]>): void {
    for (const [beat, value] of samples) {
        transportStore.set({ ...transportStore.value!, playheadPosition: beat });
        recordAutomationValue(TRACK_ID, 'gain', value, beat);
    }
}

describe('automation recording across a loop boundary', () => {
    beforeEach(() => {
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
        laneBaselines.clear();
        setAutomationRecordingDependencies({
            getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as unknown as AudioContext,
            getCompensationDelay: () => 0,
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 0 });
        seedWriteModeTrack();
    });

    it('replaces the first pass when the playhead wraps, rather than splicing the two', () => {
        // Both laps traverse the same loop, as a loop does. Lap one is a V; lap
        // two is flat at 0.3 with its interior sampled off lap one's grid, so
        // the two cannot silently merge by landing on the same beats — which is
        // what made the damage look intermittent.
        playPass([
            [0, 0.9],
            [1, 0.15],
            [2, 0.9],
        ]);
        playPass([
            [0, 0.3],
            [0.37, 0.3],
            [1.13, 0.3],
            [2, 0.3],
        ]);
        stopAutomationRecording();

        const points = recordedPoints();
        // Lap one's vertex is the tell: 0.15 at beat 1 belongs to a pass the
        // user overwrote, and nothing from lap one may outlive it.
        expect(points.every((point) => point.value === 0.3)).toBe(true);
        expect(points.map((point) => point.beat)).toEqual([0, 2]);
    });

    /**
     * Span alignment is incidental; this is the property that holds however the
     * laps line up. One shared buffer made the point stream double back on
     * itself at the wrap, and RDP over a self-intersecting polyline emits points
     * that pair one lap's beat with another lap's value — the lane ends up
     * describing a curve neither pass performed.
     */
    it('leaves the lane strictly ordered in beat, with no value from the abandoned lap', () => {
        playPass([
            [0, 0.9],
            [1, 0.15],
            [2, 0.9],
        ]);
        playPass([
            [0.13, 0.3],
            [1.13, 0.3],
            [2.13, 0.3],
        ]);
        stopAutomationRecording();

        const points = recordedPoints();
        const beats = points.map((point) => point.beat);
        expect(beats).toEqual([...beats].sort((left, right) => left - right));
        expect(new Set(beats).size).toBe(beats.length);
        // Lap one's vertex value cannot appear anywhere: lap two passed over
        // that beat and overwrote it.
        expect(points.some((point) => point.value === 0.15)).toBe(false);
    });

    it('keeps a single uninterrupted pass intact', () => {
        playPass([
            [0, 0.9],
            [1, 0.15],
            [2, 0.9],
        ]);
        stopAutomationRecording();

        const points = recordedPoints();
        expect(points).toEqual([
            { beat: 0, value: 0.9 },
            { beat: 1, value: 0.15 },
            { beat: 2, value: 0.9 },
        ]);
    });
});
