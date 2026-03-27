import { clampNumber, type AppAction } from './shared';

type Payload = Record<string, unknown>;

export function validateClipAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'addClip': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'addClip',
                payload: {
                    trackId: payload.trackId,
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                    endBeat: clampNumber(payload.endBeat, 1, 10000, 16),
                    name: typeof payload.name === 'string' ? payload.name : 'Clip',
                },
            };
        }
        case 'moveClip': {
            if (typeof payload.clipId !== 'string' || typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'moveClip',
                payload: {
                    clipId: payload.clipId,
                    trackId: payload.trackId,
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                },
            };
        }
        case 'duplicateClip':
        case 'removeClip': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return { type, payload: { clipId: payload.clipId } } as AppAction;
        }
        case 'splitClip': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'splitClip',
                payload: { clipId: payload.clipId, beat: clampNumber(payload.beat, 0, 10000, 0) },
            };
        }
        case 'setClipFade': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'setClipFade',
                payload: {
                    clipId: payload.clipId,
                    fadeInBeats: clampNumber(payload.fadeInBeats, 0, 64, 0),
                    fadeOutBeats: clampNumber(payload.fadeOutBeats, 0, 64, 0),
                },
            };
        }
        case 'trimClipStart': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'trimClipStart',
                payload: { clipId: payload.clipId, newStartBeat: clampNumber(payload.newStartBeat, 0, 10000, 0) },
            };
        }
        case 'trimClipEnd': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'trimClipEnd',
                payload: { clipId: payload.clipId, newEndBeat: clampNumber(payload.newEndBeat, 0, 10000, 16) },
            };
        }
        case 'normalizeClip':
        case 'reverseClip': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return { type, payload: { clipId: payload.clipId } } as AppAction;
        }
        case 'glueClips': {
            const clipIds = Array.isArray(payload.clipIds)
                ? (payload.clipIds as unknown[]).filter((id): id is string => typeof id === 'string')
                : [];
            if (clipIds.length < 2) {
                return null;
            }
            return { type: 'glueClips', payload: { clipIds } };
        }
        case 'nudgeClip': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'nudgeClip',
                payload: { clipId: payload.clipId, beats: clampNumber(payload.beats, -100, 100, 1) },
            };
        }
        case 'crossfadeClips': {
            if (typeof payload.clipAId !== 'string' || typeof payload.clipBId !== 'string') {
                return null;
            }
            return {
                type: 'crossfadeClips',
                payload: {
                    clipAId: payload.clipAId,
                    clipBId: payload.clipBId,
                    durationBeats: clampNumber(payload.durationBeats, 0, 64, 4),
                },
            };
        }
        case 'setClipGain': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'setClipGain',
                payload: { clipId: payload.clipId, gain: clampNumber(payload.gain, 0, 2, 1) },
            };
        }
        case 'setClipColor': {
            if (typeof payload.clipId !== 'string' || typeof payload.color !== 'string') {
                return null;
            }
            return {
                type: 'setClipColor',
                payload: { clipId: payload.clipId, color: payload.color },
            };
        }
        case 'lockClip': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'lockClip',
                payload: { clipId: payload.clipId, locked: payload.locked !== false },
            };
        }
        case 'muteClip': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'muteClip',
                payload: { clipId: payload.clipId, muted: payload.muted !== false },
            };
        }
        case 'consolidateSelection': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'consolidateSelection',
                payload: {
                    trackId: payload.trackId,
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                    endBeat: clampNumber(payload.endBeat, 1, 10000, 16),
                },
            };
        }
        case 'exportMidi': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return { type: 'exportMidi', payload: { clipId: payload.clipId } };
        }
        case 'stripSilence': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'stripSilence',
                payload: {
                    clipId: payload.clipId,
                    threshold: typeof payload.threshold === 'number' ? payload.threshold : undefined,
                    minDuration: typeof payload.minDuration === 'number' ? payload.minDuration : undefined,
                },
            };
        }
        default:
            return undefined; // not handled by this module
    }
}
