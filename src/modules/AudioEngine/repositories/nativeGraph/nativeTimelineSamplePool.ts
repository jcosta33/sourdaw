/**
 * The native timeline sample pool, as this process knows it (#3068).
 *
 * `register_timeline_sample` carries decoded PCM across the bridge; a
 * `schedule-clip` carries only the identity, and the native side refuses one
 * whose sample the pool does not hold, by name, rather than playing silence.
 * So every live batch owes its material to the pool *first* — the ordering
 * `createNativeOfflineGraphBackend` already keeps for the export.
 *
 * The memo of what the pool already holds is process-wide
 * ({@link registeredNativeTimelineSampleIds}), and that is what makes a
 * *priming* pass possible: material registered while the project is being
 * edited is already there when play arrives, and the same call at the gesture
 * then finds nothing left to send. Ordering and cost are one mechanism rather
 * than two, so a prime that never ran costs correctness nothing — only the wait
 * it existed to avoid.
 */

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { collectBufferedClipSources } from './collectBufferedClipSources';
import { interleaveAudioBufferPcm } from './interleaveAudioBufferPcm';
import { type NativeGraphTransport } from './nativeGraphTransport';
import { registeredNativeTimelineSampleIds } from './registeredNativeTimelineSampleIds';

export type RegisterNativeTimelineSamplesInput = Readonly<{
    transport: NativeGraphTransport;
    /**
     * The batch whose material must be in the pool. Read through
     * `collectBufferedClipSources`, so what is registered is exactly what the
     * batch plays — never a second rule about which buffers a session needs.
     */
    commands: readonly AudioGraphCommand[];
}>;

export type RegisterNativeTimelineSamplesResult =
    | Readonly<{ outcome: 'registered'; sampleIds: readonly string[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * Put every source this batch plays into the native pool, skipping what is
 * already there. `sampleIds` is what this call actually sent, so a caller can
 * tell a prime that did work from one that found nothing to do.
 */
export async function registerNativeTimelineSamples(
    input: RegisterNativeTimelineSamplesInput
): Promise<RegisterNativeTimelineSamplesResult> {
    const { transport, commands } = input;
    const sent: string[] = [];
    for (const source of collectBufferedClipSources(commands)) {
        if (registeredNativeTimelineSampleIds.has(source.sourceId)) {
            continue;
        }
        try {
            const material = interleaveAudioBufferPcm(source);
            await transport.registerTimelineSample({
                sampleId: source.sourceId,
                sampleRate: source.buffer.sampleRate,
                channels: material.channels,
                pcm: material.pcm,
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { outcome: 'declined', reason: `register_timeline_sample "${source.sourceId}": ${reason}` };
        }
        registeredNativeTimelineSampleIds.add(source.sourceId);
        sent.push(source.sourceId);
    }
    return { outcome: 'registered', sampleIds: sent };
}
