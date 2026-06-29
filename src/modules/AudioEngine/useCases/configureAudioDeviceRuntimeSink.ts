import { type AudioDeviceRuntimeSink, setAudioDeviceRuntimeSink } from '../engine/audioDeviceRuntimeSink';

type ConfigureAudioDeviceRuntimeSinkInput = Partial<AudioDeviceRuntimeSink>;

export function configureAudioDeviceRuntimeSink(input: ConfigureAudioDeviceRuntimeSinkInput): void {
    setAudioDeviceRuntimeSink(input);
}
