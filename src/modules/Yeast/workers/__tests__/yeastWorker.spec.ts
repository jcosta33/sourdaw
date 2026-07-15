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
    handleYeastWorkerMessage({
        data,
        rack,
        postMessage: (message) => messages.push(message),
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
                trackId: 'track-a',
                events: [{ timeSamples: 0, kind: { type: 'noteOn', channel: 16, note: 60, velocity: 100 } }],
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
