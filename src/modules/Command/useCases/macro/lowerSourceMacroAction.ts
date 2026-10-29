import { readTempoAtBeat } from '#/modules/Transport/stores';
import { resolveAudioUnwrappedOffsetSeconds } from '#/utils/audioSourceTime';
import { type AppAction } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { getCommandHandler } from '../getCommandHandler';

/** Exact history captures supply intent to macros, never authority over today's source owners. */
export function lowerSourceMacroAction(action: AppAction, tempoIds: ReadonlyMap<string, string>): AppAction {
    if (
        action.type === 'restoreAudioClipSlip' ||
        action.type === 'restoreAudioClipStartTrim' ||
        action.type === 'restoreTempoEdit'
    ) {
        if (!getCommandHandler(action)?.validateSessionActionArguments?.(action.payload)) {
            throw new AppActionConflictError(action.type, 'Invalid captured macro source action');
        }
        if (action.type === 'restoreAudioClipStartTrim') {
            const clip = action.payload.direction === 'restore' ? action.payload.before : action.payload.after;
            return { type: 'trimClipStart', payload: { clipId: action.payload.clipId, newStartBeat: clip.startBeat } };
        }
        if (action.type === 'restoreAudioClipSlip') {
            const { before, clock, direction } = action.payload;
            const tempo = readTempoAtBeat({ beat: before.clip.startBeat, clock });
            const offset =
                direction === 'apply'
                    ? action.payload.offset
                    : (resolveAudioUnwrappedOffsetSeconds(before.clip, tempo) * tempo) / 60;
            return { type: 'slipClipContent', payload: { clipId: action.payload.clipId, clipType: 'audio', offset } };
        }
        const target = action.payload.tempoChangeId;
        return {
            type: 'setTempo',
            payload: {
                bpm: action.payload.bpm,
                tempoChangeId: target === null ? null : (tempoIds.get(target) ?? target),
            },
        };
    }
    const replay = structuredClone(action);
    if (replay.type === 'setTempo') {
        delete replay.payload.expectedBpm;
        delete replay.payload.audioSourcePromotion;
        const target = replay.payload.tempoChangeId;
        if (typeof target === 'string') {
            replay.payload.tempoChangeId = tempoIds.get(target) ?? target;
        }
    }
    return replay;
}
