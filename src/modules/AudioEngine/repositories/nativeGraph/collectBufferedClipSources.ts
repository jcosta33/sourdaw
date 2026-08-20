/**
 * The material half of the wire split `serializeAudioGraphCommand` states:
 * the wire carries clip *identities*, and the decoded buffers collected here
 * are what the backend registers into the native sample pool before the batch
 * crosses.
 */

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

export type BufferedClipSource = Readonly<{
    sourceId: string;
    buffer: AudioBuffer;
}>;

/**
 * Every distinct clip source in `commands` that carries its decoded buffer,
 * first appearance wins.
 *
 * A source whose material never reached the pool is refused by the native
 * side by name (`schedule-clip: unknown sample`), not played as silence.
 */
export function collectBufferedClipSources(commands: readonly AudioGraphCommand[]): BufferedClipSource[] {
    const seen = new Set<string>();
    const sources: BufferedClipSource[] = [];
    for (const command of commands) {
        if (command.kind !== 'schedule-clip') {
            continue;
        }
        const { sourceId, buffer } = command.playback.source;
        if (buffer === undefined || seen.has(sourceId)) {
            continue;
        }
        seen.add(sourceId);
        sources.push({ sourceId, buffer });
    }
    return sources;
}
