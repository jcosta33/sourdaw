import { clampNumber, type AppAction } from './shared';

type Payload = Record<string, unknown>;

export function validateTransportAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'setTempo': {
            return {
                type: 'setTempo',
                payload: { bpm: clampNumber(payload.bpm, 20, 300, 120) },
            };
        }
        case 'setMasterGain': {
            return {
                type: 'setMasterGain',
                payload: { gain: clampNumber(payload.gain, 0, 1, 0.8) },
            };
        }
        case 'setMetronomeVolume': {
            return {
                type: 'setMetronomeVolume',
                payload: { volume: clampNumber(payload.volume, 0, 1, 0.5) },
            };
        }
        case 'setLoopRegion': {
            return {
                type: 'setLoopRegion',
                payload: {
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                    endBeat: clampNumber(payload.endBeat, 1, 10000, 16),
                },
            };
        }
        case 'seekPlayhead': {
            return {
                type: 'seekPlayhead',
                payload: { beat: clampNumber(payload.beat, 0, 10000, 0) },
            };
        }
        case 'setPreRollBars': {
            return {
                type: 'setPreRollBars',
                payload: { bars: clampNumber(payload.bars, 1, 8, 2) },
            };
        }
        case 'zoomTracksVertical': {
            return {
                type: 'zoomTracksVertical',
                payload: { delta: clampNumber(payload.delta, -100, 100, 10) },
            };
        }
        case 'deleteTime': {
            return {
                type: 'deleteTime',
                payload: {
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                    endBeat: clampNumber(payload.endBeat, 1, 10000, 16),
                },
            };
        }
        case 'insertTime': {
            return {
                type: 'insertTime',
                payload: {
                    atBeat: clampNumber(payload.atBeat, 0, 10000, 0),
                    durationBeats: clampNumber(payload.durationBeats, 0.25, 10000, 4),
                },
            };
        }
        case 'duplicateTimeRange': {
            return {
                type: 'duplicateTimeRange',
                payload: {
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                    endBeat: clampNumber(payload.endBeat, 1, 10000, 16),
                },
            };
        }
        case 'setCountInBars': {
            if (typeof payload.bars !== 'number') {
                return null;
            }
            return { type: 'setCountInBars', payload: { bars: clampNumber(payload.bars, 1, 8, 2) } };
        }
        default:
            return undefined;
    }
}

export function validateDeviceAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'addDevice': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'addDevice',
                payload: {
                    trackId: payload.trackId,
                    deviceType: typeof payload.deviceType === 'string' ? payload.deviceType : 'EQ',
                },
            };
        }
        case 'bypassDevice': {
            if (typeof payload.deviceId !== 'string') {
                return null;
            }
            return {
                type: 'bypassDevice',
                payload: { deviceId: payload.deviceId, bypassed: payload.bypassed !== false },
            };
        }
        case 'removeDevice': {
            if (typeof payload.deviceId !== 'string') {
                return null;
            }
            return { type: 'removeDevice', payload: { deviceId: payload.deviceId } };
        }
        case 'setDeviceParameter': {
            if (typeof payload.deviceId !== 'string' || typeof payload.paramId !== 'string') {
                return null;
            }
            return {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: payload.deviceId,
                    paramId: payload.paramId,
                    value: clampNumber(payload.value, -100, 100, 0),
                },
            };
        }
        case 'createBus':
        case 'createFolder': {
            return {
                type,
                payload: {
                    name: typeof payload.name === 'string' ? payload.name : type === 'createBus' ? 'Bus' : 'Folder',
                },
            } as AppAction;
        }
        case 'setSend': {
            if (typeof payload.trackId !== 'string' || typeof payload.busId !== 'string') {
                return null;
            }
            return {
                type: 'setSend',
                payload: {
                    trackId: payload.trackId,
                    busId: payload.busId,
                    level: clampNumber(payload.level, 0, 1, 0.5),
                },
            };
        }
        case 'addSend': {
            if (typeof payload.trackId !== 'string' || typeof payload.busId !== 'string') {
                return null;
            }
            return {
                type: 'addSend',
                payload: {
                    trackId: payload.trackId,
                    busId: payload.busId,
                    level: clampNumber(payload.level, 0, 1, 0.5),
                },
            };
        }
        case 'removeSend': {
            if (typeof payload.trackId !== 'string' || typeof payload.busId !== 'string') {
                return null;
            }
            return {
                type: 'removeSend',
                payload: { trackId: payload.trackId, busId: payload.busId },
            };
        }
        case 'setTrackOutput': {
            if (typeof payload.trackId !== 'string' || typeof payload.outputId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackOutput',
                payload: { trackId: payload.trackId, outputId: payload.outputId },
            };
        }
        default:
            return undefined;
    }
}

export function validateMidiAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'quantizeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'quantizeNotes',
                payload: { clipId: payload.clipId, gridSize: clampNumber(payload.gridSize, 0.0625, 4, 0.25) },
            };
        }
        case 'transposeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'transposeNotes',
                payload: { clipId: payload.clipId, semitones: clampNumber(payload.semitones, -48, 48, 0) },
            };
        }
        case 'humanizeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'humanizeNotes',
                payload: { clipId: payload.clipId, amount: clampNumber(payload.amount, 0, 1, 0.3) },
            };
        }
        case 'invertNotes':
        case 'retrogradeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return { type, payload: { clipId: payload.clipId } } as AppAction;
        }
        default:
            return undefined;
    }
}

export function validateWorkspaceAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'setWorkspaceMode': {
            const mode = (['arrange', 'clip'] as const).includes(payload.mode as 'arrange')
                ? (payload.mode as 'arrange' | 'clip')
                : 'arrange';
            return { type: 'setWorkspaceMode', payload: { mode } };
        }
        case 'addMarker': {
            return {
                type: 'addMarker',
                payload: {
                    beat: clampNumber(payload.beat, 0, 10000, 0),
                    name: typeof payload.name === 'string' ? payload.name : 'Marker',
                },
            };
        }
        case 'removeMarker': {
            if (typeof payload.markerId !== 'string') {
                return null;
            }
            return { type: 'removeMarker', payload: { markerId: payload.markerId } };
        }
        case 'setMarkerColor': {
            if (typeof payload.markerId !== 'string' || typeof payload.color !== 'string') {
                return null;
            }
            return {
                type: 'setMarkerColor',
                payload: { markerId: payload.markerId, color: payload.color },
            };
        }
        case 'addSection': {
            return {
                type: 'addSection',
                payload: {
                    startBeat: clampNumber(payload.startBeat, 0, 10000, 0),
                    endBeat: clampNumber(payload.endBeat, 1, 10000, 16),
                    name: typeof payload.name === 'string' ? payload.name : 'Section',
                },
            };
        }
        case 'removeSection': {
            if (typeof payload.sectionId !== 'string') {
                return null;
            }
            return { type: 'removeSection', payload: { sectionId: payload.sectionId } };
        }
        case 'renameSection': {
            if (typeof payload.sectionId !== 'string' || typeof payload.name !== 'string') {
                return null;
            }
            return { type: 'renameSection', payload: { sectionId: payload.sectionId, name: payload.name } };
        }
        case 'setEditingTool': {
            const tool = typeof payload.tool === 'string' ? payload.tool : 'select';
            return { type: 'setEditingTool', payload: { tool } };
        }
        case 'setSnapValue': {
            const snap = clampNumber(payload.value, 0.0625, 4, 0.25);
            return { type: 'setSnapValue', payload: { value: snap } };
        }
        default:
            return undefined;
    }
}

export function validateAutomationAction(type: string, payload: Payload): AppAction | null | undefined {
    switch (type) {
        case 'addAutomationLane': {
            if (typeof payload.trackId !== 'string' || typeof payload.parameterId !== 'string') {
                return null;
            }
            return {
                type: 'addAutomationLane',
                payload: {
                    trackId: payload.trackId,
                    parameterId: payload.parameterId,
                    parameterName:
                        typeof payload.parameterName === 'string' ? payload.parameterName : payload.parameterId,
                },
            };
        }
        case 'addAutomationPoint': {
            if (typeof payload.laneId !== 'string') {
                return null;
            }
            const curve = (['linear', 'step', 'exponential'] as const).includes(payload.curve as 'linear')
                ? (payload.curve as 'linear' | 'step' | 'exponential')
                : 'linear';
            return {
                type: 'addAutomationPoint',
                payload: {
                    laneId: payload.laneId,
                    beat: clampNumber(payload.beat, 0, 10000, 0),
                    value: clampNumber(payload.value, 0, 1, 0.5),
                    curve,
                },
            };
        }
        case 'removeAutomationPoint': {
            if (typeof payload.laneId !== 'string') {
                return null;
            }
            return {
                type: 'removeAutomationPoint',
                payload: {
                    laneId: payload.laneId,
                    pointIndex: clampNumber(payload.pointIndex, 0, 10000, 0),
                },
            };
        }
        case 'setAutomationMode': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            const mode = (['read', 'write', 'touch', 'latch', 'off'] as const).includes(payload.mode as 'read')
                ? (payload.mode as 'read' | 'write' | 'touch' | 'latch' | 'off')
                : 'read';
            return { type: 'setAutomationMode', payload: { trackId: payload.trackId, mode } };
        }
        default:
            return undefined;
    }
}
