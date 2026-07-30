import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS,
    RUNTIME_ACTION_OVERRIDE_REQUIRED_PAYLOAD_KEYS,
    type RuntimeAction,
} from '../../models/RuntimeAction';
import { validateActions } from '../validateActions';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const arrangementState = vi.hoisted(() => ({
    tracks: [{ id: 'track-1' }],
    groups: [{ id: 'vca-1' }],
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return { tracks: arrangementState.tracks, selectedTrackId: null };
        },
    },
    vcaGroupStore: {
        get value() {
            return { groups: arrangementState.groups };
        },
    },
}));

describe('validateActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        arrangementState.tracks = [{ id: 'track-1' }];
        arrangementState.groups = [{ id: 'vca-1' }];
    });

    it('should filter unknown action types and log a warning', () => {
        const actions = [{ type: 'notARealAction' }] as unknown as RuntimeAction[];
        const result = validateActions(actions);

        expect(result).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown action type'));
    });

    it.each([
        'exportProject',
        'importAudioFile',
        'importMidiFile',
        'leaveCollabSession',
        'newProject',
        'saveProject',
    ] as const)('should reject fire-and-forget action $type from AI admission', (type) => {
        const actions = [{ type }] as RuntimeAction[];

        expect(validateActions(actions)).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(`Unawaited AI action rejected: ${type}`);
    });

    it('should reject the Command-only punch-region inverse as unavailable to AI', () => {
        const actions = [
            { type: 'restorePunchRegion', payload: { punchInBeat: 4, punchOutBeat: 12 } },
        ] as unknown as RuntimeAction[];

        expect(validateActions(actions)).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Unknown action type rejected: restorePunchRegion')
        );
    });

    it('should reject the internal legacy VCA restoration action as unavailable to AI', () => {
        const actions = [
            { type: 'restoreLegacyVcaState', payload: { groups: [], trackMemberships: [] } },
        ] as unknown as RuntimeAction[];

        expect(validateActions(actions)).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Unknown action type rejected: restoreLegacyVcaState')
        );
    });

    it.each([
        {
            type: 'createTrackAlternative',
            payload: { trackId: 'track-1', name: 'Alt', duplicateActive: false, alternativeId: 'alt-1' },
        },
        {
            type: 'deleteTrackAlternative',
            payload: { trackId: 'track-1', alternativeId: 'alt-1', fallbackAlternativeId: 'alt-2' },
        },
        { type: 'duplicateClip', payload: { clipId: 'clip-1', targetClipId: 'clip-2' } },
        { type: 'duplicateClipToNextBar', payload: { clipId: 'clip-1', targetClipId: 'clip-2' } },
        { type: 'addMarker', payload: { beat: 4, name: 'Verse', markerId: 'marker-1' } },
        { type: 'addSection', payload: { startBeat: 0, endBeat: 8, name: 'Verse', sectionId: 'section-1' } },
        {
            type: 'addAutomationLane',
            payload: { trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', laneId: 'lane-1' },
        },
        { type: 'generateDrumPattern', payload: { style: 'house', startBeat: 4 } },
        { type: 'generateMelody', payload: { style: 'ambient', octave: 4 } },
        { type: 'generateChordProgression', payload: { style: 'jazz', startBeat: 4 } },
        { type: 'extractGroove', payload: { clipId: 'clip-1', templateId: 'groove-1' } },
        { type: 'createCollabSession', payload: { name: 'Review', sessionId: 'session-1' } },
        {
            type: 'joinCollabSession',
            payload: { inviteString: 'invite', peerName: 'Mixer', sessionId: 'session-1' },
        },
        { type: 'createVcaGroup', payload: { name: 'Band', trackIds: [], vcaGroupId: 'vca-new' } },
        { type: 'addChordEvent', payload: { beat: 0, root: 0, quality: 'major', eventId: 'chord-1' } },
        {
            type: 'createAdjustmentLayer',
            payload: { name: 'Glue', effectType: 'compressor', layerId: 'layer-1' },
        },
    ] as const)('should reject payloads outside the initiating contract for $type', (action) => {
        expect(validateActions([action] as unknown as RuntimeAction[])).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(`Command-owned payload fields rejected for action ${action.type}`);

        const allowedKeys: readonly string[] = RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS[action.type];
        const initiatingPayload = Object.fromEntries(
            Object.entries(action.payload).filter(([key]) => allowedKeys.includes(key))
        );
        const missingRequiredKey = RUNTIME_ACTION_OVERRIDE_REQUIRED_PAYLOAD_KEYS[action.type][0];
        const missingRequiredPayload = Object.fromEntries(
            Object.entries(initiatingPayload).filter(([key]) => key !== missingRequiredKey)
        );
        const missingRequiredAction = { ...action, payload: missingRequiredPayload };

        expect(validateActions([missingRequiredAction] as unknown as RuntimeAction[])).toEqual([]);
        expect(mockLogger.warn).toHaveBeenLastCalledWith(
            `Command-owned payload fields rejected for action ${action.type}`
        );
    });

    it('should reject invalid setTempo bpm', () => {
        const actions = [{ type: 'setTempo', payload: { bpm: 5 } }] as unknown as RuntimeAction[];
        expect(validateActions(actions)).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload for action setTempo'));
    });

    it('should keep valid actions', () => {
        const valid = [{ type: 'setTempo', payload: { bpm: 120 } }] as unknown as RuntimeAction[];
        expect(validateActions(valid)).toEqual(valid);
    });

    it.each([
        { type: 'createVcaGroup', payload: { name: 'Drums', trackIds: ['missing-track'] } },
        { type: 'assignToVca', payload: { trackId: 'missing-track', vcaGroupId: 'vca-1' } },
        { type: 'assignToVca', payload: { trackId: 'track-1', vcaGroupId: 'missing-vca' } },
        { type: 'removeFromVca', payload: { trackId: 'missing-track' } },
        { type: 'setVcaGain', payload: { vcaGroupId: 'missing-vca', gain: 1 } },
    ] as const)('should reject unavailable VCA identities for $type', (action) => {
        expect(validateActions([action])).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unavailable target for action'));
    });

    it('should retain structurally valid VCA actions when every identity is available', () => {
        const actions: RuntimeAction[] = [
            { type: 'createVcaGroup', payload: { name: 'Drums', trackIds: ['track-1'] } },
            { type: 'assignToVca', payload: { trackId: 'track-1', vcaGroupId: 'vca-1' } },
            { type: 'removeFromVca', payload: { trackId: 'track-1' } },
            { type: 'setVcaGain', payload: { vcaGroupId: 'vca-1', gain: 0.75 } },
        ];

        expect(validateActions(actions)).toEqual(actions);
    });
});
