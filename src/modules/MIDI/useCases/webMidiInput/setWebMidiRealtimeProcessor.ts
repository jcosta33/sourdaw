import { setRealtimeMidiProcessor } from '../../repositories/webMidi/setRealtimeMidiProcessor';

type SetWebMidiRealtimeProcessorInput = {
    processor: Parameters<typeof setRealtimeMidiProcessor>[0];
};

export function setWebMidiRealtimeProcessor({ processor }: SetWebMidiRealtimeProcessorInput): void {
    setRealtimeMidiProcessor(processor);
}
