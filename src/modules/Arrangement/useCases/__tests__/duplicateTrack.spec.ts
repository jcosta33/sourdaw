import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createEventBus } from '#/infra/events/createEventBus';

import { type Clip, type Track, type TrackKind } from '../../models/Track';
import { duplicateTrack } from '../duplicateTrack';

import type { TrackAddedPayload } from '../../events';
import type { TrackState } from '../../repositories/track/getTrackState';

type ClipCopy = { sourceClipId: string; targetClipId: string };
type AutomationClipCopy = ClipCopy & { targetTrackId: string };
type Rollback = () => void;
type AddTrackInput = {
    id?: string;
    name: string;
    kind: TrackKind;
    select?: boolean;
    suppressAddedEvent?: boolean;
};
type AddTrack = (input: AddTrackInput) => Track | null;
type UpdateTrack = (trackId: string, updater: (track: Track) => Track) => void;
type DuplicateMidiClipData = (input: { copies: readonly ClipCopy[] }) => Rollback;
type DuplicateClipAutomationBatch = (input: { copies: readonly AutomationClipCopy[] }) => Rollback;
type EmitTrackAdded = (event: 'track.added', payload: TrackAddedPayload) => Promise<void>;
type DuplicateTrackEvents = { 'track.added': TrackAddedPayload };

const mocks = vi.hoisted(() => {
    const callOrder: string[] = [];

    return {
        callOrder,
        getTrackById: vi.fn<(trackId: string) => Track | undefined>(),
        getTrackState: vi.fn<() => TrackState | null>(),
        setTrackState: vi.fn<(state: TrackState) => void>(),
        updateTrack: vi.fn<UpdateTrack>(),
        addTrack: vi.fn<AddTrack>(),
        duplicateMidiClipData: vi.fn<DuplicateMidiClipData>(),
        duplicateClipAutomationBatch: vi.fn<DuplicateClipAutomationBatch>(),
        eventBus: {
            emit: vi.fn<EmitTrackAdded>(),
        },
    };
});

vi.mock('../../repositories/track/getTrackById', () => ({ getTrackById: mocks.getTrackById }));
vi.mock('../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../addTrack', () => ({ addTrack: mocks.addTrack }));
vi.mock('#/modules/MIDI/useCases', () => ({ duplicateMidiClipData: mocks.duplicateMidiClipData }));
vi.mock('#/modules/Automation/useCases', () => ({
    duplicateClipAutomationBatch: mocks.duplicateClipAutomationBatch,
}));

function createClip(input: Partial<Clip> & Pick<Clip, 'id' | 'type'>): Clip {
    return {
        ...input,
        id: input.id,
        trackId: input.trackId ?? 'source-track',
        name: input.name ?? `Clip ${input.id}`,
        startBeat: input.startBeat ?? 0,
        endBeat: input.endBeat ?? 4,
        type: input.type,
        fadeInBeats: input.fadeInBeats ?? 0,
        fadeOutBeats: input.fadeOutBeats ?? 0,
        gain: input.gain ?? 1,
        color: input.color ?? '#22c55e',
        locked: input.locked ?? false,
        muted: input.muted ?? false,
    };
}

function createTrack(overrides: Partial<Track> = {}): Track {
    return {
        id: 'track-default',
        name: 'Default track',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#2563eb',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function requireFirst<TValue>(values: readonly TValue[], label: string): TValue {
    const value = values[0];
    if (value === undefined) {
        throw new Error(`Expected ${label}`);
    }

    return value;
}

function requireUpdatedTrack(): Track {
    const updateCall = mocks.updateTrack.mock.calls[0];
    if (updateCall === undefined) {
        throw new Error('Expected updateTrack call');
    }

    const [trackId, updater] = updateCall;
    return updater(createTrack({ id: trackId }));
}

function returnCreatedTrack(): void {
    mocks.addTrack.mockImplementation((input) => {
        if (input.id === undefined) {
            throw new Error('Expected generated track ID');
        }

        return createTrack({ id: input.id, name: input.name, kind: input.kind });
    });
}

describe('duplicateTrack', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        injectDependencies(duplicateTrack, { eventBus: mocks.eventBus });
        mocks.callOrder.length = 0;
        mocks.getTrackById.mockReturnValue(undefined);
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });
        mocks.addTrack.mockReturnValue(null);
        mocks.updateTrack.mockImplementation(() => {
            mocks.callOrder.push('updateTrack');
        });
        mocks.duplicateMidiClipData.mockImplementation(() => {
            mocks.callOrder.push('duplicateMidiClipData');
            return () => {
                mocks.callOrder.push('rollbackMidi');
            };
        });
        mocks.duplicateClipAutomationBatch.mockImplementation(() => {
            mocks.callOrder.push('duplicateClipAutomationBatch');
            return () => {
                mocks.callOrder.push('rollbackAutomation');
            };
        });
    });

    it('does nothing when the source track is missing', () => {
        duplicateTrack('track-missing');

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.duplicateMidiClipData).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomationBatch).not.toHaveBeenCalled();
        expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not create satellite state when adding the duplicate track fails', () => {
        const source = createTrack({
            id: 'track-source',
            alternatives: [
                {
                    id: 'alt-source',
                    name: 'Source alternative',
                    clips: [
                        createClip({ id: 'clip-midi', type: 'midi' }),
                        createClip({ id: 'clip-audio', type: 'audio' }),
                    ],
                },
            ],
            activeAlternativeId: 'alt-source',
        });
        mocks.getTrackById.mockReturnValue(source);

        duplicateTrack(source.id);

        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.duplicateMidiClipData).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomationBatch).not.toHaveBeenCalled();
        expect(mocks.callOrder).toEqual([]);
        expect(mocks.addTrack).toHaveBeenCalledWith(expect.objectContaining({ suppressAddedEvent: true }));
        expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it('forwards ordered MIDI and automation pairs after updating a mixed multi-alternative duplicate', () => {
        const sourceMidiOne = createClip({
            id: 'clip-midi-one',
            type: 'midi',
            name: 'MIDI one',
            startBeat: 2,
            endBeat: 6,
            gain: 0.7,
        });
        const sourceAudio = createClip({
            id: 'clip-audio',
            type: 'audio',
            name: 'Audio',
            audioBufferId: 'buffer-audio',
            startBeat: 8,
            endBeat: 16,
            locked: true,
        });
        const sourceMidiTwo = createClip({
            id: 'clip-midi-two',
            type: 'midi',
            name: 'MIDI two',
            muted: true,
            color: '#f97316',
        });
        const source = createTrack({
            id: 'track-source',
            name: 'Source track',
            kind: 'midi',
            gain: 0.43,
            pan: -0.25,
            color: '#0891b2',
            devices: [
                {
                    id: 'device-source',
                    name: 'Delay',
                    type: 'delay',
                    bypassed: false,
                    parameterValues: { mix: 0.4 },
                },
            ],
            sends: [{ busId: 'bus-reverb', level: 0.6, preFader: true }],
            vcaGroupId: 'vca-source',
            outputId: 'bus-main',
            followChordTrack: true,
            notes: 'Keep this note',
            alternatives: [
                {
                    id: 'alt-source-one',
                    name: 'Alternative one',
                    clips: [sourceMidiOne, sourceAudio],
                },
                {
                    id: 'alt-source-two',
                    name: 'Alternative two',
                    clips: [sourceMidiTwo],
                },
            ],
            activeAlternativeId: 'alt-source-two',
        });
        mocks.getTrackById.mockReturnValue(source);
        returnCreatedTrack();

        duplicateTrack(source.id);

        const updatedTrack = requireUpdatedTrack();
        const firstAlternative = requireFirst(updatedTrack.alternatives, 'first copied alternative');
        const secondAlternative = updatedTrack.alternatives[1];
        if (secondAlternative === undefined) {
            throw new Error('Expected second copied alternative');
        }
        const copiedMidiOne = requireFirst(firstAlternative.clips, 'first copied clip');
        const copiedAudio = firstAlternative.clips[1];
        if (copiedAudio === undefined) {
            throw new Error('Expected copied audio clip');
        }
        const copiedMidiTwo = requireFirst(secondAlternative.clips, 'second copied MIDI clip');
        const copiedDevice = requireFirst(updatedTrack.devices, 'copied device');

        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith(
            expect.objectContaining({
                name: `${source.name} (copy)`,
                kind: source.kind,
                suppressAddedEvent: true,
            })
        );
        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(updatedTrack.gain).toBe(source.gain);
        expect(updatedTrack.pan).toBe(source.pan);
        expect(updatedTrack.color).toBe(source.color);
        expect(updatedTrack.sends).toEqual(source.sends);
        expect(updatedTrack.vcaGroupId).toBe(source.vcaGroupId);
        expect(updatedTrack.outputId).toBe(source.outputId);
        expect(updatedTrack.followChordTrack).toBe(source.followChordTrack);
        expect(updatedTrack.notes).toBe(source.notes);
        expect(firstAlternative.id).toMatch(/^alt-dup-/);
        expect(secondAlternative.id).toMatch(/^alt-dup-/);
        expect(updatedTrack.activeAlternativeId).toBe(secondAlternative.id);
        expect(updatedTrack.clips).toBe(secondAlternative.clips);
        expect(copiedMidiOne).toEqual({ ...sourceMidiOne, id: copiedMidiOne.id, trackId: updatedTrack.id });
        expect(copiedAudio).toEqual({ ...sourceAudio, id: copiedAudio.id, trackId: updatedTrack.id });
        expect(copiedMidiTwo).toEqual({ ...sourceMidiTwo, id: copiedMidiTwo.id, trackId: updatedTrack.id });
        expect(copiedMidiOne.id).toMatch(/^clip-dup-/);
        expect(copiedAudio.id).toMatch(/^clip-dup-/);
        expect(copiedMidiTwo.id).toMatch(/^clip-dup-/);
        expect(copiedDevice).toEqual({ ...source.devices[0], id: copiedDevice.id });
        expect(copiedDevice).not.toBe(source.devices[0]);
        expect(mocks.duplicateMidiClipData).toHaveBeenCalledTimes(1);
        expect(mocks.duplicateMidiClipData).toHaveBeenCalledWith({
            copies: [
                { sourceClipId: sourceMidiOne.id, targetClipId: copiedMidiOne.id },
                { sourceClipId: sourceMidiTwo.id, targetClipId: copiedMidiTwo.id },
            ],
        });
        expect(mocks.duplicateClipAutomationBatch).toHaveBeenCalledTimes(1);
        expect(mocks.duplicateClipAutomationBatch).toHaveBeenCalledWith({
            copies: [
                { sourceClipId: sourceMidiOne.id, targetClipId: copiedMidiOne.id, targetTrackId: updatedTrack.id },
                { sourceClipId: sourceAudio.id, targetClipId: copiedAudio.id, targetTrackId: updatedTrack.id },
                { sourceClipId: sourceMidiTwo.id, targetClipId: copiedMidiTwo.id, targetTrackId: updatedTrack.id },
            ],
        });
        expect(mocks.callOrder).toEqual(['updateTrack', 'duplicateMidiClipData', 'duplicateClipAutomationBatch']);
    });

    it('emits track.added after the duplicate is fully visible to event handlers', async () => {
        const sourceMidi = createClip({ id: 'clip-midi', type: 'midi' });
        const sourceAudio = createClip({ id: 'clip-audio', type: 'audio' });
        const source = createTrack({
            id: 'track-source',
            name: 'Source track',
            kind: 'midi',
            alternatives: [{ id: 'alt-source', name: 'Source alternative', clips: [sourceMidi, sourceAudio] }],
            activeAlternativeId: 'alt-source',
        });
        mocks.getTrackById.mockReturnValue(source);

        let duplicatedTrack: Track | undefined;
        mocks.addTrack.mockImplementation((input) => {
            const track = createTrack({ id: input.id, name: input.name, kind: input.kind });
            duplicatedTrack = track;
            return track;
        });
        mocks.updateTrack.mockImplementation((trackId, updater) => {
            if (!duplicatedTrack || duplicatedTrack.id !== trackId) {
                throw new Error('Expected duplicate track before update');
            }

            mocks.callOrder.push('updateTrack');
            duplicatedTrack = updater(duplicatedTrack);
        });

        const eventBus = createEventBus<DuplicateTrackEvents>();
        let observation:
            | {
                  payload: TrackAddedPayload;
                  trackId: string | undefined;
                  alternativeIds: string[];
                  activeAlternativeId: string | undefined;
                  activeClipIds: string[];
                  midiCallCount: number;
                  automationCallCount: number;
                  callOrder: string[];
              }
            | undefined;
        const observer = vi.fn((payload: TrackAddedPayload) => {
            const observableTrack = duplicatedTrack;
            observation = {
                payload: { ...payload },
                trackId: observableTrack?.id,
                alternativeIds: observableTrack?.alternatives.map((alternative) => alternative.id) ?? [],
                activeAlternativeId: observableTrack?.activeAlternativeId,
                activeClipIds: observableTrack?.clips.map((clip) => clip.id) ?? [],
                midiCallCount: mocks.duplicateMidiClipData.mock.calls.length,
                automationCallCount: mocks.duplicateClipAutomationBatch.mock.calls.length,
                callOrder: [...mocks.callOrder],
            };
        });
        eventBus.on('track.added', observer);
        injectDependencies(duplicateTrack, { eventBus });

        duplicateTrack(source.id);
        await eventBus.waitForIdle();

        expect(observer).toHaveBeenCalledTimes(1);
        if (!observation) {
            throw new Error('Expected immutable event observation');
        }
        expect(observation.payload).toEqual({
            trackId: observation.trackId,
            name: `${source.name} (copy)`,
            kind: source.kind,
        });
        expect(observation.alternativeIds).toHaveLength(1);
        expect(observation.alternativeIds).toContain(observation.activeAlternativeId);
        expect(observation.activeClipIds).toHaveLength(2);
        expect(observation.midiCallCount).toBe(1);
        expect(observation.automationCallCount).toBe(1);
        expect(observation.callOrder).toEqual(['updateTrack', 'duplicateMidiClipData', 'duplicateClipAutomationBatch']);
        expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it('restores the exact Arrangement snapshot when addTrack writes and then throws', () => {
        const source = createTrack({ id: 'track-source' });
        const arrangementSnapshot: TrackState = {
            tracks: [source],
            selectedTrackId: source.id,
            ghostClips: [],
        };
        const arrangementSnapshotValue = structuredClone(arrangementSnapshot);
        const originalFailure = new Error('addTrack failed after writing');
        let arrangementState = arrangementSnapshot;
        mocks.getTrackById.mockReturnValue(source);
        mocks.getTrackState.mockImplementation(() => arrangementState);
        mocks.setTrackState.mockImplementation((state) => {
            arrangementState = state;
        });
        mocks.addTrack.mockImplementation((input) => {
            arrangementState = {
                ...arrangementState,
                tracks: [...arrangementState.tracks, createTrack({ id: input.id })],
            };
            throw originalFailure;
        });

        let thrown: unknown;
        try {
            duplicateTrack(source.id);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBe(originalFailure);
        expect(arrangementState).toBe(arrangementSnapshot);
        expect(arrangementState).toEqual(arrangementSnapshotValue);
        expect(mocks.setTrackState).toHaveBeenCalledOnce();
        expect(mocks.duplicateMidiClipData).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomationBatch).not.toHaveBeenCalled();
        expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it.each(['update', 'midi', 'automation'] as const)(
        'restores exact owner snapshots and preserves the original %s failure',
        (failurePoint) => {
            const sourceClip = createClip({ id: 'clip-midi', type: 'midi' });
            const source = createTrack({
                id: 'track-source',
                alternatives: [{ id: 'alt-source', name: 'Source alternative', clips: [sourceClip] }],
                activeAlternativeId: 'alt-source',
            });
            const arrangementSnapshot: TrackState = {
                tracks: [source],
                selectedTrackId: source.id,
                ghostClips: [sourceClip],
            };
            const midiSnapshot = { values: ['midi-before'] };
            const automationSnapshot = { values: ['automation-before'] };
            const arrangementSnapshotValue = structuredClone(arrangementSnapshot);
            const midiSnapshotValue = structuredClone(midiSnapshot);
            const automationSnapshotValue = structuredClone(automationSnapshot);
            const originalFailure = new Error(`${failurePoint} failed`);
            let arrangementState = arrangementSnapshot;
            let midiState = midiSnapshot;
            let automationState = automationSnapshot;

            mocks.getTrackById.mockReturnValue(source);
            mocks.getTrackState.mockImplementation(() => arrangementState);
            mocks.setTrackState.mockImplementation((state) => {
                mocks.callOrder.push('rollbackArrangement');
                arrangementState = state;
            });
            mocks.addTrack.mockImplementation((input) => {
                const track = createTrack({ id: input.id, name: input.name, kind: input.kind });
                mocks.callOrder.push('addTrack');
                arrangementState = {
                    ...arrangementState,
                    tracks: [...arrangementState.tracks, track],
                    selectedTrackId: track.id,
                };
                return track;
            });
            mocks.updateTrack.mockImplementation((trackId, updater) => {
                mocks.callOrder.push('updateTrack');
                if (failurePoint === 'update') {
                    throw originalFailure;
                }
                arrangementState = {
                    ...arrangementState,
                    tracks: arrangementState.tracks.map((track) => (track.id === trackId ? updater(track) : track)),
                };
            });
            mocks.duplicateMidiClipData.mockImplementation(() => {
                mocks.callOrder.push('duplicateMidiClipData');
                if (failurePoint === 'midi') {
                    throw originalFailure;
                }
                midiState = { values: ['midi-committed'] };
                return () => {
                    mocks.callOrder.push('rollbackMidi');
                    midiState = midiSnapshot;
                };
            });
            mocks.duplicateClipAutomationBatch.mockImplementation(() => {
                mocks.callOrder.push('duplicateClipAutomationBatch');
                if (failurePoint === 'automation') {
                    throw originalFailure;
                }
                automationState = { values: ['automation-committed'] };
                return () => {
                    mocks.callOrder.push('rollbackAutomation');
                    automationState = automationSnapshot;
                };
            });

            let thrown: unknown;
            try {
                duplicateTrack(source.id);
            } catch (error) {
                thrown = error;
            }

            const expectedOrder = {
                update: ['addTrack', 'updateTrack', 'rollbackArrangement'],
                midi: ['addTrack', 'updateTrack', 'duplicateMidiClipData', 'rollbackArrangement'],
                automation: [
                    'addTrack',
                    'updateTrack',
                    'duplicateMidiClipData',
                    'duplicateClipAutomationBatch',
                    'rollbackMidi',
                    'rollbackArrangement',
                ],
            }[failurePoint];

            expect(thrown).toBe(originalFailure);
            expect(arrangementState).toBe(arrangementSnapshot);
            expect(arrangementState).toEqual(arrangementSnapshotValue);
            expect(midiState).toBe(midiSnapshot);
            expect(midiState).toEqual(midiSnapshotValue);
            expect(automationState).toBe(automationSnapshot);
            expect(automationState).toEqual(automationSnapshotValue);
            expect(mocks.callOrder).toEqual(expectedOrder);
            expect(mocks.eventBus.emit).not.toHaveBeenCalled();
        }
    );

    it('continues reverse rollback after a rollback error without masking the original failure', () => {
        const source = createTrack({
            id: 'track-source',
            alternatives: [
                {
                    id: 'alt-source',
                    name: 'Source alternative',
                    clips: [createClip({ id: 'clip-midi', type: 'midi' })],
                },
            ],
            activeAlternativeId: 'alt-source',
        });
        const arrangementSnapshot: TrackState = { tracks: [source], selectedTrackId: source.id };
        const originalFailure = new Error('automation failed');
        mocks.getTrackById.mockReturnValue(source);
        mocks.getTrackState.mockReturnValue(arrangementSnapshot);
        mocks.setTrackState.mockImplementation(() => {
            mocks.callOrder.push('rollbackArrangement');
        });
        returnCreatedTrack();
        mocks.duplicateMidiClipData.mockImplementation(() => {
            mocks.callOrder.push('duplicateMidiClipData');
            return () => {
                mocks.callOrder.push('rollbackMidi');
                throw new Error('rollback failed');
            };
        });
        mocks.duplicateClipAutomationBatch.mockImplementation(() => {
            mocks.callOrder.push('duplicateClipAutomationBatch');
            throw originalFailure;
        });

        let thrown: unknown;
        try {
            duplicateTrack(source.id);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBe(originalFailure);
        expect(mocks.callOrder).toEqual([
            'updateTrack',
            'duplicateMidiClipData',
            'duplicateClipAutomationBatch',
            'rollbackMidi',
            'rollbackArrangement',
        ]);
        expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not invoke MIDI duplication when the duplicate has no MIDI clips', () => {
        const sourceAudio = createClip({ id: 'clip-audio', type: 'audio' });
        const source = createTrack({
            id: 'track-source',
            kind: 'audio',
            alternatives: [{ id: 'alt-source', name: 'Audio alternative', clips: [sourceAudio] }],
            activeAlternativeId: 'alt-source',
        });
        mocks.getTrackById.mockReturnValue(source);
        returnCreatedTrack();

        duplicateTrack(source.id);

        const updatedTrack = requireUpdatedTrack();
        const copiedAlternative = requireFirst(updatedTrack.alternatives, 'copied audio alternative');
        const copiedAudio = requireFirst(copiedAlternative.clips, 'copied audio clip');

        expect(mocks.duplicateMidiClipData).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomationBatch).toHaveBeenCalledTimes(1);
        expect(mocks.duplicateClipAutomationBatch).toHaveBeenCalledWith({
            copies: [{ sourceClipId: sourceAudio.id, targetClipId: copiedAudio.id, targetTrackId: updatedTrack.id }],
        });
    });
});
