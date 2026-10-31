import { beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import {
    forEachMidiNoteRect,
    resolveMidiPitchWindow,
    type InlineMidiGeometryClip,
} from '../../../models/InlineMidiGeometry';
import { type ClipRenderModel, type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { commitInlineMidiNoteCreate } from '../../../useCases/timelineInteractions/commitInlineMidiNoteCreate';
import { commitInlineMidiNoteDelete } from '../../../useCases/timelineInteractions/commitInlineMidiNoteDelete';
import { handleDrawTool } from '../timelineTools';

// The draw tool, the hit test and the geometry law run for real; only the
// stores and the note commits are replaced, so this pins what a user sees: a
// click stamps where the pointer is and a second click there hits that note.

const PIXELS_PER_BEAT = 50;

type WorldClip = {
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    midiNotes: Array<Record<string, unknown>>;
};

const world = vi.hoisted(() => ({ clip: null as WorldClip | null }));

vi.mock('#/modules/Automation/useCases', () => ({ getAutomationLanes: vi.fn().mockReturnValue([]) }));
vi.mock('../../../useCases/clipEditing/splitClipWithUndo', () => ({ splitClipWithUndo: vi.fn() }));
vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteCreate', () => ({
    commitInlineMidiNoteCreate: vi.fn(),
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteDelete', () => ({
    commitInlineMidiNoteDelete: vi.fn(),
}));
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: { value: { pixelsPerBeat: 50, scrollX: 0, scrollY: 0 } },
}));
vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            const { midiNotes: _notes, ...timing } = world.clip!;
            return {
                tracks: [
                    { id: 't1', kind: 'midi', clips: [{ id: 'c1', type: 'midi', isInlineEditing: true, ...timing }] },
                ],
            };
        },
    },
}));
vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: (): TimelineRenderModel => {
        const clip = world.clip!;
        const renderClip: ClipRenderModel = {
            id: 'c1',
            name: 'Clip',
            color: '#000',
            type: 'midi',
            muted: false,
            isInlineEditing: true,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            midiOffsetBeats: clip.midiOffsetBeats,
            loopEnabled: clip.loopEnabled,
            loopLength: clip.loopLength,
            midiNotes: clip.midiNotes as ClipRenderModel['midiNotes'],
        };
        return {
            dataDirty: false,
            tracks: [
                {
                    id: 't1',
                    name: 'T',
                    index: 0,
                    kind: 'midi',
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 80,
                    clips: [renderClip],
                    automationMode: 'read',
                },
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            playheadPosition: 0,
            viewportStartBeat: 0,
            viewportEndBeat: 32,
            beatsPerPixel: 1 / 50,
            pixelsPerBeat: 50,
            trackHeight: 80,
            scrollY: 0,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };
    },
}));

// The empty inline window is 60..71 over a 76px area starting at y=2: twelve rows of 76 / 12 px.
const ROW_HEIGHT = 76 / 12;
const rowY = (row: number): number => 2 + ROW_HEIGHT * (row + 0.5);

const clickAt = (arrangementBeat: number, contentY: number): void => {
    handleDrawTool(arrangementBeat * PIXELS_PER_BEAT, contentY, arrangementBeat, { current: null });
};

const stampedStartBeats = (): number[] =>
    vi.mocked(commitInlineMidiNoteCreate).mock.calls.map(([input]) => input.startBeat);

const drawnRectOf = (noteId: string): { x: number; y: number; width: number; height: number } | undefined => {
    const clip = world.clip!;
    const frame = {
        x: clip.startBeat * PIXELS_PER_BEAT,
        width: (clip.endBeat - clip.startBeat) * PIXELS_PER_BEAT,
        contentTop: 2,
        contentHeight: 76,
    };
    const notes = clip.midiNotes as unknown as InlineMidiGeometryClip['midiNotes'];
    const window = resolveMidiPitchWindow(notes, true, frame.contentHeight);
    let found: { x: number; y: number; width: number; height: number } | undefined;
    forEachMidiNoteRect({ ...clip, midiNotes: notes }, frame, window, { inline: true }, (note, x, y, width, height) => {
        if (note.id === noteId) {
            found = { x, y, width, height };
        }
    });
    return found;
};

describe('handleDrawTool on an inline MIDI clip, with the real hit test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        preferencesStore.set({ ...defaultPreferences, snapToGrid: true, gridSubdivision: '1/2' });
        // Clip at bar 3, empty.
        world.clip = { startBeat: 8, endBeat: 16, midiNotes: [] };
        vi.mocked(commitInlineMidiNoteCreate).mockImplementation((input) => {
            world.clip!.midiNotes.push({
                id: `n${world.clip!.midiNotes.length}`,
                pitch: input.pitch,
                startBeat: input.startBeat,
                duration: input.duration,
            });
            return true;
        });
    });

    it('stamps the cell under the pointer, clip-relative, at the pointer pitch', () => {
        // 10.4 is 2.4 beats into the clip: the right half of the 2..2.5 cell of the half-beat grid. Row 3 is pitch 68.
        clickAt(10.4, rowY(3));

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledWith({
            clipId: 'c1',
            pitch: 68,
            startBeat: 2,
            duration: 0.5,
            velocity: 100,
        });
    });

    it('hits a note drawn off middle C on a second click at the same point instead of stacking another', () => {
        clickAt(10.4, rowY(3));
        clickAt(10.4, rowY(3));

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledTimes(1);
        expect(commitInlineMidiNoteDelete).toHaveBeenCalledTimes(1);
        expect(commitInlineMidiNoteDelete).toHaveBeenCalledWith({ clipId: 'c1', noteId: 'n0' });
    });

    it('leaves a drawn note where it is when another note is drawn in a visible row', () => {
        clickAt(10.4, rowY(3));
        const before = drawnRectOf('n0');

        clickAt(12.2, rowY(9));
        const after = drawnRectOf('n0');

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledTimes(2);
        expect(before).toBeDefined();
        expect(after).toEqual(before);
    });

    it('stamps on the pitch row of each click, not on one fixed pitch', () => {
        clickAt(9, rowY(0));
        world.clip!.midiNotes.length = 0;
        clickAt(13, rowY(11));

        expect(vi.mocked(commitInlineMidiNoteCreate).mock.calls.map(([input]) => input.pitch)).toEqual([71, 60]);
    });

    it('deletes a note clicked in the strip a bar leaves under itself instead of stacking another', () => {
        clickAt(10.4, rowY(3));
        const bar = drawnRectOf('n0')!;

        // Inside the row, below the one-pixel inset: the bar is not drawn there, the note is still under the pointer.
        clickAt(10.4, bar.y + bar.height + 0.5);

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledTimes(1);
        expect(commitInlineMidiNoteDelete).toHaveBeenCalledWith({ clipId: 'c1', noteId: 'n0' });
    });

    it('stamps in a loop repeat beyond the hundredth and hits it there on a second click', () => {
        // 128 beats on a 1-beat loop: pass 120 is far past any fixed repeat count.
        world.clip = { startBeat: 8, endBeat: 136, loopEnabled: true, loopLength: 1, midiNotes: [] };

        clickAt(128.4, rowY(3));
        clickAt(128.4, rowY(3));

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledTimes(1);
        expect(commitInlineMidiNoteDelete).toHaveBeenCalledWith({ clipId: 'c1', noteId: 'n0' });
    });

    describe('a clip that starts off the grid', () => {
        beforeEach(() => {
            world.clip = { startBeat: 8.25, endBeat: 16.25, midiNotes: [] };
        });

        it('stamps the cell of the visible grid under the pointer, not a cell of the clip own beats', () => {
            // The visible cell is 9..9.5, which is 0.75 beat into the clip; the clip-relative cell would be 0.5.
            clickAt(9.1, rowY(3));

            expect(stampedStartBeats()).toEqual([0.75]);
        });

        it('adds the content offset to the visible cell start', () => {
            world.clip = { ...world.clip!, midiOffsetBeats: 0.25 };

            clickAt(9.1, rowY(3));

            expect(stampedStartBeats()).toEqual([1]);
        });

        it('maps the visible cell of a loop repeat back into the first pass', () => {
            world.clip = { ...world.clip!, loopEnabled: true, loopLength: 3 };

            // Visible cell 12.5..13 is 4.25 beats into the clip and 1.25 into its second pass.
            clickAt(12.6, rowY(3));

            expect(stampedStartBeats()).toEqual([1.25]);
        });

        it('clamps a cell that starts before the clip to the clip start', () => {
            // The visible cell 8..8.5 begins 0.25 before the clip.
            clickAt(8.3, rowY(3));

            expect(stampedStartBeats()).toEqual([0]);
        });

        it('stamps the next cell on a later click instead of hitting an overhang of the cut cell', () => {
            preferencesStore.set({ ...defaultPreferences, snapToGrid: true, gridSubdivision: 'beat' });
            world.clip = { ...world.clip!, startBeat: 8.3, endBeat: 12.3 };

            clickAt(8.5, rowY(3));
            clickAt(9.1, rowY(3));

            // The first note ends at beat 9, so the click at 9.1 is empty space and stamps the cell 9..10.
            expect(commitInlineMidiNoteDelete).not.toHaveBeenCalled();
            expect(stampedStartBeats()[0]).toBeCloseTo(0);
            expect(stampedStartBeats()[1]).toBeCloseTo(0.7);
        });

        it('stamps the unsnapped pointer beat, mapped the same way, with the grid off', () => {
            preferencesStore.set({ ...defaultPreferences, snapToGrid: false });
            world.clip = { ...world.clip!, midiOffsetBeats: 0.25 };

            clickAt(9.1, rowY(3));

            expect(stampedStartBeats()[0]).toBeCloseTo(1.1, 6);
        });
    });
});
