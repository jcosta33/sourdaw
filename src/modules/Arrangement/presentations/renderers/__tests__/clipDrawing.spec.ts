import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ClipRenderModel, type TimelineRenderModel } from '../../models/TimelineRenderModel';
import { drawClip } from '../clipDrawing';

describe('drawClip (Coordinate Conventions)', () => {
    let mockCtx: any;

    beforeEach(() => {
        mockCtx = {
            beginPath: vi.fn(),
            roundRect: vi.fn(),
            fill: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            shadowColor: '',
            shadowBlur: 0,
            shadowOffsetY: 0,
            stroke: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            clearRect: vi.fn(),
            clip: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            fillRect: vi.fn(),
            createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
            arc: vi.fn(),
            measureText: vi.fn().mockReturnValue({ width: 10 }),
            fillText: vi.fn(),
        };
    });

    it('draws notes using clip-relative coordinates, regardless of the clip absolute startBeat', () => {
        const clip: ClipRenderModel = {
            id: 'c1',
            startBeat: 8, // Clip starts at beat 8 on timeline
            endBeat: 12,
            name: 'Test Clip',
            type: 'midi',
            midiNotes: [
                {
                    id: 'n1',
                    clipId: 'c1',
                    startBeat: 0, // Clip-relative
                    duration: 1,
                    pitch: 60,
                    velocity: 100,
                },
            ],
            isSelected: false,
            color: '#000',
            trackId: 't1',
            opacity: 1,
            audioBufferId: null,
            loopEnabled: false,
            loopLength: null,
            midiOffsetBeats: 0,
        } as any;

        const model: TimelineRenderModel = {
            tracks: [],
            viewportStartBeat: 0,
            viewportEndBeat: 16,
            pixelsPerBeat: 25,
            selectedClipIds: [],
            selectedClipId: null,
            theme: {
                clipBorder: '#000',
                clipText: '#000',
                midiNote: '#000',
                midiNoteBorder: '#000',
                midiNoteActive: '#000',
                selectionOverlay: '#000',
                clipBackground: '#000',
                shadowColor: '#000',
            },
        };

        const trackY = 100;
        const trackHeight = 10;

        drawClip(mockCtx, clip, model, trackY, trackHeight);

        // The note should be drawn at the very beginning of the clip visual bounds.
        // x = (8 - 0) * 25 = 200 (clipX)
        // w = (12 - 8) * 25 = 100 (clipW)
        // nx = 200 + (0 / 4) * 100 = 200

        // Because trackHeight = 10 (<= 24), it is inline, so it draws using roundRect
        const noteCall = mockCtx.roundRect.mock.calls.find((args: any[]) => args[0] === 200 && args[2] <= 100);
        expect(noteCall).toBeTruthy();
        expect(noteCall[0]).toBe(200);
    });
});
