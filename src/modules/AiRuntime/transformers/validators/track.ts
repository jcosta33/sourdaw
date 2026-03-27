import { clampNumber, type AppAction } from './shared';

type Payload = Record<string, unknown>;

export function validateTrackAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'addTrack': {
            const name = typeof payload.name === 'string' ? payload.name : `Track`;
            const kind = (['audio', 'midi', 'bus'] as const).includes(payload.kind as 'audio')
                ? (payload.kind as 'audio' | 'midi' | 'bus')
                : 'audio';
            return { type: 'addTrack', payload: { name, kind } };
        }
        case 'removeTrack':
        case 'freezeTrack':
        case 'unfreezeTrack':
        case 'bounceInPlace':
        case 'duplicateTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return { type, payload: { trackId: payload.trackId } } as AppAction;
        }
        case 'renameTrack': {
            if (typeof payload.trackId !== 'string' || typeof payload.name !== 'string') {
                return null;
            }
            return {
                type: 'renameTrack',
                payload: { trackId: payload.trackId, name: payload.name },
            };
        }
        case 'selectTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return { type: 'selectTrack', payload: { trackId: payload.trackId } };
        }
        case 'muteTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'muteTrack',
                payload: { trackId: payload.trackId, muted: payload.muted !== false },
            };
        }
        case 'soloTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'soloTrack',
                payload: { trackId: payload.trackId, soloed: payload.soloed !== false },
            };
        }
        case 'armTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'armTrack',
                payload: { trackId: payload.trackId, armed: payload.armed !== false },
            };
        }
        case 'setTrackGain': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackGain',
                payload: { trackId: payload.trackId, gain: clampNumber(payload.gain, 0, 1, 0.8) },
            };
        }
        case 'setTrackPan': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackPan',
                payload: { trackId: payload.trackId, pan: clampNumber(payload.pan, -50, 50, 0) },
            };
        }
        case 'setTrackColor': {
            if (typeof payload.trackId !== 'string' || typeof payload.color !== 'string') {
                return null;
            }
            return {
                type: 'setTrackColor',
                payload: { trackId: payload.trackId, color: payload.color },
            };
        }
        case 'reorderTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'reorderTrack',
                payload: { trackId: payload.trackId, newIndex: clampNumber(payload.newIndex, 0, 100, 0) },
            };
        }
        case 'hideTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'hideTrack',
                payload: { trackId: payload.trackId, hidden: payload.hidden !== false },
            };
        }
        case 'disableTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'disableTrack',
                payload: { trackId: payload.trackId, disabled: payload.disabled !== false },
            };
        }
        case 'setTrackHeight': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackHeight',
                payload: { trackId: payload.trackId, height: clampNumber(payload.height, 20, 400, 80) },
            };
        }
        case 'foldTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'foldTrack',
                payload: { trackId: payload.trackId, folded: payload.folded !== false },
            };
        }
        case 'groupTracks': {
            const trackIds = Array.isArray(payload.trackIds)
                ? (payload.trackIds as unknown[]).filter((id): id is string => typeof id === 'string')
                : [];
            if (trackIds.length < 2) {
                return null;
            }
            return {
                type: 'groupTracks',
                payload: {
                    trackIds,
                    name: typeof payload.name === 'string' ? payload.name : 'Group',
                },
            };
        }
        case 'ungroupTracks': {
            if (typeof payload.groupId !== 'string') {
                return null;
            }
            return { type: 'ungroupTracks', payload: { groupId: payload.groupId } };
        }
        case 'setTrackNotes': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackNotes',
                payload: {
                    trackId: payload.trackId,
                    notes: typeof payload.notes === 'string' ? payload.notes : '',
                },
            };
        }
        case 'bounceToNewTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return { type: 'bounceToNewTrack', payload: { trackId: payload.trackId } };
        }
        default:
            return undefined; // not handled by this module
    }
}
