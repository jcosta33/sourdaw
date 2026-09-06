/**
 * Put the project's clip material in the native sample pool before anyone
 * presses play (#3068).
 *
 * The ordering constraint is absolute: a `schedule-clip` naming a sample the
 * pool does not hold is refused by name, and a refusal is whole-batch, so the
 * session would start with no topology at all. The *cost* constraint is what
 * makes this a separate pass — a project's decoded PCM is tens of megabytes,
 * and pushing it across the bridge at the play gesture is a musician waiting
 * for the first frame (`createNativeLiveGraphBackend`'s header states both).
 *
 * So the material goes early and the memo in `nativeTimelineSamplePool` makes
 * the same call at the gesture find nothing left to send. Correctness does not
 * depend on this having run: `startNativeLiveGraphSession` registers its own
 * batch's material before applying it, and a prime that never happened costs
 * only the wait it existed to remove.
 *
 * The commands are projected, not guessed. Asking `readLiveGraphProgramme` for
 * the very batch that will play and collecting its sources is what makes the
 * primed set and the played set the same set by construction, rather than two
 * rules about which buffers a project needs.
 */

import { logger } from '#/infra/logger/appLogger';

import { registerNativeTimelineSamples } from '../../repositories/nativeGraph/nativeTimelineSamplePool';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';

import { projectLiveGraphTopology } from './projectLiveGraphTopology';
import { readLiveGraphProgramme } from './readLiveGraphProgramme';
import { readLiveStripTracks } from './readLiveStripTracks';

export type PrimeNativeTimelineSamplesInput = Readonly<{
    /** The frame grid the programme is placed on — see `readLiveGraphProgramme`. */
    sampleRate: number;
}>;

export type PrimeNativeTimelineSamplesResult =
    Readonly<{ outcome: 'primed'; sampleIds: readonly string[] }> | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * The commands whose material this prime owes the pool.
 *
 * The whole batch rather than the `schedule-clip` commands alone, because
 * `collectBufferedClipSources` reads a batch and reading the same shape here
 * keeps the prime and the session on one input.
 */
function projectLiveProgrammeBatch(sampleRate: number): ReturnType<typeof projectLiveGraphTopology> {
    const stripTracks = readLiveStripTracks();
    return projectLiveGraphTopology({
        stripTracks,
        // The prime cares about material, not about mix state or which chains
        // the engine can build: neither changes a source id, and both arrive at
        // their real values with the batch the session actually sends.
        soloGatedTrackIds: new Set(),
        vcaMultiplierByTrackId: new Map(),
        attachedInstanceIds: new Set(),
        inputMonitoredTrackIds: new Set(),
        transport: { playing: false, positionSeconds: 0 },
        masterGain: 1,
        // Shadowed, so the batch carries the whole programme whatever the
        // carrier law says: this pass registers material and must not miss the
        // clips of a strip Web Audio happens to be carrying today.
        monitor: 'shadowed',
        // No attach state either, for the same reason: a MIDI strip's notes
        // register no material whichever engine voices them.
        programme: readLiveGraphProgramme({ stripTracks, attachedInstanceIds: new Set(), sampleRate }),
    });
}

export async function primeNativeTimelineSamples(
    input: PrimeNativeTimelineSamplesInput
): Promise<PrimeNativeTimelineSamplesResult> {
    const commands = projectLiveProgrammeBatch(input.sampleRate);
    if (!commands.some((command) => command.kind === 'schedule-clip')) {
        // Nothing to register, and therefore no reason to spend the probe's
        // bridge round trip — this runs on every project edit.
        return { outcome: 'primed', sampleIds: [] };
    }
    const availability = await probeNativeGraphTransport();
    if (!availability.available) {
        return { outcome: 'declined', reason: availability.reason };
    }
    const registered = await registerNativeTimelineSamples({ transport: availability.transport, commands });
    if (registered.outcome === 'declined') {
        logger.debug(`[AudioEngine] native timeline sample prime declined: ${registered.reason}`);
        return registered;
    }
    return { outcome: 'primed', sampleIds: registered.sampleIds };
}
