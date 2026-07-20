/// <reference lib="webworker" />
/**
 * YeastWorker — runs the MIDI rack on a dedicated non-real-time thread.
 *
 * Keeps `MidiRack.processBlock()` and every processor away from the audio
 * render thread; the host sends serialized sample positions for timing.
 *
 * Message protocol (self.onmessage):
 *   ← { type: 'initialize', protocolVersion: 1 }
 *   → { type: 'ready', protocolVersion: 1 }
 *   ← { type: 'setProjection', projectionId, nowSamples, processors }
 *   → { type: 'projectionAck', projectionId, events }
 *   → { type: 'projectionError', projectionId, error }
 *   ← { type: 'executeCommand', commandId, command }
 *   ← { type: 'processBlock', requestId, captureEpoch, rackId, routeId, trackId, events, blockStart, blockEnd, transport, previewEnabled, preserveInputTrackIds }
 *   → { type: 'commandAck', commandId, accepted, error? }
 *   → { type: 'processed',    requestId, events }
 *   → { type: 'previewPage',  requestId, captureEpoch, page } (lossy/deferred)
 *   ← { type: 'releasePreview', captureEpoch, rackId, routeId, trackId }
 *   ← { type: 'allNotesOff',  panicId, nowSamples }
 *   → { type: 'allNotesOffAck', panicId, completed, events, error? }
 */

import { MidiRack } from './MidiRack';
import { createProcessor } from './processorFactory';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

type YeastProcessBlockMessage = {
    type: 'processBlock';
    requestId: number;
    captureEpoch: number;
    rackId: string;
    routeId: string;
    trackId: string;
    events: MidiEvent[];
    blockStart: number;
    blockEnd: number;
    transport: TransportInfo;
    previewEnabled: boolean;
    preserveInputTrackIds: boolean;
};

type ParsedExecuteCommand = {
    commandId: number;
    command: YeastProcessorCommand | null;
};

type ParsedSetProjection = {
    projectionId: number;
    nowSamples: number;
    processors: YeastProcessorProjectionItem[];
    error?: string;
};

const INVALID_EXECUTE_COMMAND_ERROR = 'Invalid executeCommand message';
const INVALID_SET_PROJECTION_ERROR = 'Invalid setProjection message';
const YEAST_WORKER_PROTOCOL_VERSION = 1;

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

function isMidiChannel(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 15;
}

function isMidiNote(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127;
}

function isMidiController(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127;
}

function isMidiEventKind(value: unknown): value is MidiEvent['kind'] {
    if (!isPlainObject(value) || typeof value.type !== 'string') {
        return false;
    }
    switch (value.type) {
        case 'noteOn':
            return isMidiChannel(value.channel) && isMidiNote(value.note) && isFiniteNumber(value.velocity);
        case 'noteOff':
            return isMidiChannel(value.channel) && isMidiNote(value.note);
        case 'cc':
            return isMidiChannel(value.channel) && isMidiController(value.cc) && isFiniteNumber(value.value);
        case 'pitchBend':
        case 'channelPressure':
            return isMidiChannel(value.channel) && isFiniteNumber(value.value);
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

function isTempoMapProjection(value: unknown): boolean {
    if (!isPlainObject(value) || !isFiniteNumber(value.defaultTempo) || !Array.isArray(value.changes)) {
        return false;
    }
    return value.changes.every(
        (change) =>
            isPlainObject(change) &&
            isFiniteNumber(change.beat) &&
            isFiniteNumber(change.tempo) &&
            (change.curve === 'instant' || change.curve === 'linear')
    );
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
        isFiniteNumber(value.loopEndPpq) &&
        (value.discontinuityEpoch === undefined || isCommandId(value.discontinuityEpoch)) &&
        (value.tempoMap === undefined || isTempoMapProjection(value.tempoMap))
    );
}

function parseProcessBlock(value: unknown): YeastProcessBlockMessage | undefined {
    if (
        !isPlainObject(value) ||
        value.type !== 'processBlock' ||
        !isCommandId(value.requestId) ||
        !isCommandId(value.captureEpoch) ||
        !isTrackId(value.rackId) ||
        !isTrackId(value.routeId) ||
        !isTrackId(value.trackId) ||
        !isMidiEventArray(value.events) ||
        !isFiniteNumber(value.blockStart) ||
        !isFiniteNumber(value.blockEnd) ||
        !isTransportInfo(value.transport) ||
        (value.previewEnabled !== undefined && typeof value.previewEnabled !== 'boolean') ||
        (value.preserveInputTrackIds !== undefined && typeof value.preserveInputTrackIds !== 'boolean')
    ) {
        return undefined;
    }
    return {
        type: 'processBlock',
        requestId: value.requestId,
        captureEpoch: value.captureEpoch,
        rackId: value.rackId,
        routeId: value.routeId,
        trackId: value.trackId,
        events: value.events,
        blockStart: value.blockStart,
        blockEnd: value.blockEnd,
        transport: value.transport,
        previewEnabled: value.previewEnabled === true,
        preserveInputTrackIds: value.preserveInputTrackIds === true,
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
        value.id.length === 0 ||
        !isProcessorType(value.type) ||
        typeof value.bypassed !== 'boolean' ||
        !isPlainObject(value.params)
    ) {
        return false;
    }
    return Object.values(value.params).every((param) => typeof param === 'number' && Number.isFinite(param));
}

function parseSetProjection(value: unknown): ParsedSetProjection | undefined {
    if (!isPlainObject(value) || value.type !== 'setProjection' || !isCommandId(value.projectionId)) {
        return undefined;
    }
    if (!isFiniteNumber(value.nowSamples)) {
        return { projectionId: value.projectionId, nowSamples: 0, processors: [], error: INVALID_SET_PROJECTION_ERROR };
    }
    if (!Array.isArray(value.processors) || !value.processors.every(isProjectionItem)) {
        return {
            projectionId: value.projectionId,
            nowSamples: value.nowSamples,
            processors: [],
            error: INVALID_SET_PROJECTION_ERROR,
        };
    }
    return { projectionId: value.projectionId, nowSamples: value.nowSamples, processors: value.processors };
}

function parseAllNotesOff(value: unknown): { panicId: number; nowSamples: number } | undefined {
    if (!isPlainObject(value) || value.type !== 'allNotesOff' || !isCommandId(value.panicId)) {
        return undefined;
    }
    if (!isFiniteNumber(value.nowSamples)) {
        return undefined;
    }
    return { panicId: value.panicId, nowSamples: value.nowSamples };
}

function parseReleasePreview(
    value: unknown
): { rackId: string; routeId: string; trackId: string; captureEpoch: number } | undefined {
    if (
        !isPlainObject(value) ||
        value.type !== 'releasePreview' ||
        !isTrackId(value.rackId) ||
        !isTrackId(value.routeId) ||
        !isTrackId(value.trackId) ||
        !isCommandId(value.captureEpoch)
    ) {
        return undefined;
    }
    return {
        rackId: value.rackId,
        routeId: value.routeId,
        trackId: value.trackId,
        captureEpoch: value.captureEpoch,
    };
}

function parseExecuteCommand(value: unknown): ParsedExecuteCommand | undefined {
    if (!isPlainObject(value) || value.type !== 'executeCommand' || !isCommandId(value.commandId)) {
        return undefined;
    }

    const command = value.command;
    if (
        !isPlainObject(command) ||
        typeof command.processorId !== 'string' ||
        command.processorId.length === 0 ||
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

export type YeastWorkerMessageHandlerInput = {
    data: unknown;
    rack: MidiRack;
    postMessage: (message: unknown) => void;
};

function deferPreviewDelivery(delivery: () => void): void {
    setTimeout(delivery, 0);
}

export function handleYeastWorkerMessage({ data, rack, postMessage }: YeastWorkerMessageHandlerInput): void {
    if (!isPlainObject(data)) {
        return;
    }
    if (data.type === 'initialize') {
        if (data.protocolVersion === YEAST_WORKER_PROTOCOL_VERSION) {
            postMessage({ type: 'ready', protocolVersion: YEAST_WORKER_PROTOCOL_VERSION });
        }
        return;
    }
    if (data.type === 'executeCommand') {
        const parsed = parseExecuteCommand(data);
        if (!parsed) {
            return;
        }
        if (!parsed.command) {
            postMessage({
                type: 'commandAck',
                commandId: parsed.commandId,
                accepted: false,
                error: INVALID_EXECUTE_COMMAND_ERROR,
            });
            return;
        }
        try {
            const accepted = rack.executeCommand(parsed.command);
            postMessage({
                type: 'commandAck',
                commandId: parsed.commandId,
                accepted: accepted === true,
            });
        } catch (error: unknown) {
            postMessage({
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
            postMessage({
                type: 'projectionError',
                projectionId: parsed.projectionId,
                error: parsed.error,
            });
            return;
        }
        try {
            const offs = rack.replaceProjection(parsed.processors, createProcessor, parsed.nowSamples);
            postMessage({ type: 'projectionAck', projectionId: parsed.projectionId, events: offs });
        } catch (error: unknown) {
            postMessage({
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
            const offs = rack.allNotesOff(parsed.nowSamples);
            postMessage({
                type: 'allNotesOffAck',
                panicId: parsed.panicId,
                completed: true,
                events: offs,
            });
        } catch (error: unknown) {
            postMessage({
                type: 'allNotesOffAck',
                panicId: parsed.panicId,
                completed: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return;
    }

    if (data.type === 'releasePreview') {
        const parsed = parseReleasePreview(data);
        if (parsed) {
            rack.releasePreview(parsed.rackId, parsed.routeId, parsed.trackId, parsed.captureEpoch);
        }
        return;
    }

    const message = parseProcessBlock(data);
    if (!message) {
        return;
    }
    try {
        const processed = rack.processBlock(
            message.events,
            message.blockStart,
            message.blockEnd,
            message.transport,
            message.trackId,
            message.previewEnabled,
            message.rackId,
            message.routeId,
            message.captureEpoch,
            message.preserveInputTrackIds
        );
        postMessage({ type: 'processed', requestId: message.requestId, events: processed });
        const page = rack.takePreviewPage();
        if (!page) {
            return;
        }
        try {
            deferPreviewDelivery(() => {
                try {
                    postMessage({
                        type: 'previewPage',
                        requestId: message.requestId,
                        captureEpoch: message.captureEpoch,
                        page,
                    });
                } finally {
                    rack.releasePreviewPage(page);
                }
            });
        } catch {
            rack.releasePreviewPage(page);
        }
    } catch (error: unknown) {
        postMessage({
            type: 'processedError',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

const rack = new MidiRack();
self.onmessage = ({ data }: MessageEvent<unknown>): void => {
    handleYeastWorkerMessage({ data, rack, postMessage: (message) => self.postMessage(message) });
};
