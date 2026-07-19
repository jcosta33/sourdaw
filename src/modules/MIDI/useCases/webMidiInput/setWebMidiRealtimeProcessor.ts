import { setRealtimeMidiProcessor } from '../../repositories/webMidi/setRealtimeMidiProcessor';

type WebMidiRealtimeProcessor = Parameters<typeof setRealtimeMidiProcessor>[0];

type SetWebMidiRealtimeProcessorInput = {
    processor: WebMidiRealtimeProcessor;
};

export function setWebMidiRealtimeProcessor({ processor }: SetWebMidiRealtimeProcessorInput): void {
    setRealtimeMidiProcessor(processor);
}
