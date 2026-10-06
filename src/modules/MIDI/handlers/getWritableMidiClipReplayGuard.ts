import { trackStore } from '#/modules/Arrangement/stores';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

type AddClipAction = Extract<AppAction, { type: 'addClip' }>;
type AddTrackAction = Extract<AppAction, { type: 'addTrack' }>;

type LiveTrack = NonNullable<typeof trackStore.value>['tracks'][number];
type LiveClip = LiveTrack['clips'][number];

function getLiveTarget(
    clipId: string
): { status: 'missing' } | { status: 'ambiguous' } | { status: 'found'; track: LiveTrack; clip: LiveClip } {
    let target: { track: LiveTrack; clip: LiveClip } | null = null;
    for (const track of trackStore.value?.tracks ?? []) {
        for (const clip of track.clips) {
            if (clip.id !== clipId) {
                continue;
            }
            if (target) {
                return { status: 'ambiguous' };
            }
            target = { track, clip };
        }
    }
    return target ? { status: 'found', ...target } : { status: 'missing' };
}

function getLatestEarlierClipProducer(clipId: string, context: HandlerValidationContext): AddClipAction | null {
    for (let index = context.actionIndex - 1; index >= 0; index -= 1) {
        const action = context.actions[index];
        if (action?.type === 'addClip' && action.payload.id === clipId) {
            return action;
        }
    }
    return null;
}

function getLatestEarlierTrackProducer(trackId: string, context: HandlerValidationContext): AddTrackAction | null {
    for (let index = context.actionIndex - 1; index >= 0; index -= 1) {
        const action = context.actions[index];
        if (action?.type === 'addTrack' && action.payload.id === trackId) {
            return action;
        }
    }
    return null;
}

export function getWritableMidiClipReplayGuardForBatch(
    clipId: string,
    context?: HandlerValidationContext
): {
    trackId: string;
    expectedTrackFrozen: false;
    expectedClipLocked: false;
} | null {
    const liveTarget = getLiveTarget(clipId);
    if (liveTarget.status === 'ambiguous') {
        return null;
    }
    if (liveTarget.status === 'found') {
        const { track, clip } = liveTarget;
        if (track.kind !== 'midi' || clip.type !== 'midi' || track.frozen === true || clip.locked === true) {
            return null;
        }
        return {
            trackId: track.id,
            expectedTrackFrozen: false,
            expectedClipLocked: false,
        };
    }
    if (!context) {
        return null;
    }

    const clipProducer = getLatestEarlierClipProducer(clipId, context);
    if (!clipProducer || clipProducer.payload.type !== 'midi' || clipProducer.payload.locked === true) {
        return null;
    }

    const trackId = clipProducer.payload.trackId;
    const liveTrack = trackStore.value?.tracks.find((track) => track.id === trackId);
    if (liveTrack) {
        if (liveTrack.kind !== 'midi' || liveTrack.frozen === true) {
            return null;
        }
    } else {
        const trackProducer = getLatestEarlierTrackProducer(trackId, context);
        if (!trackProducer || trackProducer.payload.kind !== 'midi') {
            return null;
        }
    }

    return {
        trackId,
        expectedTrackFrozen: false,
        expectedClipLocked: false,
    };
}
