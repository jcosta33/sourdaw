import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { MidiRack } from '../MidiRack';
import { handleYeastWorkerMessage } from '../yeastWorker';

import type { TransportInfo } from '../../models/MidiEvent';

const transport: TransportInfo = {
    sampleRate: 48000,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

function dispatch(rack: MidiRack, data: unknown, messages: unknown[]): void {
    let routedData = data;
    if (typeof data === 'object' && data !== null && Reflect.get(data, 'type') === 'processBlock') {
        const trackId: unknown = Reflect.get(data, 'trackId');
        routedData = {
            rackId: 'rack-a',
            routeId: trackId,
            ...data,
        };
    }
    handleYeastWorkerMessage({
        data: routedData,
        rack,
        postMessage: (message) => messages.push(structuredClone(message)),
    });
}

describe('YeastWorker', () => {
    it('acknowledges only a validated startup handshake', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];

        dispatch(rack, { type: 'initialize', protocolVersion: '1' }, messages);
        dispatch(rack, { type: 'initialize', protocolVersion: 2 }, messages);
        expect(messages).toEqual([]);

        dispatch(rack, { type: 'initialize', protocolVersion: 1 }, messages);
        expect(messages).toEqual([{ type: 'ready', protocolVersion: 1 }]);
    });

    it('carries panic note-offs inside the correlated acknowledgement', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];

        dispatch(
            rack,
            {
                type: 'setProjection',
                projectionId: 0,
                nowSamples: 0,
                processors: [{ id: 'filter-1', type: 'filter', bypassed: false, params: {} }],
            },
            messages
        );
        messages.length = 0;
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 0,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        messages.length = 0;

        dispatch(rack, { type: 'allNotesOff', panicId: 7, nowSamples: 512 }, messages);

        expect(messages).toEqual([
            {
                type: 'allNotesOffAck',
                panicId: 7,
                completed: true,
                events: [{ timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }],
            },
        ]);
    });

    it('settles projection note-offs at the serialized host sample', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];
        const projection = {
            type: 'setProjection',
            projectionId: 1,
            nowSamples: 0,
            processors: [{ id: 'filter-1', type: 'filter', bypassed: false, params: {} }],
        };

        dispatch(rack, projection, messages);
        messages.length = 0;
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 1,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        messages.length = 0;

        dispatch(rack, { ...projection, projectionId: 2, nowSamples: 256, processors: [] }, messages);

        expect(messages).toEqual([
            {
                type: 'projectionAck',
                projectionId: 2,
                events: [{ timeSamples: 256, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }],
            },
        ]);
    });

    it('carries transformed Note Offs in bypass and reorder projection acknowledgements', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];
        const projection = [
            { id: 'transpose-1', type: 'transposer', bypassed: false, params: { semitones: 12 } },
            { id: 'scale-1', type: 'scale', bypassed: false, params: { transpose: 1 } },
        ];
        dispatch(rack, { type: 'setProjection', projectionId: 20, nowSamples: 0, processors: projection }, messages);
        messages.length = 0;
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 20,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        messages.length = 0;

        dispatch(
            rack,
            {
                type: 'setProjection',
                projectionId: 21,
                nowSamples: 256,
                processors: [projection[1], projection[0]],
            },
            messages
        );
        expect(messages).toEqual([
            {
                type: 'projectionAck',
                projectionId: 21,
                events: [{ timeSamples: 256, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 74 } }],
            },
        ]);

        messages.length = 0;
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 21,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [{ timeSamples: 512, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                blockStart: 512,
                blockEnd: 640,
                transport,
            },
            messages
        );
        messages.length = 0;
        dispatch(
            rack,
            {
                type: 'setProjection',
                projectionId: 22,
                nowSamples: 768,
                processors: [{ ...projection[1], bypassed: true }, projection[0]],
            },
            messages
        );
        expect(messages).toEqual([
            {
                type: 'projectionAck',
                projectionId: 22,
                events: [{ timeSamples: 768, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 74 } }],
            },
        ]);
    });

    it('preserves exact message ordering through projection, process, and panic', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];

        dispatch(
            rack,
            {
                type: 'setProjection',
                projectionId: 3,
                nowSamples: 0,
                processors: [],
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 4,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(rack, { type: 'allNotesOff', panicId: 5, nowSamples: 128 }, messages);

        expect(messages.map((message) => (message as { type: string }).type)).toEqual([
            'projectionAck',
            'processed',
            'allNotesOffAck',
        ]);
    });

    it('preserves input route identities when a track-scoped scheduler requests it', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];
        const events = [
            {
                timeSamples: 0,
                durationSamples: 24_000,
                durationPpq: 1,
                trackId: 'clip-route-a',
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            },
            {
                timeSamples: 64,
                trackId: 'clip-route-a',
                kind: { type: 'noteOff', channel: 0, note: 60 },
            },
        ];

        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 6,
                captureEpoch: 0,
                trackId: 'track-a',
                events,
                blockStart: 0,
                blockEnd: 128,
                transport,
                preserveInputTrackIds: true,
            },
            messages
        );

        expect(messages).toEqual([{ type: 'processed', requestId: 6, events }]);
    });

    it('settles scheduler output before separately posting a packed preview page', async () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];
        dispatch(
            rack,
            {
                type: 'setProjection',
                projectionId: 6,
                nowSamples: 0,
                processors: [{ id: 'filter-1', type: 'filter', bypassed: true, params: {} }],
            },
            messages
        );
        messages.length = 0;
        const events = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 88 } },
            { timeSamples: 64, kind: { type: 'noteOff', channel: 0, note: 60 } },
        ];

        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 7,
                captureEpoch: 17,
                trackId: 'track-a',
                events,
                blockStart: 0,
                blockEnd: 128,
                transport,
                previewEnabled: true,
            },
            messages
        );

        const response = messages[0] as {
            type: string;
            requestId: number;
            events: unknown[];
        };
        expect(response.type).toBe('processed');
        expect(response.requestId).toBe(7);
        expect(response.events).toEqual([
            { ...events[0], trackId: 'track-a' },
            { ...events[1], trackId: 'track-a' },
        ]);
        expect(response).not.toHaveProperty('preview');
        expect(messages).toHaveLength(1);

        await new Promise((resolve) => setTimeout(resolve, 0));

        const previewResponse = messages[1] as {
            type: string;
            requestId: number;
            captureEpoch: number;
            page: {
                rackId: string;
                routeId: string;
                trackId: string;
                count: number;
                provenanceCount: number;
                droppedEvents: number;
                eventId: Float64Array;
                phase: Uint8Array;
                beatTime: Float64Array;
                durationBeats: Float64Array;
                pitch: Uint8Array;
                velocity: Float64Array;
                probability: Float64Array;
                flags: Uint8Array;
                rackIds: string[];
                routeIds: string[];
                trackIds: string[];
                processorId: string[];
                provenanceFlags: Uint8Array;
                provenanceEventCount: Uint16Array;
                provenanceProcessorId: string[];
            };
        };
        expect(previewResponse.type).toBe('previewPage');
        expect(previewResponse.requestId).toBe(7);
        expect(previewResponse.captureEpoch).toBe(17);
        expect(previewResponse.page).toMatchObject({
            rackId: 'rack-a',
            routeId: 'track-a',
            trackId: 'track-a',
            count: 2,
            provenanceCount: 1,
        });
        expect(previewResponse.page.droppedEvents).toBe(0);
        expect(previewResponse.page.beatTime).toHaveLength(512);
        expect(previewResponse.page.beatTime[0]).toBe(0);
        expect(previewResponse.page.durationBeats[0]).toBe(0);
        expect(previewResponse.page.durationBeats[1]).toBeCloseTo(64 / 24000, 12);
        expect(previewResponse.page.eventId[0]).toBe(previewResponse.page.eventId[1]);
        expect([...previewResponse.page.phase.slice(0, 2)]).toEqual([0, 1]);
        expect(previewResponse.page.pitch[0]).toBe(60);
        expect(previewResponse.page.velocity[0]).toBe(88);
        expect(previewResponse.page.probability[0]).toBeNaN();
        expect(previewResponse.page.flags[0]).toBe(3);
        expect(previewResponse.page.rackIds[0]).toBe('rack-a');
        expect(previewResponse.page.routeIds[0]).toBe('track-a');
        expect(previewResponse.page.trackIds[0]).toBe('track-a');
        expect(previewResponse.page.processorId[0]).toBe('filter-1');
        expect(previewResponse.page.provenanceProcessorId[0]).toBe('filter-1');
        expect(previewResponse.page.provenanceFlags[0]).toBe(2);
        expect(previewResponse.page.provenanceEventCount[0]).toBe(0);
    });

    it('releases one exact preview binding without an acknowledgement allocation', () => {
        const rack = new MidiRack();
        const releasePreview = vi.spyOn(rack, 'releasePreview');
        const messages: unknown[] = [];

        dispatch(
            rack,
            {
                type: 'releasePreview',
                rackId: 'rack-a',
                routeId: 'route-a',
                trackId: 'track-a',
                captureEpoch: 7,
            },
            messages
        );

        expect(releasePreview).toHaveBeenCalledWith('rack-a', 'route-a', 'track-a', 7);
        expect(messages).toEqual([]);
    });

    it('acknowledges a valid processor command with its command id', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];

        dispatch(
            rack,
            {
                type: 'setProjection',
                projectionId: 6,
                nowSamples: 0,
                processors: [{ id: 'cm-1', type: 'chordMemory', bypassed: false, params: {} }],
            },
            messages
        );
        messages.length = 0;

        dispatch(
            rack,
            { type: 'executeCommand', commandId: 7, command: { processorId: 'cm-1', type: 'chordMemory.clear' } },
            messages
        );

        expect(messages).toEqual([{ type: 'commandAck', commandId: 7, accepted: true }]);
    });

    it('rejects malformed inbound messages without inventing replies', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];

        dispatch(rack, { type: 'allNotesOff', panicId: '7', nowSamples: 512 }, messages);
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 8,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [{ timeSamples: 0, kind: { type: 'noteOn', channel: 16, note: 60, velocity: 100 } }],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 9,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 0,
                        sourceEventId: 7,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 10,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 0,
                        noteInstanceId: {},
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 11,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 0,
                        timePpq: Number.NaN,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 12,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 0,
                        tempoBpm: '120',
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 13,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 0,
                        durationSamples: -1,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );
        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 14,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 0,
                        durationPpq: Number.NaN,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );

        expect(messages).toEqual([]);
    });

    it('correlates malformed projection input as a projection error', () => {
        const rack = new MidiRack();
        const messages: unknown[] = [];

        dispatch(rack, { type: 'setProjection', projectionId: 9, processors: [] }, messages);

        expect(messages).toEqual([
            { type: 'projectionError', projectionId: 9, error: 'Invalid setProjection message' },
        ]);
    });

    it('returns a negative command acknowledgement when execution throws', () => {
        const rack = new MidiRack();
        const executeCommand = vi.spyOn(rack, 'executeCommand').mockImplementation(() => {
            throw new Error('processor failed');
        });
        const messages: unknown[] = [];

        dispatch(
            rack,
            {
                type: 'executeCommand',
                commandId: 10,
                command: { processorId: 'cm-1', type: 'chordMemory.clear' },
            },
            messages
        );

        expect(executeCommand).toHaveBeenCalledTimes(1);
        expect(messages).toEqual([{ type: 'commandAck', commandId: 10, accepted: false, error: 'processor failed' }]);
    });

    it('returns a correlated process error when the rack throws', () => {
        const rack = new MidiRack();
        vi.spyOn(rack, 'processBlock').mockImplementation(() => {
            throw new Error('rack process failed');
        });
        const messages: unknown[] = [];

        dispatch(
            rack,
            {
                type: 'processBlock',
                requestId: 11,
                captureEpoch: 0,
                trackId: 'track-a',
                events: [],
                blockStart: 0,
                blockEnd: 128,
                transport,
            },
            messages
        );

        expect(messages).toEqual([{ type: 'processedError', requestId: 11, error: 'rack process failed' }]);
    });

    it('does not fall back to an implicit render-thread clock', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/modules/Yeast/workers/yeastWorker.ts'), 'utf8');

        expect(source).not.toMatch(/currentFrame|AudioWorklet|registerProcessor/);
        expect(source).toMatch(/nowSamples/);
    });
});
