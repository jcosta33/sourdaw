import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine, isDeviceHeldByNativeSession, sendNativeLiveMidiControl } from '#/modules/AudioEngine/useCases';

import { CC_ALL_SOUND_OFF, CC_RESET_ALL_CONTROLLERS } from '../../models/MidiControllerState';
import { releaseAllActiveNotes } from '../../repositories/webMidi/releaseAllActiveNotes';
import { sendPanicToMidiOutputs } from '../../repositories/webMidi/sendPanicToMidiOutputs';

import { releaseNativeLiveNote } from './releaseNativeLiveNote';

/**
 * The channel-mode messages carry a defined zero value, and a panic addresses
 * the instrument rather than a voice — the engine's Grand Boule body does not
 * consult the channel, so the base one is where a message with no channel of
 * its own belongs.
 */
const PANIC_VALUE = 0;
const PANIC_CHANNEL = 0;

type PanicLiveNotesInput = {
    /**
     * Whether to broadcast the channel-mode panic to connected outputs.
     *
     * False when the panic was itself triggered by an incoming All Sound Off /
     * All Notes Off: the sender already knows, and echoing it back out would
     * loop forever through a loopback port that feeds our own input.
     */
    notifyOutputs?: boolean;
};

/**
 * Release every voice the live MIDI input is holding and tell downstream
 * hardware to do the same (audit MD-6).
 *
 * This is the live half of a panic: the notes this app knows are held, plus the
 * channel-mode broadcast for the ones it does not. It is invoked both by the
 * user-facing panic and by an incoming All Sound Off / All Notes Off from the
 * controller itself, which had no effect at all before.
 */
export function panicLiveNotes({ notifyOutputs = true }: PanicLiveNotesInput = {}): void {
    releaseAllActiveNotes({
        getCurrentTime: () => audioEngine.context.currentTime,
        getTrackStrip: (trackId) => audioEngine.getTrackStrip(trackId),
        releaseNativeNote: releaseNativeLiveNote,
    });
    silenceNativeGrandBouleBodies();
    if (notifyOutputs) {
        sendPanicToMidiOutputs();
    }
}

/**
 * Silence every Grand Boule body the engine holds and lift its pedals.
 *
 * The note-offs above cannot discharge a panic on this instrument. With the
 * damper down, or a sostenuto capture standing, the engine's body routes a
 * note-off to `release_key` rather than to damping, so the key goes up and the
 * strings ring on. All Sound Off kills the voices outright, and Reset All
 * Controllers lifts the pedals that made the kill necessary — otherwise the
 * very next note sounded would be caught by the same held damper.
 *
 * Held rather than carried, and every track rather than the selected one. A
 * shadowed session sounds nothing and still builds the bodies, so a pedal can
 * be latched on one nobody hears; and a panic is addressed at the instrument,
 * not at whatever the user happens to have selected.
 */
function silenceNativeGrandBouleBodies(): void {
    for (const track of trackStore.value?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.type !== 'grand-boule' || !isDeviceHeldByNativeSession(track.id, device.id)) {
                continue;
            }
            for (const controller of [CC_ALL_SOUND_OFF, CC_RESET_ALL_CONTROLLERS]) {
                void sendNativeLiveMidiControl({
                    trackId: track.id,
                    deviceId: device.id,
                    controller,
                    value: PANIC_VALUE,
                    channel: PANIC_CHANNEL,
                });
            }
        }
    }
}
