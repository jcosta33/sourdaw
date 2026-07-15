/**
 * YeastWorkletProcessor — runs the MIDI rack in the audio thread.
 *
 * Moves `MidiRack.processBlock()` off the main thread so it no longer competes
 * with React renders and CRDT writes during the transport scheduler tick.
 *
 * Port protocol (this.port.onmessage):
 *   ← { type: 'addProcessor',  processorType: string, processorId: string }
 *   ← { type: 'removeProcessor', processorId: string }
 *   ← { type: 'reorder',      fromIdx, toIdx }
 *   ← { type: 'setParam',     processorId, name, value }
 *   ← { type: 'setBypass',    processorId, bypassed }
 *   ← { type: 'processBlock', requestId, events, blockStart, blockEnd, transport }
 *   → { type: 'processed',    requestId, events }
 *   → { type: 'notesOff',     events }   // hung-note offs from removeProcessor
 *   ← { type: 'allNotesOff',  nowSamples }
 */

import { MidiRack } from './MidiRack';
import { createProcessor } from './processorFactory';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { ProcessorType } from '../models/ProcessorCatalog';

type YeastMsg =
    | { type: 'addProcessor'; processorType: ProcessorType; processorId: string }
    | { type: 'removeProcessor'; processorId: string }
    | { type: 'reorder'; fromIdx: number; toIdx: number }
    | { type: 'setParam'; processorId: string; name: string; value: number }
    | { type: 'setBypass'; processorId: string; bypassed: boolean }
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
                case 'addProcessor':
                    this._rack.addProcessor(createProcessor(data.processorType, data.processorId));
                    break;
                case 'removeProcessor': {
                    // removeProcessor returns a Note Off for every note still
                    // sounding through the worklet chain. The worklet has no
                    // instrument downstream of its own, so post the offs back to
                    // the main thread (its only channel) and let the node route
                    // them to the live instrument — otherwise the note hangs.
                    const offs = this._rack.removeProcessor(data.processorId, currentFrame);
                    if (offs.length > 0) {
                        this.port.postMessage({ type: 'notesOff', events: offs });
                    }
                    break;
                }
                case 'reorder':
                    this._rack.reorder(data.fromIdx, data.toIdx);
                    break;
                case 'setParam':
                    this._rack.setProcessorParam(data.processorId, data.name, data.value);
                    break;
                case 'setBypass':
                    this._rack.setProcessorBypass(data.processorId, data.bypassed);
                    break;
                case 'allNotesOff':
                    this._rack.allNotesOff(data.nowSamples ?? currentFrame);
                    break;
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
