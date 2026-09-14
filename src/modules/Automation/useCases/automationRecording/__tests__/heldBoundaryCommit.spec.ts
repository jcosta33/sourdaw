import { describe, it, expect, beforeEach, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { getAutomationValueAtBeat } from '../../automation/getAutomationValueAtBeat';
import { recordAutomationValue } from '../recordAutomationValue';
import { setAutomationRecordingDependencies } from '../recordingDependencies';
import { activeRecording, laneBaselines, pendingPoints, touchActive } from '../recordingSessionState';
import { releaseTouchAutomation } from '../releaseTouchAutomation';
import { startAutomationRecording } from '../startAutomationRecording';
import { stopAutomationRecording } from '../stopAutomationRecording';

const undoEntries = vi.hoisted(() => new Array<{ undo: () => void; redo: () => void }>());

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: (_label: string, undo: () => void, redo: () => void) => {
        undoEntries.push({ undo, redo });
    },
    executeUserAppAction: vi.fn(),
}));

/**
 * Write and latch hold their last gesture value from the final gesture to the
 * transport stop — live playback suppresses the lane the whole way
 * (`applyAutomation` skips it while the session records), so the user hears the
 * held value, not the old curve. Committing the pass only through the last
 * buffered gesture left the old points beyond that beat alive, and replay jumped
 * back onto a curve the pass had silenced (#3798). The stop boundary must be
 * committed through: the held value lands at it, and the traversed interval is
 * replaced.
 */

const TRACK_ID = 'held-track';

function seedTrack(automationMode: 'write' | 'touch' | 'latch'): void {
    // Local structural literal rather than Arrangement's `TrackDummy`: a spec in
    // this module may not reach across the module boundary for a fixture.
    trackStore.set({
        tracks: [
            {
                id: TRACK_ID,
                name: 'Held',
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
                automationMode,
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
}

function seedLane(points: Array<{ beat: number; value: number }>): void {
    const lane = createAutomationLane(TRACK_ID, 'gain', 'Gain');
    automationStore.set({
        lanes: [
            {
                ...lane,
                points: points.map((point) => ({
                    beat: point.beat,
                    value: point.value,
                    curve: 'linear' as const,
                    tension: 0,
                })),
            },
        ],
    });
}

function recordedPoints(): Array<{ beat: number; value: number }> {
    const lane = automationStore.value?.lanes[0];
    return (lane?.points ?? []).map((point) => ({ beat: point.beat, value: point.value }));
}

function laneId(): string {
    return automationStore.value!.lanes[0]!.id;
}

/** Begin playback at `startBeat`: seeds the recording sessions the way a real play does. */
function beginPlayback(startBeat: number): void {
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: startBeat });
    startAutomationRecording();
}

describe('automation recording committed through the transport stop boundary', () => {
    beforeEach(() => {
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
        laneBaselines.clear();
        undoEntries.length = 0;
        setAutomationRecordingDependencies({
            getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as unknown as AudioContext,
            getCompensationDelay: () => 0,
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 0 });
    });

    it('replaces the suppressed old curve and holds the latched value through the stop', () => {
        // The issue's fixture: playback from beat 0, one gesture at beat 2, the
        // transport runs on to beat 8 while latch holds. The old curve carries
        // beat 4 = 0.4 and beat 8 = 0.6 — both silenced live, both still on the
        // lane if the pass commits through the last gesture alone.
        seedTrack('latch');
        seedLane([
            { beat: 4, value: 0.4 },
            { beat: 8, value: 0.6 },
        ]);
        beginPlayback(0);
        recordAutomationValue(TRACK_ID, 'gain', 0.5, 1);
        recordAutomationValue(TRACK_ID, 'gain', 0.8, 2);

        stopAutomationRecording(8);

        const points = recordedPoints();
        // The traversed interval is replaced: no old point survives inside it.
        expect(points.some((point) => point.beat === 4 && point.value === 0.4)).toBe(false);
        expect(points.some((point) => point.beat === 8 && point.value === 0.6)).toBe(false);
        // The held value lands at the boundary, so replay equals the held listen.
        expect(points.find((point) => point.beat === 8)?.value).toBe(0.8);
        // The ride itself survives the RDP.
        expect(points.find((point) => point.beat === 1)?.value).toBe(0.5);
        expect(points.find((point) => point.beat === 2)?.value).toBe(0.8);
        // Replay reads the held value through the whole held interval, not just
        // at the boundary point.
        expect(getAutomationValueAtBeat(laneId(), 6)).toBeCloseTo(0.8, 9);
    });

    it('preserves the pre-touch curve in latch mode when the first touch comes late', () => {
        // Latch starts at its first touch: before it, live playback followed
        // the existing curve, so that span must survive the overwrite.
        seedTrack('latch');
        seedLane([
            { beat: 2, value: 0.3 },
            { beat: 6, value: 0.9 },
        ]);
        beginPlayback(0);
        recordAutomationValue(TRACK_ID, 'gain', 0.2, 4);

        stopAutomationRecording(8);

        const points = recordedPoints();
        expect(points.find((point) => point.beat === 2)?.value).toBe(0.3);
        expect(points.some((point) => point.beat === 6 && point.value === 0.9)).toBe(false);
        expect(points.find((point) => point.beat === 8)?.value).toBe(0.2);
    });

    it('records and clears nothing in write mode when the pass carries no new gesture', () => {
        seedTrack('write');
        seedLane([{ beat: 4, value: 0.4 }]);
        beginPlayback(0);

        stopAutomationRecording(8);

        expect(recordedPoints()).toEqual([{ beat: 4, value: 0.4 }]);
    });

    it('holds through the boundary from the pass start in write mode', () => {
        seedTrack('write');
        seedLane([
            { beat: 0.5, value: 0.1 },
            { beat: 4, value: 0.4 },
            { beat: 8, value: 0.6 },
        ]);
        beginPlayback(0);
        recordAutomationValue(TRACK_ID, 'gain', 0.5, 1);
        recordAutomationValue(TRACK_ID, 'gain', 0.8, 2);

        stopAutomationRecording(8);

        const points = recordedPoints();
        // Write replaces the whole span it traverses, from the pass start —
        // unlike latch, even the stretch before the first gesture is overwritten.
        expect(points.find((point) => point.beat === 0.5)).toBeUndefined();
        expect(points.find((point) => point.beat === 4)).toBeUndefined();
        expect(points.find((point) => point.beat === 8)?.value).toBe(0.8);
    });

    it('ends the pass at a loop wrap and commits the final lap through the authoritative stop', () => {
        seedTrack('latch');
        seedLane([{ beat: 3, value: 0.7 }]);
        beginPlayback(0);
        // Lap one sweeps 1..4 over the seeded point.
        recordAutomationValue(TRACK_ID, 'gain', 0.6, 1);
        recordAutomationValue(TRACK_ID, 'gain', 0.6, 4);
        // The wrap: the next gesture's beat drops below the last raw beat, so
        // lap one commits and lap two starts its own span at 0.5.
        recordAutomationValue(TRACK_ID, 'gain', 0.3, 0.5);
        recordAutomationValue(TRACK_ID, 'gain', 0.3, 2.5);

        stopAutomationRecording(6);

        const points = recordedPoints();
        // Nothing from the abandoned lap survives inside the final span.
        expect(points.some((point) => point.value === 0.6)).toBe(false);
        expect(points.some((point) => point.value === 0.7)).toBe(false);
        // The final lap holds through the authoritative stop boundary.
        expect(points.find((point) => point.beat === 6)?.value).toBe(0.3);
        expect(getAutomationValueAtBeat(laneId(), 4)).toBeCloseTo(0.3, 9);
    });

    it('keeps the writing-span start across a mid-pass touch release', () => {
        // A pointer lift in latch mode flushes the buffered gesture into the
        // lane but does not end the writing span — the value stays latched. The
        // span's start cannot be read off the (now empty) buffer, or the
        // overwrite would silently begin at the post-release gesture instead of
        // the pass's first touch. (The flushed point at the span start itself is
        // eaten by the span's own inclusive clear — the established commit
        // semantics; what must survive is everything strictly before the span.)
        seedTrack('latch');
        seedLane([
            { beat: 0.5, value: 0.25 },
            { beat: 1.5, value: 0.35 },
            { beat: 4, value: 0.4 },
            { beat: 8, value: 0.6 },
        ]);
        beginPlayback(0);
        recordAutomationValue(TRACK_ID, 'gain', 0.5, 1);
        releaseTouchAutomation(TRACK_ID, 'gain');
        recordAutomationValue(TRACK_ID, 'gain', 0.8, 2);

        stopAutomationRecording(8);

        const points = recordedPoints();
        // Strictly before the span: the old curve survives — the span began at
        // the first touch (beat 1), not at the post-release gesture (beat 2).
        expect(points.find((point) => point.beat === 0.5)?.value).toBe(0.25);
        expect(points.find((point) => point.beat === 1.5)).toBeUndefined();
        expect(points.find((point) => point.beat === 4)).toBeUndefined();
        expect(points.find((point) => point.beat === 8)?.value).toBe(0.8);
    });

    it('undo restores the pre-session curve and redo reinstates the held pass', () => {
        seedTrack('latch');
        seedLane([
            { beat: 4, value: 0.4 },
            { beat: 8, value: 0.6 },
        ]);
        beginPlayback(0);
        recordAutomationValue(TRACK_ID, 'gain', 0.8, 2);

        stopAutomationRecording(8);
        expect(undoEntries).toHaveLength(1);

        undoEntries[0]!.undo();
        expect(recordedPoints()).toEqual([
            { beat: 4, value: 0.4 },
            { beat: 8, value: 0.6 },
        ]);

        undoEntries[0]!.redo();
        const points = recordedPoints();
        expect(points.find((point) => point.beat === 4)).toBeUndefined();
        expect(points.find((point) => point.beat === 8)?.value).toBe(0.8);
    });

    it('keeps touch mode free of the boundary: no clear, no held point', () => {
        // Touch's release returns to the curve through the AutoMatch glide —
        // its own separate behavior. A stop boundary must not turn a touch
        // pass into a latch-shaped hold.
        seedTrack('touch');
        seedLane([
            { beat: 4, value: 0.4 },
            { beat: 8, value: 0.6 },
        ]);
        beginPlayback(0);
        recordAutomationValue(TRACK_ID, 'gain', 0.5, 1);
        recordAutomationValue(TRACK_ID, 'gain', 0.8, 2);

        stopAutomationRecording(8);

        const points = recordedPoints();
        expect(points.find((point) => point.beat === 4)?.value).toBe(0.4);
        expect(points.find((point) => point.beat === 8)?.value).toBe(0.6);
        expect(points.find((point) => point.beat === 1)?.value).toBe(0.5);
        expect(points.find((point) => point.beat === 2)?.value).toBe(0.8);
        // No held point beyond the last gesture: beat 8 keeps the old curve's
        // value, not the released touch value.
        expect(points.some((point) => point.beat === 8 && point.value === 0.8)).toBe(false);
    });
});
