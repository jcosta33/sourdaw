import { resolveClipLoopPassGrid } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiNote } from '../models/MidiNote';

import { projectClipMidiEvents } from './grooveTemplates/projectClipMidiEvents';
import { type readPianoRollSelection } from './readPianoRollSelection';

/** Bounded read hints only; source ownership and the query still decide what can be read. */
export function locatePianoRollSelectionWindows(
    clip: {
        id: string;
        startBeat: number;
        endBeat: number;
        midiOffsetBeats?: number;
        loopEnabled?: boolean;
        loopLength?: number;
        loopOriginBeat?: number;
    },
    owner: ReturnType<typeof readPianoRollSelection>['owners'][number],
    source: MidiNote | undefined
) {
    const displayBeat = clip.startBeat + owner.displayedStartBeat - (clip.midiOffsetBeats ?? 0);
    if (!Number.isFinite(displayBeat) || !Number.isFinite(owner.displayedDuration) || owner.displayedDuration <= 0) {
        return [];
    }
    const beats: number[] = [];
    if (owner.takeId !== undefined) {
        beats.push(displayBeat);
    } else {
        if (!source) {
            return [];
        }
        const expansion = projectClipLoopExpansion({
            clipDurationBeats: clip.endBeat - clip.startBeat,
            configuredLoopLengthBeats: clip.loopLength,
            loopEnabled: clip.loopEnabled ?? false,
        });
        const grid = resolveClipLoopPassGrid({
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            loopOriginBeat: clip.loopOriginBeat,
            loopEnabled: clip.loopEnabled ?? false,
            loopLengthBeats: expansion.loopLengthBeats,
            iterationCount: expansion.iterationCount,
        });
        const atDisplay = Math.floor((displayBeat - grid.firstPassStartBeat) / expansion.loopLengthBeats);
        if (!Number.isSafeInteger(atDisplay)) {
            return [];
        }
        const passes = new Set([0, atDisplay - 1, atDisplay, atDisplay + 1]);
        for (const pass of passes) {
            if (pass < 0 || pass >= grid.passCount) {
                continue;
            }
            const iterationStartBeat = grid.firstPassStartBeat + pass * expansion.loopLengthBeats;
            if (
                !Number.isFinite(iterationStartBeat) ||
                iterationStartBeat + expansion.loopLengthBeats <= iterationStartBeat
            ) {
                return [];
            }
            for (const event of projectClipMidiEvents({
                events: [source],
                clipId: clip.id,
                clipStartBeat: clip.startBeat,
                clipEndBeat: clip.endBeat,
                iterationStartBeat,
                loopLengthBeats: expansion.loopLengthBeats,
                midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                loopEnabled: clip.loopEnabled,
                loopOriginBeat: clip.loopOriginBeat,
            })) {
                beats.push(event.startBeat);
            }
        }
    }
    return Array.from(
        new Set(
            beats
                .filter((beat) => Number.isFinite(beat) && beat < clip.endBeat)
                .map((beat) => Math.max(clip.startBeat, Math.floor(beat / 4) * 4))
        )
    )
        .map((startBeat) => ({ startBeat, endBeat: Math.min(clip.endBeat, startBeat + 4) }))
        .filter((window) => window.endBeat > window.startBeat);
}
