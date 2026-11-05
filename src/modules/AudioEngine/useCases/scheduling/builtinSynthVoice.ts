import { type BuiltinSynthVoice } from '../../models/BuiltinSynthVoice';

let registeredVoice: BuiltinSynthVoice | null = null;

function voiceDiffers(current: BuiltinSynthVoice, next: BuiltinSynthVoice): boolean {
    return (
        current.scheduleNote !== next.scheduleNote ||
        current.scheduleNoteOffline !== next.scheduleNoteOffline ||
        current.scheduleKitNote !== next.scheduleKitNote ||
        current.scheduleDrumKitNote !== next.scheduleDrumKitNote ||
        current.getDrumKitDefByIndex !== next.getDrumKitDefByIndex ||
        current.getSynthParamsFromDevices !== next.getSynthParamsFromDevices
    );
}

/**
 * AudioEngine, Transport, MIDI and Arrangement may not import the Synth
 * device, so the built-in synth and drum synth voices that audition, live
 * playback, live MIDI input and offline render sound notes through reach them
 * through this port, which the composition root
 * (`#/app/registerDeviceEnginePorts`) fills once at boot, before anything can
 * schedule a note.
 */
export const builtinSynthVoice = {
    /**
     * Registering the identical voice again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(voice: BuiltinSynthVoice): void {
        if (registeredVoice === null) {
            registeredVoice = voice;
            return;
        }
        if (voiceDiffers(registeredVoice, voice)) {
            throw new Error('builtinSynthVoice.configure: the voice differs from the registered one');
        }
    },
    /**
     * The registered voice. Reading before registration throws rather than
     * answering silence: a note scheduled without it would play nothing on a
     * built-in synth or drum kit, live and in every render.
     */
    read(caller: string): BuiltinSynthVoice {
        if (registeredVoice === null) {
            throw new Error(
                `${caller}: the built-in synth voice is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredVoice;
    },
};
