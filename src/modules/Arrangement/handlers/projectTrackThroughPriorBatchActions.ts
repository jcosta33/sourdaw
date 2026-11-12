import { CLIP_GAIN_LAW, resolveLevelFields, SEND_LEVEL_LAW, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../stores/trackStore';
import { clampClipGain } from '../transformers/clampClipGain';
import { getPlatformPlugins } from '../useCases/getPlatformPlugins';
import { clampTrackGain } from '../useCases/setTrackGainPan/clampTrackGain';

import { projectDeviceChainAction } from '../models/projectDeviceChainAction';

export function projectTrackThroughPriorBatchActions(track: Track, context: HandlerValidationContext): Track {
    const projected = structuredClone(track);
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.payload && 'trackId' in action.payload && action.payload.trackId !== projected.id) {
            continue;
        }
        const devices = projectDeviceChainAction(
            projected.id,
            projected.devices,
            action,
            action.type === 'addDevice' ? getPlatformPlugins() : []
        );
        if (devices !== null) {
            projected.devices = devices;
            continue;
        }
        if (action.type === 'discardDuplicatedClip') {
            projected.clips = projected.clips.filter((clip) => clip.id !== action.payload.clipId);
            continue;
        }
        if (action.type === 'setTrackGain') {
            // A batch that lowers the same fader twice has to compound: the second
            // action's `deltaDb` is relative to what the first one left behind, not
            // to what the store held before the batch began.
            const resolved = resolveLevelFields(
                {
                    linear: action.payload.gain,
                    absoluteDb: action.payload.gainDb,
                    deltaDb: action.payload.deltaDb,
                },
                projected.gain,
                TRACK_FADER_LAW
            );
            // The writer clamps a resolved gain on write (`clampTrackGain`), so the
            // projection must clamp it too, the same way the clip arm below clamps
            // its own resolved gain — otherwise a later action in the batch would
            // plan against a gain the store could never actually hold.
            if (resolved.ok) {
                projected.gain = clampTrackGain(resolved.linear);
            }
        } else if (action.type === 'renameTrack') {
            projected.name = action.payload.name;
        } else if (action.type === 'setTrackColor') {
            projected.color = action.payload.color;
        } else if (action.type === 'setTrackPan') {
            projected.pan = action.payload.pan;
        } else if (action.type === 'setAutomationMode') {
            projected.automationMode = action.payload.mode;
        } else if (action.type === 'muteTrack') {
            projected.muted = action.payload.muted;
        } else if (action.type === 'soloTrack') {
            projected.soloed = action.payload.soloed;
        } else if (action.type === 'setTrackOutput') {
            projected.outputId = action.payload.outputId;
        } else if (action.type === 'addSend') {
            // The send does not exist yet, so a relative request measures from
            // unity — the same reference `handleAddSend` writes against.
            const resolved = resolveLevelFields(
                {
                    linear: action.payload.level,
                    absoluteDb: action.payload.levelDb,
                    deltaDb: action.payload.deltaDb,
                },
                SEND_LEVEL_LAW.unity,
                SEND_LEVEL_LAW
            );
            if (resolved.ok) {
                projected.sends.push({
                    busId: action.payload.busId,
                    level: resolved.linear,
                    preFader: action.payload.preFader ?? false,
                });
            }
        } else if (action.type === 'setSend') {
            // A batch that adjusts the same send twice has to compound the same
            // way a repeated `setTrackGain` does: the second action's `deltaDb` is
            // relative to what the first one left the send at.
            const send = projected.sends.find((candidate) => candidate.busId === action.payload.busId);
            if (send) {
                const resolved = resolveLevelFields(
                    {
                        linear: action.payload.level,
                        absoluteDb: action.payload.levelDb,
                        deltaDb: action.payload.deltaDb,
                    },
                    send.level,
                    SEND_LEVEL_LAW
                );
                if (resolved.ok) {
                    send.level = resolved.linear;
                }
            }
        } else if (action.type === 'setClipGain') {
            // A clip payload carries no `trackId`, so the leading skip above never
            // fires for it; match the clip by id across whichever track holds it.
            const clip = projected.clips.find((candidate) => candidate.id === action.payload.clipId);
            if (clip) {
                const resolved = resolveLevelFields(
                    {
                        linear: action.payload.gain,
                        absoluteDb: action.payload.gainDb,
                        deltaDb: action.payload.deltaDb,
                    },
                    clip.gain,
                    CLIP_GAIN_LAW
                );
                // The writer clamps a resolved gain on write, so the projection must
                // clamp it too or a later action in the batch would plan against a
                // gain the store could never actually hold.
                if (resolved.ok) {
                    clip.gain = clampClipGain(resolved.linear);
                }
            }
        } else if (action.type === 'removeSend') {
            projected.sends = projected.sends.filter((send) => send.busId !== action.payload.busId);
        }
    }
    return projected;
}
