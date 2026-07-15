/**
 * YeastWorkletProcessor — runs the MIDI rack in the audio thread.
 *
 * Moves `MidiRack.processBlock()` off the main thread so it no longer competes
 * with React renders and CRDT writes during the transport scheduler tick.
 *
 * Port protocol (this.port.onmessage):
 *   ← { type: 'setProjection', processors }
 *   ← { type: 'executeCommand', command }
 *   ← { type: 'processBlock', requestId, events, blockStart, blockEnd, transport }
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
    | { type: 'executeCommand'; command: YeastProcessorCommand }
    | {
          type: 'processBlock';
          requestId: number;
          events: MidiEvent[];
          blockStart: number;
          blockEnd: number;
          transport: TransportInfo;
      }
    | { type: 'allNotesOff'; nowSamples?: number };

class YeastWorkletProcessor extends AudioWorkletProcessor {
    _rack = new MidiRack();

    constructor() {
        super();
        this.port.onmessage = ({ data }: MessageEvent<YeastMsg>) => {
            switch (data.type) {
                case 'executeCommand': {
                    this._rack.executeCommand(data.command);
                    break;
                }
                case 'setProjection': {
                    const offs = this._rack.replaceProjection(data.processors, createProcessor, currentFrame);
                    if (offs.length > 0) {
                        this.port.postMessage({ type: 'notesOff', events: offs });
                    }
                    break;
                }
                case 'allNotesOff': {
                    const offs = this._rack.allNotesOff(data.nowSamples ?? currentFrame);
                    if (offs.length > 0) {
                        this.port.postMessage({ type: 'notesOff', events: offs });
                    }
                    break;
                }
                case 'processBlock': {
                    const processed = this._rack.processBlock(
                        data.events,
                        data.blockStart,
                        data.blockEnd,
                        data.transport
                    );
                    this.port.postMessage({ type: 'processed', requestId: data.requestId, events: processed });
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
