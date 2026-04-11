import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type TimelineRenderModel } from '../../models/TimelineRenderModel';
import { getTrackAtY } from './getTrackAtY';
import { hitTestClip } from './hitTestClip/hitTestClip';
import { hitTestTrack } from './hitTestClip/hitTestTrack';

describe('hitTestClip', () => {
    beforeEach(() => {
        Container.clear();
    });

    const mockModel: TimelineRenderModel = {
        dataDirty: false,
        tracks: [
            {
                id: 't1',
                name: 'One',
                index: 0,
                kind: 'midi',
                color: '#000',
                muted: false,
                soloed: false,
                height: 64,
                clips: [
                    {
                        id: 'c1',
                        startBeat: 0,
                        endBeat: 8,
                        name: 'Clip',
                        color: '#000',
                        type: 'midi',
                        muted: false,
                        midiNotes: [],
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                ],
                automationMode: 'read',
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 32,
        beatsPerPixel: 0.1,
        pixelsPerBeat: 10,
        trackHeight: 48,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };

    it('returns clip and track when beat falls inside a clip', () => {
        injectDependencies(hitTestClip, {
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => mockModel,
            getTrackAtY,
        });

        const hit = hitTestClip(25, 10);
        expect(hit).toEqual({ clipId: 'c1', trackId: 't1' });
    });

    it('returns null when there is no view state', () => {
        injectDependencies(hitTestClip, {
            timelineViewStore: {
                value: null,
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => mockModel,
            getTrackAtY,
        });

        expect(hitTestClip(0, 0)).toBeNull();
    });
});

describe('hitTestTrack', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns track id at y', () => {
        const mockModel: TimelineRenderModel = {
            dataDirty: false,
            tracks: [
                {
                    id: 't1',
                    name: 'One',
                    index: 0,
                    kind: 'midi',
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 64,
                    clips: [],
                    automationMode: 'read',
                },
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            playheadPosition: 0,
            viewportStartBeat: 0,
            viewportEndBeat: 32,
            beatsPerPixel: 0.1,
            pixelsPerBeat: 10,
            trackHeight: 48,
            scrollY: 0,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };

        injectDependencies(hitTestTrack, {
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => mockModel,
            getTrackAtY,
        });

        expect(hitTestTrack(10)).toBe('t1');
    });
});
