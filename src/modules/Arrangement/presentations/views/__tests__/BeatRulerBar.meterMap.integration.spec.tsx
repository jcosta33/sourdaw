import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    isValidAutomationTimeStateRestorePlan,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import {
    isValidMidiTimeStateRestorePlan,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import {
    defaultTransportState,
    isValidTimelineMapStateRestorePlan,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';
import { BeatRulerBar } from '../BeatRulerBar';

type Line = { x: number; y: number; endX: number; endY: number };
type Paint = {
    labels: { text: string; x: number; y: number }[];
    lines: Line[];
    rectangles: { x: number; width: number; style: string | CanvasGradient | CanvasPattern }[];
};
type Project = {
    tracks: NonNullable<typeof trackStore.value>;
    timeSignatureMap: NonNullable<typeof timeSignatureMapStore.value>;
};

const paints: Paint[] = [];
let stopProjectionBridge: () => void;
let canvasWidth = 600;

function recordCanvas(): void {
    vi.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockImplementation(() => canvasWidth);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) {
        throw new Error('The canvas platform fixture must provide a 2D context');
    }
    const gradient = context.createLinearGradient(0, 0, 0, 18);
    let path: Line[] = [];
    let point = { x: 0, y: 0 };
    vi.spyOn(context, 'createLinearGradient').mockReturnValue(gradient);
    vi.spyOn(context, 'fillRect').mockImplementation((x, y, width, height) => {
        if (context.fillStyle === gradient && x === 0 && y === 0 && width === canvasWidth && height === 18) {
            paints.push({ labels: [], lines: [], rectangles: [] });
        } else {
            paints.at(-1)?.rectangles.push({ x, width, style: context.fillStyle });
        }
    });
    vi.spyOn(context, 'fillText').mockImplementation((text, x, y) => {
        paints.at(-1)?.labels.push({ text, x, y });
    });
    vi.spyOn(context, 'beginPath').mockImplementation(() => {
        path = [];
    });
    vi.spyOn(context, 'moveTo').mockImplementation((x, y) => {
        point = { x, y };
    });
    vi.spyOn(context, 'lineTo').mockImplementation((endX, endY) => {
        path.push({ ...point, endX, endY });
        point = { x: endX, y: endY };
    });
    vi.spyOn(context, 'stroke').mockImplementation(() => {
        paints.at(-1)?.lines.push(...path);
    });
    vi.spyOn(context, 'setTransform');
}

function owners() {
    flushAutomergeStorageWrites();
    const project = getCrdtDoc<Project>('root');
    if (!project) {
        throw new Error('Expected the current CRDT project');
    }
    return structuredClone({
        raw: { tracks: project.tracks, timeSignatureMap: project.timeSignatureMap },
        projected: { tracks: trackStore.value, timeSignatureMap: timeSignatureMapStore.value },
    });
}

function mountRuler(): HTMLCanvasElement {
    render(<BeatRulerBar />);
    const canvas = screen.getByLabelText('Beat ruler').querySelector('canvas');
    if (!canvas) {
        throw new Error('The mounted ruler must contain its canvas');
    }
    expect(canvas.width).toBe(canvasWidth * window.devicePixelRatio);
    return canvas;
}

async function expectFreshBar(cursor: number, bar: number, beat: number): Promise<void> {
    const view = timelineViewStore.value!;
    const x = beat * view.pixelsPerBeat - view.scrollX;
    await waitFor(() => {
        expect(paints.length).toBeGreaterThan(cursor);
        const paint = paints.at(-1)!;
        expect(paint.labels).toContainEqual({ text: String(bar), x: x + 3, y: 11 });
        expect(paint.lines).toContainEqual({ x, y: 0, endX: x, endY: 18 });
    });
}

function seedProject(): void {
    transportStore.set({ ...defaultTransportState, isPlaying: false });
    timeSignatureMapStore.set({ changes: [{ id: 'original-meter', beat: 0, numerator: 4, denominator: 4 }] });
    const clip = ClipDummy.create({
        id: 'bar-three',
        type: 'midi',
        audioBufferId: undefined,
        startBeat: 8,
        endBeat: 12,
    });
    trackStore.set({
        tracks: [TrackDummy.create({ kind: 'midi', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    timelineViewStore.set({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true });
    flushAutomergeStorageWrites();
}

describe('the mounted ruler follows committed meter-map history', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('mounted ruler meter-map integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        setTimeOperationDependencies({
            savedRestorePlanValidators: {
                automation: isValidAutomationTimeStateRestorePlan,
                midi: isValidMidiTimeStateRestorePlan,
                timelineMap: isValidTimelineMapStateRestorePlan,
            },
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
        paints.length = 0;
        canvasWidth = 600;
        vi.stubGlobal('devicePixelRatio', 1);
        recordCanvas();
        seedProject();
    });

    afterEach(() => {
        cleanup();
        flushAutomergeStorageWrites();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        setTimeOperationDependencies(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('paints bar 3 at beat 10 after Insert 2 at 4 and repaints the same ruler through real Undo/Redo', async () => {
        mountRuler();
        await expectFreshBar(0, 3, 8);
        const original = owners();
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        const insertCursor = paints.length;
        await act(async () => {
            await executeAppAction({ type: 'insertTime', payload: { atBeat: 4, durationBeats: 2 } });
        });
        const inserted = owners();
        expect(inserted.raw.tracks.tracks[0]?.clips[0]?.startBeat).toBe(10);
        expect(inserted.projected.tracks?.tracks[0]?.clips[0]?.startBeat).toBe(10);
        expect(inserted.raw.timeSignatureMap).toEqual(inserted.projected.timeSignatureMap);
        expect(inserted.raw.timeSignatureMap.changes).toEqual([
            { id: 'original-meter', beat: 0, numerator: 4, denominator: 4 },
            { id: expect.any(String), beat: 6, numerator: 4, denominator: 4 },
        ]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await expectFreshBar(insertCursor, 3, 10);
        expect(paints.at(-1)?.labels).not.toContainEqual({ text: '3', x: 99, y: 11 });

        const undoCursor = paints.length;
        await act(async () => {
            await undo();
        });
        expect(owners()).toEqual(original);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        await expectFreshBar(undoCursor, 3, 8);

        const redoCursor = paints.length;
        await act(async () => {
            await redo();
        });
        expect(owners()).toEqual(inserted);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(0);
        await expectFreshBar(redoCursor, 3, 10);
    });

    it('adopts a later 3/4 change after a real Insert 2 at 5, preserving both map and clip history', async () => {
        timeSignatureMapStore.set({
            changes: [
                { id: 'original-meter', beat: 0, numerator: 4, denominator: 4 },
                { id: 'later-meter', beat: 7, numerator: 3, denominator: 4 },
            ],
        });
        const original = owners();
        mountRuler();
        const cursor = paints.length;
        await act(async () => {
            await executeAppAction({ type: 'insertTime', payload: { atBeat: 5, durationBeats: 2 } });
        });
        const inserted = owners();
        expect(inserted.raw.timeSignatureMap.changes).toEqual([
            { id: 'original-meter', beat: 0, numerator: 4, denominator: 4 },
            { id: expect.any(String), beat: 6, numerator: 4, denominator: 4 },
            { id: 'later-meter', beat: 9, numerator: 3, denominator: 4 },
        ]);
        expect(inserted.raw.timeSignatureMap).toEqual(inserted.projected.timeSignatureMap);
        expect(inserted.raw.tracks.tracks[0]?.clips[0]?.startBeat).toBe(10);
        expect(inserted.projected.tracks?.tracks[0]?.clips[0]?.startBeat).toBe(10);
        await expectFreshBar(cursor, 3, 12);
        expect(paints.at(-1)?.rectangles).toContainEqual({ x: 48, width: 24, style: 'rgba(255, 255, 255, 0.025)' });
        const undoCursor = paints.length;
        await act(async () => {
            await undo();
        });
        expect(owners()).toEqual(original);
        await expectFreshBar(undoCursor, 3, 10);
        const redoCursor = paints.length;
        await act(async () => {
            await redo();
        });
        expect(owners()).toEqual(inserted);
        await expectFreshBar(redoCursor, 3, 12);
    });

    it.each([
        { numerator: 6, thirdBar: 6 },
        { numerator: 7, thirdBar: 7 },
    ])(
        'paints authored $numerator/8 while stopped with the transport default still 4/4',
        async ({ numerator, thirdBar }) => {
            mountRuler();
            const beforeTransport = transportStore.value;
            const beforeView = timelineViewStore.value;
            const beforeTracks = trackStore.value;
            const cursor = paints.length;
            act(() => {
                timeSignatureMapStore.set({ changes: [{ id: 'eighths', beat: 0, numerator, denominator: 8 }] });
            });
            await expectFreshBar(cursor, 3, thirdBar);
            expect(transportStore.value).toBe(beforeTransport);
            expect(timelineViewStore.value).toBe(beforeView);
            expect(trackStore.value).toBe(beforeTracks);
            expect(transportStore.value?.timeSignatureDenominator).toBe(4);
            expect(paints.at(-1)?.lines).toContainEqual({ x: 6, y: 14, endX: 6, endY: 18 });
        }
    );

    it('paints an empty map using the real non-quarter default meter', async () => {
        transportStore.set({ ...defaultTransportState, timeSignatureNumerator: 6, timeSignatureDenominator: 8 });
        timeSignatureMapStore.set({ changes: [] });
        mountRuler();
        await expectFreshBar(0, 3, 6);
    });

    it('preserves compact density, scrolled coordinates, DPR and backing-store cache reuse', async () => {
        canvasWidth = 180;
        vi.stubGlobal('devicePixelRatio', 2);
        timeSignatureMapStore.set({ changes: [] });
        timelineViewStore.set({ scrollX: 8, scrollY: 0, pixelsPerBeat: 2, autoScrollEnabled: true });
        const canvas = mountRuler();
        const context = canvas.getContext('2d')!;
        expect(canvas.height).toBe(36);
        expect(context.setTransform).toHaveBeenCalledTimes(1);
        expect(paints.at(-1)?.labels).toContainEqual({ text: '6', x: 35, y: 11 });
        expect(paints.at(-1)?.labels.some(({ text }) => text.startsWith('Drag'))).toBe(false);
        expect(paints.at(-1)?.lines.filter(({ y }) => y === 11 || y === 14)).toEqual([]);
        const cursor = paints.length;
        act(() => {
            timelineViewStore.set({ scrollX: 640, scrollY: 0, pixelsPerBeat: 80, autoScrollEnabled: true });
        });
        await expectFreshBar(cursor, 3, 8);
        expect(context.setTransform).toHaveBeenCalledTimes(1);
        expect(paints.at(-1)?.lines).toContainEqual({ x: 80, y: 14, endX: 80, endY: 18 });
        expect(paints.at(-1)?.lines).toContainEqual({ x: 160, y: 11, endX: 160, endY: 18 });
    });

    it('keeps the wide hint and left-clipped bar shading in CSS coordinates', async () => {
        timelineViewStore.set({ scrollX: 66, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true });
        timeSignatureMapStore.set({
            changes: [
                { id: 'original-meter', beat: 0, numerator: 4, denominator: 4 },
                { id: 'carry', beat: 6, numerator: 4, denominator: 4 },
            ],
        });
        mountRuler();
        await expectFreshBar(0, 3, 10);
        expect(paints.at(-1)?.rectangles).toContainEqual({ x: -18, width: 24, style: 'rgba(255, 255, 255, 0.025)' });
        expect(paints.at(-1)?.labels).toContainEqual({
            text: 'Drag to set loop region · Click to move playhead',
            x: 210,
            y: 14,
        });
    });
});
