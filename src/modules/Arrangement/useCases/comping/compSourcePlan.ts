import { type AppAction, type HandlerMaterializationContext } from '#/utils/handlerContract';

import { type Clip, type Track } from '../../models/Track';
import { type CompAudioSourceInputContext } from '../../stores/compAudioSourceInputs';
import { getTrackStoreState } from '../getTrackStoreState';

import { liveCompAudioSourceInputs } from './liveCompAudioSourceInputs';
import { projectSourceTracksThroughAction } from './projectSourceTracksThroughAction';

export type TakeLanePrefixContext = HandlerMaterializationContext;

export type CompSourcePlan = { readonly clips: Clip[]; readonly inputs: CompAudioSourceInputContext };

function liveTracks(): Track[] {
    const current = getTrackStoreState()?.tracks;
    if (!current) {
        return [];
    }
    return [...current];
}

function prefixActions(context: TakeLanePrefixContext | undefined, limit: number): readonly AppAction[] {
    const actions = context?.preparedPrefix ?? context?.actions;
    return actions?.slice(0, limit) ?? [];
}

/** Track lifecycle prefixes already carry the real owner snapshot. Read its
 * normalized source shape; do not reconstruct clip edits or a tempo clock. */
export function sourceInputsAfterPrefix(
    trackId: string,
    context?: TakeLanePrefixContext,
    limit = context?.actionIndex ?? 0
): CompSourcePlan | null {
    const live = liveCompAudioSourceInputs();
    let tracks = liveTracks();
    for (const action of prefixActions(context, limit)) {
        const next = projectSourceTracksThroughAction(action, tracks);
        if (!next) {
            return null;
        }
        tracks = next;
    }
    return {
        clips: tracks.find((track) => track.id === trackId)?.clips ?? [],
        inputs: { ...live, tracks: { tracks } },
    };
}
