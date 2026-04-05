// @ts-nocheck
/**
 * YeastWorkletProcessor — runs the MIDI rack in the audio thread.
 *
 * Moves `MidiRack.processBlock()` off the main thread so it no longer competes
 * with React renders and CRDT writes during the transport scheduler tick.
 *
 * Port protocol (this.port.onmessage):
 *   ← { type: 'addProcessor',  processorType: string, processorId: string }
 *   ← { type: 'removeProcessor', processorId: string }
 *   ← { type: 'setParam',     processorId, name, value }
 *   ← { type: 'setBypass',    processorId, bypassed }
 *   ← { type: 'processBlock', requestId, events, blockStart, blockEnd, transport }
 *   → { type: 'processed',    requestId, events }
 *   ← { type: 'allNotesOff',  nowSamples }
 */

import { MidiRack } from '../useCases/MidiRack';
import { createProcessor } from '../useCases/processorFactory';

class YeastWorkletProcessor extends AudioWorkletProcessor {
    _rack = new MidiRack();

    constructor() {
        super();
        this.port.onmessage = ({ data }) => {
            switch (data.type) {
                case 'addProcessor':
                    this._rack.addProcessor(createProcessor(data.processorType, data.processorId));
                    break;
                case 'removeProcessor':
                    this._rack.removeProcessor(data.processorId);
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

    process() {
        // All work is driven by message port; keep the worklet alive.
        return true;
    }
}

registerProcessor('yeast-worklet-processor', YeastWorkletProcessor);
