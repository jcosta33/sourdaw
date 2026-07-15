/**
 * YeastWorkletProcessor — runs the MIDI rack in the audio thread.
 *
 * Moves `MidiRack.processBlock()` off the main thread so it no longer competes
 * with React renders and CRDT writes during the transport scheduler tick.
 *
 * Port protocol (this.port.onmessage):
 *   ← { type: 'setProjection', processors }
 *   → { type: 'projectionAck', projectionId, events }
 *   → { type: 'projectionError', projectionId, error }
 *   ← { type: 'executeCommand', commandId, command }
 *   ← { type: 'processBlock', requestId, trackId, events, blockStart, blockEnd, transport }
 *   → { type: 'commandAck', commandId, accepted, error? }
 *   → { type: 'processed',    requestId, events }
 *   ← { type: 'allNotesOff',  panicId, nowSamples }
 *   → { type: 'allNotesOffAck', panicId, completed, events, error? }
 */

import { MidiRack } from './MidiRack';
import { createProcessor } from './processorFactory';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

type YeastMsg = {
    type: 'processBlock';
    requestId: number;
    trackId: string;
    events: MidiEvent[];
    blockStart: number;
    blockEnd: number;
    transport: TransportInfo;
};

type ParsedExecuteCommand = {
    commandId: number;
    command: YeastProcessorCommand | null;
};

const INVALID_EXECUTE_COMMAND_ERROR = 'Invalid executeCommand message';
const INVALID_SET_PROJECTION_ERROR = 'Invalid setProjection message';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isCommandId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTrackId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isMidiEventKind(value: unknown): value is MidiEvent['kind'] {
    if (!isPlainObject(value) || typeof value.type !== 'string') {
        return false;
    }
    switch (value.type) {
        case 'noteOn':
            return isFiniteNumber(value.channel) && isFiniteNumber(value.note) && isFiniteNumber(value.velocity);
        case 'noteOff':
            return isFiniteNumber(value.channel) && isFiniteNumber(value.note);
        case 'cc':
            return isFiniteNumber(value.channel) && isFiniteNumber(value.cc) && isFiniteNumber(value.value);
        case 'pitchBend':
        case 'channelPressure':
            return isFiniteNumber(value.channel) && isFiniteNumber(value.value);
        default:
            return false;
    }
}

function isMidiEvent(value: unknown): value is MidiEvent {
    if (!isPlainObject(value) || !isFiniteNumber(value.timeSamples) || !isMidiEventKind(value.kind)) {
        return false;
    }
    return value.trackId === undefined || isTrackId(value.trackId);
}

function isMidiEventArray(value: unknown): value is MidiEvent[] {
    return Array.isArray(value) && value.every(isMidiEvent);
}

function isTransportInfo(value: unknown): value is TransportInfo {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isFiniteNumber(value.sampleRate) &&
        isFiniteNumber(value.bpm) &&
        isFiniteNumber(value.ppqPosition) &&
        typeof value.isPlaying === 'boolean' &&
        isFiniteNumber(value.barIndex) &&
        isFiniteNumber(value.beatInBar) &&
        isFiniteNumber(value.timeSigNum) &&
        isFiniteNumber(value.timeSigDen) &&
        typeof value.loopEnabled === 'boolean' &&
        isFiniteNumber(value.loopStartPpq) &&
        isFiniteNumber(value.loopEndPpq)
    );
}

function parseProcessBlock(value: unknown): YeastMsg | undefined {
    if (
        !isPlainObject(value) ||
        value.type !== 'processBlock' ||
        !isCommandId(value.requestId) ||
        !isTrackId(value.trackId) ||
        !isMidiEventArray(value.events) ||
        !isFiniteNumber(value.blockStart) ||
        !isFiniteNumber(value.blockEnd) ||
        !isTransportInfo(value.transport)
    ) {
        return undefined;
    }
    return {
        type: 'processBlock',
        requestId: value.requestId,
        trackId: value.trackId,
        events: value.events,
        blockStart: value.blockStart,
        blockEnd: value.blockEnd,
        transport: value.transport,
    };
}

function isProcessorType(value: unknown): value is YeastProcessorProjectionItem['type'] {
    switch (value) {
        case 'arpeggiator':
        case 'chord':
        case 'chordMemory':
        case 'scale':
        case 'harmonizer':
        case 'repeater':
        case 'velocity':
        case 'humanizer':
        case 'filter':
        case 'transposer':
        case 'groove':
        case 'ccGenerator':
        case 'euclidean':
        case 'markov':
        case 'mutation':
            return true;
        default:
            return false;
    }
}

function isProjectionItem(value: unknown): value is YeastProcessorProjectionItem {
    if (!isPlainObject(value)) {
        return false;
    }
    if (
        typeof value.id !== 'string' ||
        !isProcessorType(value.type) ||
        typeof value.bypassed !== 'boolean' ||
        !isPlainObject(value.params)
    ) {
        return false;
    }
    return Object.values(value.params).every((param) => typeof param === 'number' && Number.isFinite(param));
}

function parseSetProjection(
    value: unknown
): { projectionId: number; processors: YeastProcessorProjectionItem[]; error?: string } | undefined {
    if (!isPlainObject(value) || value.type !== 'setProjection' || !isCommandId(value.projectionId)) {
        return undefined;
    }
    if (!Array.isArray(value.processors) || !value.processors.every(isProjectionItem)) {
        return { projectionId: value.projectionId, processors: [], error: INVALID_SET_PROJECTION_ERROR };
    }
    return { projectionId: value.projectionId, processors: value.processors };
}

function parseAllNotesOff(value: unknown): { panicId: number; nowSamples: number } | undefined {
    if (!isPlainObject(value) || value.type !== 'allNotesOff' || !isCommandId(value.panicId)) {
        return undefined;
    }
    const nowSamples = value.nowSamples;
    if (nowSamples !== undefined && (typeof nowSamples !== 'number' || !Number.isFinite(nowSamples))) {
        return undefined;
    }
    return { panicId: value.panicId, nowSamples: nowSamples ?? currentFrame };
}

function parseExecuteCommand(value: unknown): ParsedExecuteCommand | undefined {
    if (!isPlainObject(value) || value.type !== 'executeCommand' || !isCommandId(value.commandId)) {
        return undefined;
    }

    const command = value.command;
    if (
        !isPlainObject(command) ||
        typeof command.processorId !== 'string' ||
        (command.type !== 'chordMemory.learn' && command.type !== 'chordMemory.clear')
    ) {
        return { commandId: value.commandId, command: null };
    }
    return {
        commandId: value.commandId,
        command: {
            processorId: command.processorId,
            type: command.type,
        },
    };
}

class YeastWorkletProcessor extends AudioWorkletProcessor {
    _rack = new MidiRack();

    constructor() {
        super();
        this.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (!isPlainObject(data)) {
                return;
            }
            if (data.type === 'executeCommand') {
                const parsed = parseExecuteCommand(data);
                if (!parsed) {
                    return;
                }
                if (!parsed.command) {
                    this.port.postMessage({
                        type: 'commandAck',
                        commandId: parsed.commandId,
                        accepted: false,
                        error: INVALID_EXECUTE_COMMAND_ERROR,
                    });
                    return;
                }
                try {
                    const accepted = this._rack.executeCommand(parsed.command);
                    this.port.postMessage({
                        type: 'commandAck',
                        commandId: parsed.commandId,
                        accepted: accepted === true,
                    });
                } catch (error: unknown) {
                    this.port.postMessage({
                        type: 'commandAck',
                        commandId: parsed.commandId,
                        accepted: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }

            if (data.type === 'setProjection') {
                const parsed = parseSetProjection(data);
                if (!parsed) {
                    return;
                }
                if (parsed.error) {
                    this.port.postMessage({
                        type: 'projectionError',
                        projectionId: parsed.projectionId,
                        error: parsed.error,
                    });
                    return;
                }
                try {
                    const offs = this._rack.replaceProjection(parsed.processors, createProcessor, currentFrame);
                    this.port.postMessage({ type: 'projectionAck', projectionId: parsed.projectionId, events: offs });
                } catch (error: unknown) {
                    this.port.postMessage({
                        type: 'projectionError',
                        projectionId: parsed.projectionId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }

            if (data.type === 'allNotesOff') {
                const parsed = parseAllNotesOff(data);
                if (!parsed) {
                    return;
                }
                try {
                    const offs = this._rack.allNotesOff(parsed.nowSamples);
                    this.port.postMessage({
                        type: 'allNotesOffAck',
                        panicId: parsed.panicId,
                        completed: true,
                        events: offs,
                    });
                } catch (error: unknown) {
                    this.port.postMessage({
                        type: 'allNotesOffAck',
                        panicId: parsed.panicId,
                        completed: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }

            const message = parseProcessBlock(data);
            if (!message) {
                return;
            }
            const processed = this._rack.processBlock(
                message.events,
                message.blockStart,
                message.blockEnd,
                message.transport,
                message.trackId
            );
            this.port.postMessage({ type: 'processed', requestId: message.requestId, events: processed });
        };
    }

    process(): boolean {
        // All work is driven by message port; keep the worklet alive.
        return true;
    }
}

registerProcessor('yeast-worklet-processor', YeastWorkletProcessor);
