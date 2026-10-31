import { beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import { type ClipRenderModel, type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { commitInlineMidiNoteCreate } from '../../../useCases/timelineInteractions/commitInlineMidiNoteCreate';
import { commitInlineMidiNoteDelete } from '../../../useCases/timelineInteractions/commitInlineMidiNoteDelete';
import { handleDrawTool } from '../timelineTools';

// The draw tool, the hit test and the geometry law run for real; only the
// stores and the note commits are replaced, so this pins what a user sees: a
// click stamps where the pointer is and a second click there hits that note.

const PIXELS_PER_BEAT = 50;

const world = vi.hoisted(() => ({
    clip: null as { startBeat: number; endBeat: number; midiNotes: Array<Record<string, unknown>> } | null,
}));

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
            return {
                tracks: [{ id: 't1', kind: 'midi', clips: [{ id: 'c1', type: 'midi', isInlineEditing: true }] }],
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

const click = (clipBeat: number, contentY: number): void => {
    const absoluteBeat = world.clip!.startBeat + clipBeat;
    handleDrawTool(absoluteBeat * PIXELS_PER_BEAT, contentY, absoluteBeat, { current: null });
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
        // Empty window is 54..66 over a 76px area starting at y=2 (rows of ~5.85px). Row 3 is pitch 63.
        // 2.4 beats into the clip is the right half of the 2..2.5 cell of the half-beat grid.
        click(2.4, 2 + 5.846 * 3.5);

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledWith({
            clipId: 'c1',
            pitch: 63,
            startBeat: 2,
            duration: 0.5,
            velocity: 100,
        });
    });

    it('hits the stamped note on a second click at the same point instead of stacking another', () => {
        // Middle C is the one row whose note leaves the auto-fitted pitch window where it was.
        const y = 2 + 5.846 * 6.5;
        click(2.4, y);
        click(2.4, y);

        expect(commitInlineMidiNoteCreate).toHaveBeenCalledTimes(1);
        expect(commitInlineMidiNoteDelete).toHaveBeenCalledTimes(1);
        expect(commitInlineMidiNoteDelete).toHaveBeenCalledWith({ clipId: 'c1', noteId: 'n0' });
    });

    it('stamps on the pitch row of each click, not on one fixed pitch', () => {
        click(1, 2 + 5.846 * 0.5);
        world.clip!.midiNotes.length = 0;
        click(5, 2 + 5.846 * 11.5);

        expect(vi.mocked(commitInlineMidiNoteCreate).mock.calls.map(([input]) => input.pitch)).toEqual([66, 55]);
    });
});
