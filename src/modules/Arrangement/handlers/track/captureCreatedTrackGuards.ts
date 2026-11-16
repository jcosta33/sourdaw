import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';

import { type GeneratedMidiStateGuard } from '../../events/arrangementClipSnapshots';
import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { type Track } from '../../stores/trackStore';
import { serializeClipScopedAutomationLanes } from '../../useCases/clip/serializeClipScopedAutomationLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type CreatedTrackGuard = { trackId: string; generatedMidiStateGuard: GeneratedMidiStateGuard };

function captureCreatedTrackGuard(track: Track): CreatedTrackGuard {
    const clipIds = collectTrackClipIds(track);
    return {
        trackId: track.id,
        generatedMidiStateGuard: {
            entityJson: JSON.stringify(track),
            midiByClipIdJson: serializeMidiStateForClips(clipIds),
            clipAutomationLanesJson: serializeClipScopedAutomationLanes(clipIds),
        },
    };
}

/**
 * The discard guards for tracks a command just created, read from the committed store
 * rows the discard will compare against. Null when any named track is missing, so the
 * caller emits no inverse rather than one that cannot name what it created.
 */
export function captureCreatedTrackGuards(trackIds: readonly string[]): CreatedTrackGuard[] | null {
    const tracks = getTrackStoreState()?.tracks ?? [];
    const guards: CreatedTrackGuard[] = [];
    for (const trackId of trackIds) {
        const track = tracks.find((candidate) => candidate.id === trackId);
        if (!track) {
            return null;
        }
        guards.push(captureCreatedTrackGuard(track));
    }
    return guards;
}
