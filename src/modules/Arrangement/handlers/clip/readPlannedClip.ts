import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

/** The action types whose effect on a clip's fields `projectTrackAction` projects exactly. */
const PROJECTED_CLIP_ACTION_TYPES: ReadonlySet<AppAction['type']> = new Set<AppAction['type']>([
    'renameClip',
    'muteClip',
    'lockClip',
    'setClipColor',
    'setClipFade',
    'setClipGain',
    'trimClipEnd',
    'nudgeClip',
    'trimClipStart',
    'slipClipContent',
]);

/** Actions that rewrite clips without naming them: time ranges, whole projects and replayed history. */
const CLIP_WIDE_ACTION_TYPES: ReadonlySet<AppAction['type']> = new Set<AppAction['type']>([
    'deleteTime',
    'insertTime',
    'duplicateTimeRange',
    'stripSilence',
    'consolidateSelection',
    'consolidateAllTracks',
    'bounceSelection',
    'cutClip',
    'pasteClip',
    'importMidiFile',
    'importAudioFile',
    'loadPreset',
    'removeAllTracks',
    'restoreTracks',
    'restoreTrackClipStates',
    'restoreTimeOperationState',
    'newProject',
    'undo',
    'redo',
    'playMacro',
    'restoreProjectVersion',
    'applyGroove',
    'quantizeTransients',
    'autoFixMix',
    'autoOrganizeProject',
    'stemSeparate',
    'repairProjectData',
]);

/** Actions that rewrite the clips a track holds and name only the track. */
const TRACK_CLIP_ACTION_TYPES: ReadonlySet<AppAction['type']> = new Set<AppAction['type']>([
    'discardCreatedTrack',
    'flattenTrack',
    'bounceInPlace',
    'freezeTrack',
    'unfreezeTrack',
    'restoreFreezeState',
    'restoreTrack',
    'switchTrackAlternative',
    'deleteTrackAlternative',
    'restoreTrackAlternativeState',
    'createCompGroup',
    'discardCreatedCompGroup',
]);

function mentions(value: unknown, clipId: string): boolean {
    if (value === clipId) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.some((item) => mentions(item, clipId));
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value).some((item) => mentions(item, clipId));
    }
    return false;
}

function projectsClip(action: AppAction, clip: Clip): boolean {
    if (!PROJECTED_CLIP_ACTION_TYPES.has(action.type)) {
        return false;
    }
    // Audio trims and slips read captured source state that the projection does not carry.
    if (action.type === 'trimClipStart') {
        return clip.type !== 'audio';
    }
    if (action.type === 'slipClipContent') {
        return action.payload.clipType === 'midi' && clip.type !== 'audio';
    }
    return true;
}

/** Whether every earlier action of the batch that touches the clip is one whose result the plan projects. */
function plansEarlierActions(clip: Clip, context: HandlerValidationContext): boolean {
    return context.actions.slice(0, context.actionIndex).every((action) => {
        if (CLIP_WIDE_ACTION_TYPES.has(action.type)) {
            return false;
        }
        const touchesTrack = TRACK_CLIP_ACTION_TYPES.has(action.type) && mentions(action.payload, clip.trackId);
        if (!touchesTrack && !mentions(action.payload, clip.id)) {
            return true;
        }
        return !touchesTrack && projectsClip(action, clip);
    });
}

/**
 * The clip as the batch's earlier actions leave it when a context is given, otherwise as the store
 * holds it now. A second edit of one clip in a batch plans against the first edit's result. When an
 * earlier action touched the clip in a way the plan does not project (a move, a split, an audio trim,
 * a removal), the plan is unknown and the clip reads as absent, so a guarded edit records no
 * compensation and the batch refuses it rather than recording a guard it cannot meet.
 */
export function readPlannedClip(clipId: string, context?: HandlerValidationContext): Clip | undefined {
    const live = getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
    if (!live || !context) {
        return live;
    }
    if (!plansEarlierActions(live, context)) {
        return undefined;
    }
    return getPlannedTrackState(context, live.trackId)?.clips.find((candidate) => candidate.id === clipId);
}

/** Whether an earlier action of the batch names the clip, so a capture of the live clip would be stale. */
export function clipEditedEarlierInBatch(clipId: string, context?: HandlerValidationContext): boolean {
    return context?.actions.slice(0, context.actionIndex).some((action) => mentions(action.payload, clipId)) ?? false;
}
