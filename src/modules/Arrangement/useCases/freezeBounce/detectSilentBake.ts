import { automationStore } from '#/modules/Automation/stores';

import { type Track } from '../../models/Track';
import { classifyRenderSilence } from '../../services/classifyRenderSilence';
import { isSilentAudioBuffer, type SilenceScannableBuffer } from '../../services/isSilentAudioBuffer';

import { type RenderScheduleTally } from './renderOffline';

/** The operation about to persist the buffer, named in the refusal message. */
export type SilentBakeOperation = 'Freeze' | 'Bounce';

export type DetectSilentBakeInput = {
    track: Track;
    buffer: SilenceScannableBuffer;
    /** What the render reported putting into the graph. */
    tally: RenderScheduleTally;
    /** See `classifyRenderSilence` — the fader this render bakes, not `track.gain`. */
    bakedFaderGain: number;
    /** Whether this render bakes the track's automation lanes into the samples. */
    bakesAutomation: boolean;
    operation: SilentBakeOperation;
};

export type DetectSilentBakeOutput = { silentBake: false } | { silentBake: true; message: string };

function hasEnabledAutomationLanes(trackId: string): boolean {
    const lanes = automationStore.value?.lanes ?? [];
    return lanes.some((lane) => lane.trackId === trackId && lane.enabled !== false && lane.points.length > 0);
}

function describeTally(tally: RenderScheduleTally): string {
    const parts: string[] = [];
    if (tally.scheduledNotes > 0) {
        parts.push(`${tally.scheduledNotes} note${tally.scheduledNotes === 1 ? '' : 's'}`);
    }
    if (tally.scheduledBuffers.length > 0) {
        parts.push(`${tally.scheduledBuffers.length} audio clip${tally.scheduledBuffers.length === 1 ? '' : 's'}`);
    }
    return parts.join(' and ');
}

/**
 * Refuse a render that came back as digital silence while the scheduler was
 * still feeding it.
 *
 * **Observation, not prediction.** Whether a clip contributes sound depends on
 * comping, region trimming, loop iteration, groove projection dropping notes
 * past a trimmed clip's own length, probability rolls and missing buffers — and
 * any re-implementation of that chain is a second source of truth that agrees
 * today and drifts tomorrow. This reads the scheduler's own tally instead.
 * "Nothing was scheduled" is legitimate silence whatever the reason, and the
 * reasons never have to be enumerated.
 *
 * **Mute and solo are deliberately absent.** `renderTrackSubgraphOffline`
 * passes `honorMuted: false` to both the strip build and the clip scheduler,
 * and never consults solo at all, because freeze and bounce produce deliverable
 * audio rather than a monitoring snapshot. A muted track's freeze is therefore
 * *supposed* to contain sound; excusing it would disengage the guard for every
 * muted track, and for every unsoloed track whenever a solo is up — which is
 * routine while freezing.
 *
 * **What it can actually catch** is narrower than "any silent export": an
 * instrument node that loads but emits zeros, a subgraph that resolves
 * disconnected, and a worklet whose offline setup leaves it inert. A device
 * that fails to *load* is dropped with a warning and a MIDI track then falls
 * back to the builtin synth, which is audible; an unrenderable catalog device
 * throws out of `buildDeviceChain` before any of this runs.
 *
 * **A withheld device is decided separately, and ahead of all of that.** It is
 * the one input here that is a fact rather than an inference — the build does
 * not contain the device — so it is read off the tally and refused before
 * `classifyRenderSilence` gets a chance to abstain over it.
 */
export function detectSilentBake({
    track,
    buffer,
    tally,
    bakedFaderGain,
    bakesAutomation,
    operation,
}: DetectSilentBakeInput): DetectSilentBakeOutput {
    // Cheapest first, then the output scan, then the per-source scans.
    // `isSilentAudioBuffer` returns at the first sample over the floor, so a
    // real render leaves here almost immediately and only a genuinely silent
    // one pays to read its sources.
    if (tally.scheduledNotes === 0 && tally.scheduledBuffers.length === 0) {
        return { silentBake: false };
    }
    if (!isSilentAudioBuffer(buffer)) {
        return { silentBake: false };
    }

    // Ahead of `classifyRenderSilence`, because every value that function
    // returns is an *abstention* — a reason to stand down when it cannot tell
    // what the audio should have been. A withheld device is not that kind of
    // uncertainty: the build does not contain the device, so this render can
    // never contain it either, and no curve or fader setting changes that.
    //
    // Left behind the abstentions it was unreachable in the ordinary case.
    // `freezeTrack` passes `bakesAutomation: true` unconditionally, and
    // `classifyRenderSilence` abstains on `bakesAutomation && hasAutomationLanes`
    // — one enabled lane with one point is enough. So a saved project with a
    // withheld instrument and a volume ride froze "successfully" over silence,
    // and `flattenTrack` then emptied the track's device list, dropping the
    // device reference the withholding exists to preserve.
    const withheldDeviceType = tally.withheldDeviceTypes[0];
    if (withheldDeviceType !== undefined) {
        return {
            silentBake: true,
            // Deliberately not the message below. That one ends "Play the track
            // back to confirm it sounds, then try again" — advice with no exit
            // here, because playback of a withheld device is silent too, so the
            // user would loop forever on a check that can never pass.
            message:
                `Track "${track.name}" uses the device "${withheldDeviceType}", which is withheld from this build ` +
                `and renders silent. ${operation} stopped rather than replacing the track with a buffer that does ` +
                `not contain it. Remove the device from the track to ${operation.toLowerCase()} it.`,
        };
    }

    const verdict = classifyRenderSilence({
        scheduledNotes: tally.scheduledNotes,
        scheduledBuffers: tally.scheduledBuffers,
        isSilentSource: isSilentAudioBuffer,
        bakedFaderGain,
        bakesAutomation,
        hasAutomationLanes: hasEnabledAutomationLanes(track.id),
    });
    if (!verdict.unexpected) {
        return { silentBake: false };
    }

    return {
        silentBake: true,
        message:
            `Track "${track.name}" rendered as digital silence even though ${describeTally(tally)} reached the ` +
            `render. ${operation} stopped rather than replacing the track with a silent buffer. Play the track ` +
            `back to confirm it sounds, then try again.`,
    };
}
