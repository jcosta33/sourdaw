import { getAllTracks, addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { toasterStore } from '../stores/toasterStore';

import { projectToasterPatternGroove } from './projectToasterPatternGroove';
import { projectToasterStepEvents } from './projectToasterStepEvents';

type ExportPatternToTimelineResult =
    { ok: true } | Extract<ReturnType<typeof projectToasterPatternGroove>, { ok: false }>;

/**
 * Export the active pattern to the timeline as MIDI clips, one per pad lane.
 *
 * Fidelity decision (resolving the prior "lossy vs full-fidelity" Unknown):
 * the exporter is faithful to every musical dimension a plain MIDI note routed
 * to a pad can carry, baked at export time so the clip plays the same groove
 * the live sequencer plays:
 *   - microTiming  → baked into note start (matches `sequencerPlayback.tick`)
 *   - swing        → baked into odd-step note start (matches the player's
 *                    `swing * stepDuration * 0.5` push on odd steps)
 *   - retrigger    → emitted as extra notes with the player's decay-velocity
 *                    model (`vel * (1 - r * 0.12)`, floored)
 *   - meter        → clip length derived from the pattern's own step grid, not
 *                    a hard-coded 4 beats/bar
 * Dimensions a MIDI note cannot represent are intentionally NOT exported and
 * remain part of the live instrument only: per-step sound locks and param
 * locks (no per-note engine/param override exists on a MIDI note), per-step
 * `probability` and runtime `condition`s (`fill`/`first`/…), which depend on
 * play-time loop state and cannot be frozen into a static clip. (`addMidiNote`
 * also takes no probability argument, so a faithful export would have to widen
 * that surface; out of scope here.)
 */
export function exportPatternToTimeline(deviceId: string): ExportPatternToTimelineResult {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return { ok: true };
    }

    const pattern = state.kit.patterns.find((param) => param.id === state.kit.activePatternId);
    if (!pattern) {
        return { ok: true };
    }

    const grooveCapability = projectToasterPatternGroove({
        deviceId,
        patternId: pattern.id,
        stepsPerBar: pattern.stepsPerBar,
        events: [],
    });
    if (!grooveCapability.ok) {
        return grooveCapability;
    }

    const tracks = getAllTracks();
    const parentTrack = tracks.find((t) => t.devices.some((d) => d.id === deviceId));
    if (!parentTrack) {
        return { ok: true };
    }

    // Child tracks in the parent's creation order. createDrumTrackStack pushes
    // one child per pad in pad order, so the Nth child IS pad N — map by that
    // pad identity, not by a raw filtered array index that would silently
    // misalign if the child set were ever sparse.
    const childTracksByPad = new Map<number, (typeof tracks)[number]>();
    let padOrdinal = 0;
    for (const track of tracks) {
        if (track.parentId === parentTrack.id) {
            childTracksByPad.set(padOrdinal, track);
            padOrdinal += 1;
        }
    }

    const stepsPerBar = pattern.stepsPerBar;
    const totalSteps = stepsPerBar * pattern.bars;
    const stepDurationBeats = 4 / stepsPerBar;
    const insertAt = playheadPositionRef.current; // beats — place pattern at playhead
    const swing = state.kit.swing;

    for (const track of pattern.tracks) {
        const childTrack = childTracksByPad.get(track.padIndex);
        if (!childTrack) {
            continue;
        }

        // Polymetric tracks use their own step count; the clip spans the pad's
        // full loop length in beats derived from that grid (meter-aware — no
        // hard-coded 4 beats/bar).
        const numSteps = track.stepsOverride ?? totalSteps;
        const hasActiveSteps = track.steps.slice(0, numSteps).some((step) => step.active);
        if (!hasActiveSteps) {
            continue;
        }

        const clipLength = numSteps * stepDurationBeats;
        const clip = addClip({
            trackId: childTrack.id,
            startBeat: insertAt,
            endBeat: insertAt + clipLength,
            name: childTrack.name,
            type: 'midi',
        });
        if (!clip) {
            continue;
        }
        const clipId = clip.id;
        const midiNote = 36 + track.padIndex;

        // Add MIDI notes for each active step using the same projection as the
        // live sequencer so timing, dynamics, swing, and retriggers stay in sync.
        for (let stepIdx = 0; stepIdx < numSteps; stepIdx++) {
            const step = track.steps[stepIdx];
            if (!step?.active) {
                continue;
            }
            const projection = projectToasterStepEvents({
                deviceId,
                patternId: pattern.id,
                stepsPerBar,
                loopLengthBeats: clipLength,
                padIndex: track.padIndex,
                stepIndex: stepIdx,
                step,
                swing,
            });
            if (!projection.ok) {
                return projection;
            }
            for (const hit of projection.hits) {
                addMidiNote(clipId, midiNote, hit.startBeat, hit.durationBeats, hit.velocity);
            }
        }
    }
    return { ok: true };
}
