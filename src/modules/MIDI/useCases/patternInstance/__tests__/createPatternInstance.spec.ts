import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPatternInstance } from '../createPatternInstance';

type TargetInput = { clipId: string } | { trackId: string };
type TargetResolution =
    | { status: 'eligible'; trackId: string; clipId?: string }
    | {
          status: 'missing' | 'ineligible';
      };

type ClipFixture = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    parentClipId?: string;
    overrides?: Record<string, boolean>;
};

type TrackFixture = {
    id: string;
    kind: string;
    clips: ClipFixture[];
};

const mocks = vi.hoisted(() => {
    const trackStoreValue: { current: unknown } = { current: null };
    return {
        trackStoreValue,
        resolveEligibleClipWriteTarget: vi.fn<(input: TargetInput) => TargetResolution>(),
        appendClipToTrack: vi.fn<(trackId: string, clip: unknown) => boolean>(),
        getNotesForClip: vi.fn<(clipId: string) => unknown[]>(),
        setNotesForClip: vi.fn<(clipId: string, notes: unknown[]) => void>(),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.current;
        },
    },
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
    appendClipToTrack: mocks.appendClipToTrack,
}));

vi.mock('../../../useCases/midiNoteCrud/getNotesForClip', () => ({
    getNotesForClip: mocks.getNotesForClip,
}));

vi.mock('../../../useCases/midiNoteCrud/setNotesForClip', () => ({
    setNotesForClip: mocks.setNotesForClip,
}));

function makeClip(overrides: Partial<ClipFixture> = {}): ClipFixture {
    return {
        id: 'source-clip',
        trackId: 'source-track',
        name: 'Loop',
        startBeat: 4,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0.25,
        fadeOutBeats: 0.5,
        gain: 0.75,
        color: '#123456',
        locked: true,
        muted: true,
        ...overrides,
    };
}

function setTracks(tracks: TrackFixture[]): void {
    mocks.trackStoreValue.current = { tracks };
}

function setEligibleProject(sourceClip = makeClip(), destinationKind = 'midi', sourceKind = sourceClip.type): void {
    setTracks([
        { id: sourceClip.trackId, kind: sourceKind, clips: [sourceClip] },
        { id: 'destination-track', kind: destinationKind, clips: [] },
    ]);
    mocks.resolveEligibleClipWriteTarget.mockImplementation((input) => {
        if ('clipId' in input) {
            return { status: 'eligible', trackId: sourceClip.trackId, clipId: sourceClip.id };
        }
        return { status: 'eligible', trackId: input.trackId };
    });
}

function expectNoCreationEffects(randomUuid: ReturnType<typeof vi.spyOn>): void {
    expect(randomUuid).not.toHaveBeenCalled();
    expect(mocks.getNotesForClip).not.toHaveBeenCalled();
    expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    expect(mocks.appendClipToTrack).not.toHaveBeenCalled();
}

describe('createPatternInstance', () => {
    let randomUuid: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.trackStoreValue.current = null;
        mocks.resolveEligibleClipWriteTarget.mockReset();
        mocks.appendClipToTrack.mockReset();
        mocks.getNotesForClip.mockReset();
        mocks.setNotesForClip.mockReset();
        mocks.appendClipToTrack.mockReturnValue(true);
        mocks.getNotesForClip.mockReturnValue([]);
        randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        { sourceKind: 'audio' as const, destinationKind: 'midi', sourceType: 'audio' as const },
        { sourceKind: 'midi' as const, destinationKind: 'audio', sourceType: 'midi' as const },
    ])(
        'preserves valid $sourceKind-to-$destinationKind behavior, identity, timing, inherited properties, and notes',
        ({ sourceKind, destinationKind, sourceType }) => {
            const sourceClip = makeClip({
                parentClipId: 'root-pattern',
                overrides: { notes: true },
                type: sourceType,
            });
            setEligibleProject(sourceClip, destinationKind, sourceKind);
            mocks.getNotesForClip.mockReturnValue([
                { id: 'note-1', startBeat: 5, duration: 1, pitch: 60, velocity: 0.8 },
            ]);

            const instanceId = createPatternInstance(sourceClip.id, 'destination-track', 16);

            expect(instanceId).toBe('clip-inst-00000000-0000-4000-8000-000000000001');
            if (instanceId === null) {
                throw new Error('Expected a pattern-instance identity');
            }
            expect(mocks.resolveEligibleClipWriteTarget.mock.calls).toEqual([
                [{ clipId: sourceClip.id }],
                [{ trackId: 'destination-track' }],
            ]);
            expect(mocks.appendClipToTrack).toHaveBeenCalledOnce();
            expect(mocks.appendClipToTrack).toHaveBeenCalledWith('destination-track', {
                id: instanceId,
                trackId: 'destination-track',
                name: 'Loop (instance)',
                startBeat: 16,
                endBeat: 20,
                type: sourceType,
                fadeInBeats: 0.25,
                fadeOutBeats: 0.5,
                gain: 0.75,
                color: '#123456',
                locked: false,
                muted: false,
                parentClipId: 'root-pattern',
                overrides: {},
            });
            expect(mocks.setNotesForClip).toHaveBeenCalledWith(instanceId, [
                {
                    id: `note-inst-${instanceId}-note-1`,
                    startBeat: 17,
                    duration: 1,
                    pitch: 60,
                    velocity: 0.8,
                },
            ]);

            const appendOrder = mocks.appendClipToTrack.mock.invocationCallOrder[0];
            const notePublicationOrder = mocks.setNotesForClip.mock.invocationCallOrder[0];
            expect(appendOrder).toBeLessThan(notePublicationOrder ?? Number.POSITIVE_INFINITY);
        }
    );

    it('returns null without publishing notes when the Arrangement append gateway rejects the instance', () => {
        setEligibleProject();
        mocks.getNotesForClip.mockReturnValue([{ id: 'note-1', startBeat: 5, duration: 1, pitch: 60 }]);
        mocks.appendClipToTrack.mockReturnValue(false);

        const result = createPatternInstance('source-clip', 'destination-track', 16);

        expect(result).toBeNull();
        expect(mocks.appendClipToTrack).toHaveBeenCalledOnce();
        expect(mocks.getNotesForClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'missing source clip',
            sourceClipId: 'missing',
            tracks: [{ id: 'destination-track', kind: 'midi', clips: [] }],
            sourceResolution: { status: 'missing' } as const,
        },
        {
            name: 'empty source identity',
            sourceClipId: '',
            tracks: [
                { id: 'source-track', kind: 'midi', clips: [makeClip({ id: '' })] },
                { id: 'destination-track', kind: 'midi', clips: [] },
            ],
            sourceResolution: { status: 'ineligible' } as const,
        },
        {
            name: 'malformed source owner',
            sourceClipId: 'source-clip',
            tracks: [
                { id: 'source-track', kind: 'unexpected', clips: [makeClip()] },
                { id: 'destination-track', kind: 'midi', clips: [] },
            ],
            sourceResolution: { status: 'ineligible' } as const,
        },
        {
            name: 'runtime-VCA source owner',
            sourceClipId: 'source-clip',
            tracks: [
                { id: 'source-track', kind: 'vca', clips: [makeClip()] },
                { id: 'destination-track', kind: 'midi', clips: [] },
            ],
            sourceResolution: { status: 'ineligible' } as const,
        },
        {
            name: 'duplicate source clip ownership',
            sourceClipId: 'source-clip',
            tracks: [
                { id: 'source-track', kind: 'midi', clips: [makeClip()] },
                {
                    id: 'second-source-track',
                    kind: 'midi',
                    clips: [makeClip({ trackId: 'second-source-track' })],
                },
                { id: 'destination-track', kind: 'midi', clips: [] },
            ],
            sourceResolution: { status: 'ineligible' } as const,
        },
        {
            name: 'duplicate source track identity',
            sourceClipId: 'source-clip',
            tracks: [
                { id: 'source-track', kind: 'midi', clips: [makeClip()] },
                { id: 'source-track', kind: 'midi', clips: [] },
                { id: 'destination-track', kind: 'midi', clips: [] },
            ],
            sourceResolution: { status: 'ineligible' } as const,
        },
    ])('rejects a $name before UUID, note, gateway, or store effects', (scenario) => {
        setTracks(scenario.tracks);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue(scenario.sourceResolution);

        const result = createPatternInstance(scenario.sourceClipId, 'destination-track', 16);

        expect(result).toBeNull();
        expect(mocks.resolveEligibleClipWriteTarget).toHaveBeenCalledWith({ clipId: scenario.sourceClipId });
        expectNoCreationEffects(randomUuid);
    });

    it.each([
        {
            name: 'missing destination track',
            targetTrackId: 'missing',
            targetResolution: { status: 'missing' } as const,
            destination: null,
        },
        {
            name: 'empty destination identity',
            targetTrackId: '',
            targetResolution: { status: 'ineligible' } as const,
            destination: { id: '', kind: 'midi', clips: [] },
        },
        {
            name: 'malformed destination owner',
            targetTrackId: 'destination-track',
            targetResolution: { status: 'ineligible' } as const,
            destination: { id: 'destination-track', kind: 'unexpected', clips: [] },
        },
        {
            name: 'runtime-VCA destination owner',
            targetTrackId: 'destination-track',
            targetResolution: { status: 'ineligible' } as const,
            destination: { id: 'destination-track', kind: 'vca', clips: [] },
        },
        {
            name: 'duplicate destination identity',
            targetTrackId: 'destination-track',
            targetResolution: { status: 'ineligible' } as const,
            destination: { id: 'destination-track', kind: 'midi', clips: [] },
            duplicateDestination: true,
        },
    ])('rejects a $name before UUID, note, gateway, or store effects', (scenario) => {
        const sourceClip = makeClip();
        const tracks: TrackFixture[] = [{ id: 'source-track', kind: 'midi', clips: [sourceClip] }];
        if (scenario.destination) {
            tracks.push(scenario.destination);
        }
        if (scenario.duplicateDestination) {
            tracks.push({ ...scenario.destination, clips: [] });
        }
        setTracks(tracks);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input) => {
            if ('clipId' in input) {
                return { status: 'eligible', trackId: 'source-track', clipId: sourceClip.id };
            }
            return scenario.targetResolution;
        });

        const result = createPatternInstance(sourceClip.id, scenario.targetTrackId, 16);

        expect(result).toBeNull();
        expect(mocks.resolveEligibleClipWriteTarget.mock.calls).toEqual([
            [{ clipId: sourceClip.id }],
            [{ trackId: scenario.targetTrackId }],
        ]);
        expectNoCreationEffects(randomUuid);
    });
});
