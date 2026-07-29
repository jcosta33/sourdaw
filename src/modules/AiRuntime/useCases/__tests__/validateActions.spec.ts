import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
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
