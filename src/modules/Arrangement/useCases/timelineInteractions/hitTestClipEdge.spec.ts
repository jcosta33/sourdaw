import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type TimelineRenderModel } from '../../models/TimelineRenderModel';
import { getTrackAtY } from './getTrackAtY';
import { hitTestClipEdge } from './hitTestClipEdge';

describe('hitTestClipEdge', () => {
    beforeEach(() => {
        Container.clear();
    });

    const baseModel: TimelineRenderModel = {
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

    function setup(): void {
        injectDependencies(hitTestClipEdge, {
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => baseModel,
            getTrackAtY,
        });
    }

    it('detects left edge near clip start in pixels', () => {
        setup();
        expect(hitTestClipEdge(5, 10)).toEqual({ clipId: 'c1', trackId: 't1', edge: 'left' });
    });

    it('detects right edge near clip end in pixels', () => {
        setup();
        expect(hitTestClipEdge(75, 10)).toEqual({ clipId: 'c1', trackId: 't1', edge: 'right' });
    });

    it('detects body away from edges', () => {
        setup();
        expect(hitTestClipEdge(40, 10)).toEqual({ clipId: 'c1', trackId: 't1', edge: 'body' });
    });

    it('returns null when view state is missing', () => {
        injectDependencies(hitTestClipEdge, {
            timelineViewStore: {
                value: null,
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => baseModel,
            getTrackAtY,
        });
        expect(hitTestClipEdge(0, 0)).toBeNull();
    });
});
