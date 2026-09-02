/**
 * Open a pass of live automation over the region the session is playing
 * (#3068, D3.c.4b).
 *
 * ── The region ────────────────────────────────────────────────────────────
 *
 * A loop the engine will actually wrap is the region, whole, because the
 * engine walks that region over and over and the writer has to be able to
 * re-send it at every seam. Otherwise the region runs from where this pass
 * begins to where the session's programme ends: automation past the last thing
 * the engine plays reaches nobody, and the session is the only thing that
 * knows where that is.
 *
 * The producer clips a segment crossing the region end at its own slope rather
 * than dropping it, so the region bound is expressed once, here, and nothing
 * downstream re-derives it.
 *
 * ── Clipping the seam, once ───────────────────────────────────────────────
 *
 * A ramp is never split, so a looped region drops a write still gliding at the
 * loop end rather than sending a trajectory the wrap will cancel mid-flight.
 * That is a property of the region, not of a moment in it, so it is applied
 * here — where the region is fixed for the life of the pass — instead of being
 * re-decided on every pump against numbers that cannot have changed.
 *
 * ── Why it does not await its own first pump ──────────────────────────────
 *
 * Every caller runs inside the session's serialised command chain, and the
 * pump queues on that same chain. Awaiting it here would wait for the work
 * that is currently running to finish, which is this work.
 */

import { logger } from '#/infra/logger/appLogger';
import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';

import {
    nativeLiveAutomationWriter,
    writeStartSeconds,
    type LiveAutomationWriterTarget,
} from './nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { pumpNativeLiveAutomationWriter } from './pumpNativeLiveAutomationWriter';
import { readLiveAutomationWrites } from './readLiveAutomationWrites';

export type ArmNativeLiveAutomationWriterInput = Readonly<{
    /** The strips the session's topology built — the only ones a write may address. */
    stripTracks: readonly Track[];
    /** The frame grid this session's programme is placed on. */
    sampleRate: number;
    /** Where the session's programme ends, on the engine clock. */
    programmeEndSeconds: number;
    /** Where this pass begins, on the engine clock. */
    positionSeconds: number;
}>;

type PassRegion = Readonly<{ startSeconds: number; endSeconds: number; looping: boolean }>;

function passRegion(input: ArmNativeLiveAutomationWriterInput): PassRegion {
    const { loopRegion, loopEnabled } = nativeLiveGraphSession;
    if (loopEnabled && loopRegion) {
        return { startSeconds: loopRegion.startSeconds, endSeconds: loopRegion.endSeconds, looping: true };
    }
    return { startSeconds: input.positionSeconds, endSeconds: input.programmeEndSeconds, looping: false };
}

/** Where a write's value arrives: a ramp's landing, any other shape's own stamp. */
function writeLandSeconds(write: AudioGraphParameterWrite): number {
    if (write.shape === 'ramp-to') {
        return write.landTime;
    }
    return write.time;
}

function orderedWrites(
    writes: readonly AudioGraphParameterWrite[],
    region: PassRegion
): readonly AudioGraphParameterWrite[] {
    const ordered = [...writes].sort((left, right) => writeStartSeconds(left) - writeStartSeconds(right));
    if (!region.looping) {
        return ordered;
    }
    return ordered.filter((write) => writeLandSeconds(write) <= region.endSeconds);
}

export function armNativeLiveAutomationWriter(input: ArmNativeLiveAutomationWriterInput): void {
    const region = passRegion(input);
    const { entries, exclusions } = readLiveAutomationWrites({
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        regionStartSeconds: region.startSeconds,
        regionEndSeconds: region.endSeconds,
    });
    // The producer drops what it cannot carry so one lane cannot silence a
    // strip, but a drop nobody says out loud is a fader that stops moving with
    // no account of why. This is where the automation is applied, so this is
    // where its cost is stated.
    for (const exclusion of exclusions) {
        logger.warn(
            `[AudioEngine] live automation excluded ${exclusion.subjectId} on strip ` +
                `${exclusion.stripId}: ${exclusion.reason}`
        );
    }

    const targets = entries
        .map((entry): LiveAutomationWriterTarget => {
            return { target: entry.target, writes: orderedWrites(entry.writes, region), cursor: 0 };
        })
        .filter((slot) => slot.writes.length > 0);

    nativeLiveAutomationWriter.epoch += 1;
    nativeLiveAutomationWriter.pass = {
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        programmeEndSeconds: input.programmeEndSeconds,
        regionStartSeconds: region.startSeconds,
        regionEndSeconds: region.endSeconds,
        looping: region.looping,
        targets,
        lastLoopWraps: null,
    };

    void pumpNativeLiveAutomationWriter({ positionSeconds: input.positionSeconds, loopWraps: null });
}
