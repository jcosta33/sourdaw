import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

export function describeGluedClips(action: Extract<AppAction, { type: 'glueClips' }>, context: ProjectContext): string {
    const sources = action.payload.clipIds.flatMap((clipId) => {
        for (const track of context.tracks) {
            const clip = track.clips.find((candidate) => candidate.id === clipId);
            if (clip) {
                return [
                    {
                        description: `"${clip.name}" (${clip.id}, beats ${String(clip.startBeat)}–${String(clip.endBeat)})`,
                        track,
                    },
                ];
            }
        }
        return [];
    });
    const sourceTrack = sources[0]?.track;
    if (
        sources.length === action.payload.clipIds.length &&
        sourceTrack &&
        sources.every((source) => source.track.id === sourceTrack.id)
    ) {
        return `Glue MIDI clips ${sources.map((source) => source.description).join(' and ')} on MIDI track "${sourceTrack.name}" (${sourceTrack.id})`;
    }
    return 'Glue MIDI clips';
}
