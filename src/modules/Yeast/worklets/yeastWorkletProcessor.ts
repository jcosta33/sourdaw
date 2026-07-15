/**
 * YeastWorkletProcessor — runs the MIDI rack in the audio thread.
 *
 * Moves `MidiRack.processBlock()` off the main thread so it no longer competes
 * with React renders and CRDT writes during the transport scheduler tick.
 *
 * Port protocol (this.port.onmessage):
 *   ← { type: 'setProjection', processors }
 *   ← { type: 'executeCommand', commandId, command }
 *   ← { type: 'processBlock', requestId, events, blockStart, blockEnd, transport }
 *   → { type: 'commandAck', commandId, accepted, error? }
 *   → { type: 'processed',    requestId, events }
 *   → { type: 'notesOff',     events }   // hung-note offs from projection changes
 *   ← { type: 'allNotesOff',  nowSamples }
 */

import { MidiRack } from './MidiRack';
import { createProcessor } from './processorFactory';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

type YeastMsg =
    | { type: 'setProjection'; processors: YeastProcessorProjectionItem[] }
    | { type: 'executeCommand'; commandId: number; command: YeastProcessorCommand }
    | {
          type: 'processBlock';
          requestId: number;
          events: MidiEvent[];
          blockStart: number;
          blockEnd: number;
          transport: TransportInfo;
      }
    | { type: 'allNotesOff'; nowSamples?: number };

type ParsedExecuteCommand = {
    commandId: number;
    command: YeastProcessorCommand | null;
};

const INVALID_EXECUTE_COMMAND_ERROR = 'Invalid executeCommand message';

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

            const message = data as Exclude<YeastMsg, { type: 'executeCommand' }>;
            switch (message.type) {
                case 'setProjection': {
                    const offs = this._rack.replaceProjection(message.processors, createProcessor, currentFrame);
                    if (offs.length > 0) {
                        this.port.postMessage({ type: 'notesOff', events: offs });
                    }
                    break;
                }
                case 'allNotesOff': {
                    const offs = this._rack.allNotesOff(message.nowSamples ?? currentFrame);
                    if (offs.length > 0) {
                        this.port.postMessage({ type: 'notesOff', events: offs });
                    }
                    break;
                }
                case 'processBlock': {
                    const processed = this._rack.processBlock(
                        message.events,
                        message.blockStart,
                        message.blockEnd,
                        message.transport
                    );
                    this.port.postMessage({ type: 'processed', requestId: message.requestId, events: processed });
                    break;
                }
            }
        };
    }

    process(): boolean {
        // All work is driven by message port; keep the worklet alive.
        return true;
    }
}

registerProcessor('yeast-worklet-processor', YeastWorkletProcessor);
