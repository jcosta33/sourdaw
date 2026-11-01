import { type AppAction } from '#/utils/handlerContract';

import { projectClipReplayPrefix } from './clipEditing/projectClipReplayPrefix';
import { prepareTempoAudioSourceWrite } from './comping/prepareTempoAudioSourceWrite';

export function canApplyTempoAudioSources(
    input: Parameters<typeof prepareTempoAudioSourceWrite>[0],
    priorActions: readonly AppAction[] = []
): boolean {
    if (priorActions.length > 0) {
        const prefix = projectClipReplayPrefix(priorActions);
        if (!prefix?.tracks) {
            return false;
        }
        return (
            prepareTempoAudioSourceWrite({
                ...input,
                owners: { tracks: prefix.tracks, lanes: prefix.takeLanes },
            }) !== null
        );
    }
    return prepareTempoAudioSourceWrite(input) !== null;
}
