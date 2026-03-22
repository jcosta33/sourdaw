/**
 * Transformer: pure validation and sanitisation of raw LLM action payloads.
 * No I/O — only transforms unknown input into typed AppAction.
 */
import { type AppAction, type AppActionType } from '#/modules/Command/useCases/commandQueries';

const VALID_TYPES: ReadonlySet<string> = new Set<AppActionType>([
    'addTrack',
    'removeTrack',
    'removeAllTracks',
    'renameTrack',
    'selectTrack',
    'muteTrack',
    'soloTrack',
    'toggleSoloSafe',
    'armTrack',
    'freezeTrack',
    'unfreezeTrack',
    'bounceInPlace',
    'duplicateTrack',
    'reorderTrack',
    'setTrackGain',
    'setTrackPan',
    'setTrackColor',
    'setTempo',
    'togglePlayback',
    'stopPlayback',
    'toggleRecording',
    'setMasterGain',
    'toggleLoop',
    'toggleMetronome',
    'setMetronomeVolume',
    'setLoopRegion',
    'addClip',
    'moveClip',
    'duplicateClip',
    'duplicateClipToNextBar',
    'removeClip',
    'splitClip',
    'trimClipStart',
    'trimClipEnd',
    'setClipFade',
    'copyClip',
    'cutClip',
    'pasteClip',
    'addDevice',
    'bypassDevice',
    'removeDevice',
    'setDeviceParameter',
    'createBus',
    'createFolder',
    'setSend',
    'setWorkspaceMode',
    'openMixer',
    'closeMixer',
    'toggleSidebar',
    'toggleInspector',
    'toggleChatPanel',
    'setEditingTool',
    'addMarker',
    'removeMarker',
    'setMarkerColor',
    'addSection',
    'removeSection',
    'renameSection',
    'addAutomationLane',
    'addAutomationPoint',
    'quantizeNotes',
    'quantizeNoteLengths',
    'transposeNotes',
    'humanizeNotes',
    'invertNotes',
    'retrogradeNotes',
    'scaleVelocities',
    'scaleAllVelocities',
    'setAllVelocities',
    'importMidiFile',
    'normalizeClip',
    'reverseClip',
    'glueClips',
    'nudgeClip',
    'crossfadeClips',
    'setClipGain',
    'setClipColor',
    'lockClip',
    'renameClip',
    'consolidateSelection',
    'bounceSelection',
    'seekPlayhead',
    'setPunchIn',
    'setPunchOut',
    'togglePunch',
    'toggleCountIn',
    'setCountInBars',
    'togglePreRoll',
    'setPreRollBars',
    'addTimeSignatureChange',
    'removeTimeSignatureChange',
    'setTrackOutput',
    'addSend',
    'removeSend',
    'removeAutomationPoint',
    'setAutomationMode',
    'hideTrack',
    'disableTrack',
    'setTrackHeight',
    'setSnapValue',
    'zoomToFit',
    'zoomToSelection',
    'exportProject',
    'saveProject',
    'newProject',
    'importAudioFile',
    'exportMidi',
    'foldTrack',
    'groupTracks',
    'ungroupTracks',
    'scaleAutomation',
    'stretchAutomation',
    'invertAutomation',
    'reverseAutomation',
    'thinAutomation',
    'quantizeAutomation',
    'loadPreset',
    'savePreset',
    'generateDrumPattern',
    'generateMelody',
    'generateChordProgression',
    'setClipLoop',
    'setClipLoopLength',
    'extractGroove',
    'applyGroove',
    'setClipStretchMode',
    'setClipStretchRatio',
    'fitClipToBeats',
    'analyzeMix',
    'autoFixMix',
    'enableMpe',
    'disableMpe',
    'getLatencyReport',
    'createCollabSession',
    'joinCollabSession',
    'leaveCollabSession',
    'scanPlugins',
    'loadExternalPlugin',
    'audioToMidi',
    'muteClip',
    'clearSolos',
    'setTrackNotes',
    'setTrackInput',
    'zoomTracksVertical',
    'deleteTime',
    'insertTime',
    'duplicateTimeRange',
    'stripSilence',
    'arpeggiate',
    'addSidechainRoute',
    'removeSidechainRoute',
    'bounceToNewTrack',
    'detectTempo',
    'detectKey',
    'consolidateAllTracks',
    'createTrackAlternative',
    'switchTrackAlternative',
    'renameTrackAlternative',
    'deleteTrackAlternative',
]);

const NO_PAYLOAD_ACTIONS: ReadonlySet<string> = new Set([
    'togglePlayback',
    'stopPlayback',
    'toggleRecording',
    'toggleLoop',
    'toggleMetronome',
    'openMixer',
    'closeMixer',
    'copyClip',
    'cutClip',
    'pasteClip',
    'importMidiFile',
    'toggleSidebar',
    'toggleInspector',
    'toggleChatPanel',
    'zoomToFit',
    'zoomToSelection',
    'exportProject',
    'saveProject',
    'newProject',
    'importAudioFile',
    'togglePunch',
    'toggleCountIn',
    'togglePreRoll',
    'analyzeMix',
    'autoFixMix',
    'enableMpe',
    'disableMpe',
    'getLatencyReport',
    'createCollabSession',
    'leaveCollabSession',
    'scanPlugins',
    'clearSolos',
    'consolidateAllTracks',
    'removeAllTracks',
]);

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, val));
}

export function validateSingleAction(raw: unknown): AppAction | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const obj = raw as Record<string, unknown>;

    const type = obj.type;
    if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
        return null;
    }

    if (NO_PAYLOAD_ACTIONS.has(type)) {
        return { type } as AppAction;
    }

    const payload =
        typeof obj.payload === 'object' && obj.payload !== null ? (obj.payload as Record<string, unknown>) : {};

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
                payload: {
                    trackId: payload.trackId,
                    gain: clampNumber(payload.gain, 0, 1, 0.8),
                },
            };
        }
        case 'setTrackPan': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackPan',
                payload: {
                    trackId: payload.trackId,
                    pan: clampNumber(payload.pan, -50, 50, 0),
                },
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
                payload: {
                    clipId: payload.clipId,
                    beat: clampNumber(payload.beat, 0, 10000, 0),
                },
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
                payload: {
                    deviceId: payload.deviceId,
                    bypassed: payload.bypassed !== false,
                },
            };
        }
        case 'removeDevice': {
            if (typeof payload.deviceId !== 'string') {
                return null;
            }
            return { type: 'removeDevice', payload: { deviceId: payload.deviceId } };
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
        case 'quantizeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'quantizeNotes',
                payload: {
                    clipId: payload.clipId,
                    gridSize: clampNumber(payload.gridSize, 0.0625, 4, 0.25),
                },
            };
        }
        case 'transposeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'transposeNotes',
                payload: {
                    clipId: payload.clipId,
                    semitones: clampNumber(payload.semitones, -48, 48, 0),
                },
            };
        }
        case 'humanizeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'humanizeNotes',
                payload: {
                    clipId: payload.clipId,
                    amount: clampNumber(payload.amount, 0, 1, 0.3),
                },
            };
        }
        case 'invertNotes':
        case 'retrogradeNotes': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return { type, payload: { clipId: payload.clipId } } as AppAction;
        }
        case 'reorderTrack': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'reorderTrack',
                payload: {
                    trackId: payload.trackId,
                    newIndex: clampNumber(payload.newIndex, 0, 100, 0),
                },
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
        case 'trimClipStart': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'trimClipStart',
                payload: {
                    clipId: payload.clipId,
                    newStartBeat: clampNumber(payload.newStartBeat, 0, 10000, 0),
                },
            };
        }
        case 'trimClipEnd': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return {
                type: 'trimClipEnd',
                payload: {
                    clipId: payload.clipId,
                    newEndBeat: clampNumber(payload.newEndBeat, 0, 10000, 16),
                },
            };
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
        case 'setEditingTool': {
            const tool = typeof payload.tool === 'string' ? payload.tool : 'select';
            return { type: 'setEditingTool', payload: { tool } };
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
            return {
                type: 'removeSection',
                payload: { sectionId: payload.sectionId },
            };
        }
        case 'renameSection': {
            if (typeof payload.sectionId !== 'string' || typeof payload.name !== 'string') {
                return null;
            }
            return {
                type: 'renameSection',
                payload: { sectionId: payload.sectionId, name: payload.name },
            };
        }
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
                payload: {
                    clipId: payload.clipId,
                    beats: clampNumber(payload.beats, -100, 100, 1),
                },
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
                payload: {
                    clipId: payload.clipId,
                    gain: clampNumber(payload.gain, 0, 2, 1),
                },
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
        case 'seekPlayhead': {
            return {
                type: 'seekPlayhead',
                payload: { beat: clampNumber(payload.beat, 0, 10000, 0) },
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
            return {
                type: 'setAutomationMode',
                payload: { trackId: payload.trackId, mode },
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
                payload: {
                    trackId: payload.trackId,
                    disabled: payload.disabled !== false,
                },
            };
        }
        case 'setTrackHeight': {
            if (typeof payload.trackId !== 'string') {
                return null;
            }
            return {
                type: 'setTrackHeight',
                payload: {
                    trackId: payload.trackId,
                    height: clampNumber(payload.height, 20, 400, 80),
                },
            };
        }
        case 'setSnapValue': {
            const snap = clampNumber(payload.value, 0.0625, 4, 0.25);
            return { type: 'setSnapValue', payload: { value: snap } };
        }
        case 'exportMidi': {
            if (typeof payload.clipId !== 'string') {
                return null;
            }
            return { type: 'exportMidi', payload: { clipId: payload.clipId } };
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
            return { type, payload } as AppAction;
    }
}
