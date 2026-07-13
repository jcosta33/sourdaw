import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createEventBus } from '#/infra/events/createEventBus';

import { type Clip, type Track, type TrackKind } from '../../models/Track';
import { duplicateTrack } from '../duplicateTrack';

import type { TrackAddedPayload } from '../../events';

type ClipCopy = { sourceClipId: string; targetClipId: string };
type AddTrackInput = {
    id?: string;
    name: string;
    kind: TrackKind;
    select?: boolean;
    suppressAddedEvent?: boolean;
};
type AddTrack = (input: AddTrackInput) => Track | null;
type UpdateTrack = (trackId: string, updater: (track: Track) => Track) => void;
type DuplicateMidiClipData = (input: { copies: readonly ClipCopy[] }) => void;
type DuplicateClipAutomation = (sourceClipId: string, targetClipId: string) => void;
type EmitTrackAdded = (event: 'track.added', payload: TrackAddedPayload) => Promise<void>;
type DuplicateTrackEvents = { 'track.added': TrackAddedPayload };

const mocks = vi.hoisted(() => {
    const callOrder: string[] = [];

    return {
        callOrder,
        getTrackById: vi.fn<(trackId: string) => Track | undefined>(),
        updateTrack: vi.fn<UpdateTrack>(),
        addTrack: vi.fn<AddTrack>(),
        duplicateMidiClipData: vi.fn<DuplicateMidiClipData>(),
        duplicateClipAutomation: vi.fn<DuplicateClipAutomation>(),
        eventBus: {
            emit: vi.fn<EmitTrackAdded>(),
        },
    };
});

vi.mock('../../repositories/track/getTrackById', () => ({ getTrackById: mocks.getTrackById }));
vi.mock('../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../addTrack', () => ({ addTrack: mocks.addTrack }));
vi.mock('#/modules/MIDI/useCases', () => ({ duplicateMidiClipData: mocks.duplicateMidiClipData }));
vi.mock('#/modules/Automation/useCases', () => ({ duplicateClipAutomation: mocks.duplicateClipAutomation }));

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
        mocks.addTrack.mockReturnValue(null);
        mocks.updateTrack.mockImplementation(() => {
            mocks.callOrder.push('updateTrack');
        });
        mocks.duplicateMidiClipData.mockImplementation(() => {
            mocks.callOrder.push('duplicateMidiClipData');
        });
        mocks.duplicateClipAutomation.mockImplementation((sourceClipId) => {
            mocks.callOrder.push(`duplicateClipAutomation:${sourceClipId}`);
        });
    });

    it('does nothing when the source track is missing', () => {
        duplicateTrack('track-missing');

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.duplicateMidiClipData).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomation).not.toHaveBeenCalled();
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
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.duplicateMidiClipData).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomation).not.toHaveBeenCalled();
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
        expect(mocks.duplicateClipAutomation).toHaveBeenCalledTimes(3);
        expect(mocks.duplicateClipAutomation).toHaveBeenNthCalledWith(1, sourceMidiOne.id, copiedMidiOne.id);
        expect(mocks.duplicateClipAutomation).toHaveBeenNthCalledWith(2, sourceAudio.id, copiedAudio.id);
        expect(mocks.duplicateClipAutomation).toHaveBeenNthCalledWith(3, sourceMidiTwo.id, copiedMidiTwo.id);
        expect(mocks.callOrder).toEqual([
            'updateTrack',
            'duplicateMidiClipData',
            `duplicateClipAutomation:${sourceMidiOne.id}`,
            `duplicateClipAutomation:${sourceAudio.id}`,
            `duplicateClipAutomation:${sourceMidiTwo.id}`,
        ]);
    });

    it('emits track.added after the duplicate is fully visible to event handlers', () => {
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
        const observer = vi.fn((payload: TrackAddedPayload) => {
            const observableTrack = duplicatedTrack;
            if (!observableTrack) {
                throw new Error('Expected duplicate track during track.added');
            }

            const activeAlternative = observableTrack.alternatives.find(
                (alternative) => alternative.id === observableTrack.activeAlternativeId
            );
            if (!activeAlternative) {
                throw new Error('Expected active alternative during track.added');
            }

            expect(payload).toEqual({
                trackId: observableTrack.id,
                name: `${source.name} (copy)`,
                kind: source.kind,
            });
            expect(observableTrack.alternatives).toHaveLength(1);
            expect(observableTrack.clips).toEqual(activeAlternative.clips);
            expect(mocks.duplicateMidiClipData).toHaveBeenCalledTimes(1);
            expect(mocks.duplicateClipAutomation).toHaveBeenCalledTimes(2);
            expect(mocks.callOrder).toEqual([
                'updateTrack',
                'duplicateMidiClipData',
                `duplicateClipAutomation:${sourceMidi.id}`,
                `duplicateClipAutomation:${sourceAudio.id}`,
            ]);
        });
        eventBus.on('track.added', observer);
        injectDependencies(duplicateTrack, { eventBus });

        duplicateTrack(source.id);

        expect(observer).toHaveBeenCalledTimes(1);
        expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it.each([
        [
            'updating the duplicate',
            () => {
                mocks.updateTrack.mockImplementation(() => {
                    throw new Error('update failed');
                });
            },
        ],
        [
            'duplicating MIDI clip data',
            () => {
                mocks.duplicateMidiClipData.mockImplementation(() => {
                    throw new Error('MIDI duplication failed');
                });
            },
        ],
        [
            'duplicating clip automation',
            () => {
                mocks.duplicateClipAutomation.mockImplementation(() => {
                    throw new Error('automation duplication failed');
                });
            },
        ],
    ])('does not emit track.added when %s throws', (_step, configureThrow) => {
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
        mocks.getTrackById.mockReturnValue(source);
        returnCreatedTrack();
        configureThrow();

        expect(() => duplicateTrack(source.id)).toThrow();

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
        expect(mocks.duplicateClipAutomation).toHaveBeenCalledTimes(1);
        expect(mocks.duplicateClipAutomation).toHaveBeenCalledWith(sourceAudio.id, copiedAudio.id);
    });
});
