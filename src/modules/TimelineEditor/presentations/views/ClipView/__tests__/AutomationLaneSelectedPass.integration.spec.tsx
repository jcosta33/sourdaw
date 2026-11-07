import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { AutomationLane } from '../AutomationLane';

const ctx2d = document.createElement('canvas').getContext('2d')!;
const notes = () => midiStore.value!.notesByClipId['clip-1']!;
const modes = [
    { mode: 'velocity', label: 'Velocity', property: 'velocity', before: 80, after: 127 },
    { mode: 'probability', label: 'Probability', property: 'probability', before: 55, after: 100 },
    { mode: 'pressure', label: 'Pressure', property: 'pressure', before: 25, after: 127 },
    { mode: 'slide', label: 'Slide', property: 'slide', before: 35, after: 127 },
] as const;

function renderDefaultStrip(): void {
    render(
        <AutomationLane
            clipId="clip-1"
            trackId="track-1"
            selectedNoteIds={new Set(['lap1', 'lap2', 'lap3'])}
            beatWidth={40}
            contentWidth={480}
            scrollRef={{ current: null }}
        />
    );
}

describe('default ClipView AutomationLane selected recorded pass (real wrappers and MIDI owner)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('default property strip recorded pass');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        const track = createTrack({ id: 'track-1', kind: 'midi', name: 'Cycle' });
        track.devices = [{ id: 'device', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }];
        track.clips.push({
            id: 'clip-1',
            trackId: track.id,
            name: 'Cycle',
            type: 'midi',
            startBeat: 0,
            endBeat: 4,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#fff',
            locked: false,
            muted: false,
        });
        trackStore.set({ tracks: [track], selectedTrackId: track.id });
        midiStore.set({
            probabilitySeed: 1,
            ccByClipId: {},
            pitchBendByClipId: {},
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'lap1',
                        pitch: 60,
                        startBeat: 1,
                        duration: 1,
                        velocity: 30,
                        probability: 20,
                        pressure: 10,
                        slide: 15,
                        recordingPassId: 'pass-1',
                    },
                    {
                        id: 'lap2',
                        pitch: 64,
                        startBeat: 5,
                        duration: 1,
                        velocity: 80,
                        probability: 55,
                        pressure: 25,
                        slide: 35,
                        recordingPassId: 'pass-2',
                        expression: {
                            pressure: [{ offsetBeats: 0.25, value: 90 }],
                            slide: [{ offsetBeats: 0.5, value: 70 }],
                        },
                    },
                    {
                        id: 'lap3',
                        pitch: 67,
                        startBeat: 9,
                        duration: 1,
                        velocity: 90,
                        probability: 90,
                        pressure: 40,
                        slide: 45,
                        recordingPassId: 'pass-3',
                    },
                ],
            },
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track-1',
                    activeCompRegions: [],
                    takes: [
                        {
                            id: 'take2',
                            clipId: 'clip-1',
                            name: 'Lap2',
                            startBeat: 0,
                            endBeat: 4,
                            selected: true,
                            sourceOffsetBeats: 4,
                            recordingPassId: 'pass-2',
                        },
                        {
                            id: 'take3',
                            clipId: 'clip-1',
                            name: 'Lap3',
                            startBeat: 0,
                            endBeat: 4,
                            selected: false,
                            sourceOffsetBeats: 8,
                            recordingPassId: 'pass-3',
                        },
                    ],
                },
            ],
        });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 480, 131));
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(480);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        clearUndoHistory();
        resetActionReplayAuthority();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(modes)(
        'default $label route draws one wrapped bar and preserves other passes through actual edit and Undo/Redo',
        async ({ mode, label, property, before, after }) => {
            const roundRect = vi.spyOn(ctx2d, 'roundRect');
            roundRect.mockClear();
            renderDefaultStrip();
            if (mode !== 'velocity') {
                roundRect.mockClear();
                fireEvent.change(screen.getByLabelText('Automation lane type'), { target: { value: mode } });
            }
            expect(roundRect).toHaveBeenCalledTimes(1);
            expect(roundRect).toHaveBeenCalledWith(41, 129 - before, 38, before, [2, 2, 0, 0]);
            const original = structuredClone(notes());
            const canvas = screen.getByLabelText(`${label} lane`).querySelector('canvas')!;
            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 50, clientY: 2 });
            fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 50, clientY: 2 });
            const edited = [original[0], { ...original[1], [property]: after }, original[2]];
            expect(notes()).toEqual(edited);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            await act(async () => {
                await undo();
            });
            expect(notes()).toEqual(original);
            await act(async () => {
                await redo();
            });
            expect(notes()).toEqual(edited);
            // A take-store notification alone must retarget the mounted strip.
            roundRect.mockClear();
            act(() =>
                takeLaneStore.set({
                    lanes: takeLaneStore.value!.lanes.map((lane) => ({
                        ...lane,
                        takes: lane.takes.map((take) => ({ ...take, selected: take.id === 'take3' })),
                    })),
                })
            );
            expect(roundRect).toHaveBeenCalledTimes(1);
            const selectedValue = original[2]![property]!;
            expect(roundRect).toHaveBeenCalledWith(41, 129 - selectedValue, 38, selectedValue, [2, 2, 0, 0]);
        }
    );

    it('preserves the raw default feed when legacy takes and notes have no pass identity', () => {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { 'clip-1': notes().map(({ recordingPassId: _pass, ...note }) => note) },
        });
        takeLaneStore.set({
            lanes: takeLaneStore.value!.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map(({ recordingPassId: _pass, ...take }) => take),
            })),
        });
        const roundRect = vi.spyOn(ctx2d, 'roundRect');
        roundRect.mockClear();
        renderDefaultStrip();
        expect(roundRect).toHaveBeenCalledTimes(3);
        expect(roundRect.mock.calls.map((call) => call[0])).toEqual([41, 201, 361]);
    });
});
