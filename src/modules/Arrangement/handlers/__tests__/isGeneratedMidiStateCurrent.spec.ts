import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../useCases/createTrack';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';

const mocks = vi.hoisted(() => ({
    getAllSidechainRoutes: vi.fn(),
    getAutomationLanes: vi.fn(),
    getEnvelope: vi.fn(),
    getTrackStoreState: vi.fn(),
    hasNonDefaultWarpState: vi.fn(),
    modulationStore: { value: { modulators: [] } },
    serializeClipSatelliteEntries: vi.fn(),
    serializeClipScopedAutomationLanes: vi.fn(),
    serializeMidiStateForClips: vi.fn(),
    takeLaneStore: { value: { lanes: [] } },
}));

vi.mock('#/modules/Automation/stores', () => ({ modulationStore: mocks.modulationStore }));
vi.mock('#/modules/Automation/useCases', () => ({ getAutomationLanes: mocks.getAutomationLanes }));
vi.mock('#/modules/MIDI/useCases', () => ({ serializeMidiStateForClips: mocks.serializeMidiStateForClips }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: mocks.getAllSidechainRoutes }));
vi.mock('../../stores/gainEnvelopeStore', () => ({ getEnvelope: mocks.getEnvelope }));
vi.mock('../../stores/clipSatelliteState', () => ({
    serializeClipSatelliteEntries: mocks.serializeClipSatelliteEntries,
}));
vi.mock('../../stores/takeLaneStore', () => ({ takeLaneStore: mocks.takeLaneStore }));
vi.mock('../../stores/warpStates', () => ({ hasNonDefaultWarpState: mocks.hasNonDefaultWarpState }));
vi.mock('../../useCases/clip/serializeClipScopedAutomationLanes', () => ({
    serializeClipScopedAutomationLanes: mocks.serializeClipScopedAutomationLanes,
}));
vi.mock('../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));

const generatedClip = {
    id: 'generated-clip',
    trackId: 'generated-track',
    name: 'Bassline',
    startBeat: 0,
    endBeat: 4,
    type: 'midi' as const,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
};

const exactMidiJson = '{"generated-clip":{"notes":[]}}';
const editedMidiJson = '{"generated-clip":{"notes":[{"id":"changed"}]}}';
const capturedLanesJson = '[{"id":"lane-copy","points":[]}]';
const editedLanesJson = '[{"id":"lane-copy","points":[{"value":1}]}]';

function reorderObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(reorderObjectKeys);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .reverse()
            .map(([key, nested]) => [key, reorderObjectKeys(nested)])
    );
}

describe('isGeneratedMidiStateCurrent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllSidechainRoutes.mockReturnValue([]);
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.getEnvelope.mockReturnValue(undefined);
        mocks.serializeMidiStateForClips.mockReturnValue(exactMidiJson);
        mocks.hasNonDefaultWarpState.mockReturnValue(false);
        mocks.modulationStore.value = { modulators: [] };
        mocks.takeLaneStore.value = { lanes: [] };
    });

    it('accepts an exact generated track and its exact MIDI subtree', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(true);
        expect(mocks.serializeMidiStateForClips).toHaveBeenCalledWith(['generated-clip'], undefined);
    });

    it('accepts recursively reordered captured object keys', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(reorderObjectKeys(generatedTrack)),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(true);
    });

    it('accepts recursively reordered captured MIDI object keys', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: JSON.stringify(reorderObjectKeys(JSON.parse(exactMidiJson))),
                },
            })
        ).toBe(true);
    });

    it('rejects malformed captured MIDI JSON', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: '{',
                },
            })
        ).toBe(false);
    });

    it.each([
        ['a changed scalar', (track: ReturnType<typeof createTrack>) => ({ ...track, name: 'Changed' })],
        [
            'a changed nested alternative name',
            (track: ReturnType<typeof createTrack>) => ({
                ...track,
                alternatives: track.alternatives.map((alternative, index) =>
                    index === 0 ? { ...alternative, name: 'Changed alternative' } : alternative
                ),
            }),
        ],
        [
            'changed array order',
            (track: ReturnType<typeof createTrack>) => ({
                ...track,
                alternatives: [track.alternatives[1]!, track.alternatives[0]!],
            }),
        ],
        [
            'a missing field',
            (track: ReturnType<typeof createTrack>) => {
                const captured: Record<string, unknown> = { ...track };
                delete captured.name;
                return captured;
            },
        ],
        ['a null in place of a field', (track: ReturnType<typeof createTrack>) => ({ ...track, name: null })],
        ['malformed captured JSON', () => '{'],
    ])('rejects %s in the captured entity', (_case, capture) => {
        const baseTrack = createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' });
        const generatedTrack = {
            ...baseTrack,
            alternatives: [
                baseTrack.alternatives[0]!,
                { ...baseTrack.alternatives[0]!, id: 'alternative-second', name: 'Second' },
            ],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        const captured = capture(generatedTrack);

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: typeof captured === 'string' ? captured : JSON.stringify(captured),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(false);
    });

    it('rejects deletion after MIDI or dependent routing changes', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        const routedTrack = {
            ...createTrack({ id: 'routed-track', name: 'Lead', kind: 'midi' }),
            outputId: generatedTrack.id,
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack, routedTrack] });
        mocks.serializeMidiStateForClips.mockReturnValue(editedMidiJson);

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(false);

        mocks.serializeMidiStateForClips.mockReturnValue(exactMidiJson);
        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(false);
    });

    it('rejects a clip carrying non-default warp state, and is wired through hasNonDefaultWarpState not map presence', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        mocks.hasNonDefaultWarpState.mockReturnValue(true);

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedClip.id,
                entityType: 'clip',
                guard: {
                    entityJson: JSON.stringify(generatedClip),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(false);
        expect(mocks.hasNonDefaultWarpState).toHaveBeenCalledWith('generated-clip');
    });

    it('accepts generation-written satellites that still match the captured guard, and rejects user-moved ones', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        // The duplicate left an envelope on the copy — presence alone must not conflict.
        mocks.getEnvelope.mockReturnValue({ clipId: 'generated-clip', enabled: true, points: [] });
        mocks.serializeClipSatelliteEntries.mockReturnValue('captured-satellites');
        const guard = {
            entityJson: JSON.stringify(generatedClip),
            midiByClipIdJson: exactMidiJson,
            clipSatellitesJson: 'captured-satellites',
        };

        expect(isGeneratedMidiStateCurrent({ entityId: generatedClip.id, entityType: 'clip', guard })).toBe(true);
        expect(mocks.serializeClipSatelliteEntries).toHaveBeenCalledWith(['generated-clip']);

        // The user edited the copy's envelope after the duplicate: undo must refuse.
        mocks.serializeClipSatelliteEntries.mockReturnValue('edited-satellites');
        expect(isGeneratedMidiStateCurrent({ entityId: generatedClip.id, entityType: 'clip', guard })).toBe(false);
    });

    it('still rejects a clip-scoped automation lane when the satellite guard matches', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        mocks.serializeClipSatelliteEntries.mockReturnValue('captured-satellites');
        mocks.getAutomationLanes.mockReturnValue([{ id: 'lane-1', clipId: 'generated-clip' }]);

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedClip.id,
                entityType: 'clip',
                guard: {
                    entityJson: JSON.stringify(generatedClip),
                    midiByClipIdJson: exactMidiJson,
                    clipSatellitesJson: 'captured-satellites',
                },
            })
        ).toBe(false);
    });

    it('rejects a clip-scoped automation lane under a regeneration guard that captured nothing', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        mocks.getAutomationLanes.mockReturnValue([{ id: 'lane-1', clipId: 'generated-clip' }]);

        // No capture fields: a generation that wrote no satellites must refuse
        // to undo over any satellite state at all, clip-scoped lanes included.
        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedClip.id,
                entityType: 'clip',
                guard: {
                    entityJson: JSON.stringify(generatedClip),
                    midiByClipIdJson: exactMidiJson,
                },
            })
        ).toBe(false);
    });

    it('accepts generation-cloned clip-scoped automation lanes that still match the captured guard, and rejects user-moved ones', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        // The duplicate cloned the source's lane onto the copy — presence alone
        // must not conflict.
        mocks.getAutomationLanes.mockReturnValue([{ id: 'lane-copy', clipId: 'generated-clip' }]);
        mocks.serializeClipSatelliteEntries.mockReturnValue('captured-satellites');
        mocks.serializeClipScopedAutomationLanes.mockReturnValue(capturedLanesJson);
        const guard = {
            entityJson: JSON.stringify(generatedClip),
            midiByClipIdJson: exactMidiJson,
            clipSatellitesJson: 'captured-satellites',
            clipAutomationLanesJson: JSON.stringify(reorderObjectKeys(JSON.parse(capturedLanesJson))),
        };

        expect(isGeneratedMidiStateCurrent({ entityId: generatedClip.id, entityType: 'clip', guard })).toBe(true);
        expect(mocks.serializeClipScopedAutomationLanes).toHaveBeenCalledWith(['generated-clip']);

        // The user edited the copy's lane after the duplicate: undo must refuse.
        mocks.serializeClipScopedAutomationLanes.mockReturnValue(editedLanesJson);
        expect(isGeneratedMidiStateCurrent({ entityId: generatedClip.id, entityType: 'clip', guard })).toBe(false);
    });

    it('accepts recursively reordered projected automation keys and rejects a malformed capture', () => {
        const generatedTrack = createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' });
        const projectedLane = {
            id: 'lane-copy',
            trackId: 'generated-track',
            clipId: 'generated-clip',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [{ id: 'point-1', beat: 0, value: 0.5, curve: 'linear' as const, tension: 0 }],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        const projectedClipState = {
            locatedClip: { owningTrackId: generatedTrack.id, clip: generatedClip },
            clipScopedLanes: [projectedLane],
            restoredSatelliteEntry: null,
            touchedByPriorSibling: true,
        };
        const guard = {
            entityJson: JSON.stringify(generatedClip),
            midiByClipIdJson: exactMidiJson,
            clipAutomationLanesJson: JSON.stringify(reorderObjectKeys([projectedLane])),
        };

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedClip.id,
                entityType: 'clip',
                guard,
                projectedClipState,
            })
        ).toBe(true);
        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedClip.id,
                entityType: 'clip',
                guard: { ...guard, clipAutomationLanesJson: '{' },
                projectedClipState,
            })
        ).toBe(false);
    });

    it('accepts a generated track carrying its captured clip-scoped lanes, and still refuses a track-scoped lane on it', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        // A track duplicate clones the source's clip-scoped lanes onto the
        // copies' clip ids — the cloned lanes carry the copy track's id, and
        // presence alone must not conflict when the capture still matches.
        const clonedLane = { id: 'lane-copy', trackId: 'generated-track', clipId: 'generated-clip' };
        mocks.getAutomationLanes.mockReturnValue([clonedLane]);
        mocks.serializeClipScopedAutomationLanes.mockReturnValue(capturedLanesJson);
        const guard = {
            entityJson: JSON.stringify(generatedTrack),
            midiByClipIdJson: exactMidiJson,
            clipAutomationLanesJson: capturedLanesJson,
        };

        expect(isGeneratedMidiStateCurrent({ entityId: generatedTrack.id, entityType: 'track', guard })).toBe(true);
        expect(mocks.serializeClipScopedAutomationLanes).toHaveBeenCalledWith(['generated-clip']);

        // A track-scoped lane is user-drawn state no generation writes, so it
        // still disqualifies the track.
        mocks.getAutomationLanes.mockReturnValue([clonedLane, { id: 'lane-track', trackId: 'generated-track' }]);
        expect(isGeneratedMidiStateCurrent({ entityId: generatedTrack.id, entityType: 'track', guard })).toBe(false);

        // And a clip-scoped lane the user moved after the capture refuses too.
        mocks.getAutomationLanes.mockReturnValue([clonedLane]);
        mocks.serializeClipScopedAutomationLanes.mockReturnValue(editedLanesJson);
        expect(isGeneratedMidiStateCurrent({ entityId: generatedTrack.id, entityType: 'track', guard })).toBe(false);
    });
});
