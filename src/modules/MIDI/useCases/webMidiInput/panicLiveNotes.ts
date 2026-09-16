import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine, isDeviceHeldByNativeSession, sendNativeLiveMidiControl } from '#/modules/AudioEngine/useCases';

import { CC_ALL_SOUND_OFF, CC_RESET_ALL_CONTROLLERS } from '../../models/MidiControllerState';
import { releaseAllActiveNotes } from '../../repositories/webMidi/releaseAllActiveNotes';
import { sendPanicToMidiOutputs } from '../../repositories/webMidi/sendPanicToMidiOutputs';

import { releaseNativeLiveNote } from './releaseNativeLiveNote';
import { resolveDeviceNode } from './resolveDeviceNode';

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
    silenceGrandBouleBodies();
    if (notifyOutputs) {
        sendPanicToMidiOutputs();
    }
}

/**
 * Silence every Grand Boule the app holds a body for, on both carriers, and
 * lift its pedals.
 *
 * The note-offs above cannot discharge a panic on this instrument. With the
 * damper down, or a sostenuto capture standing, either carrier routes a
 * note-off to a key release rather than to damping, so the key goes up and the
 * strings ring on. Both are therefore killed outright and then have their
 * pedals raised — otherwise the very next note sounded would be caught by the
 * same held damper.
 *
 * Every track rather than the selected one: a panic is addressed at the
 * instrument, not at whatever the user happens to have selected.
 */
function silenceGrandBouleBodies(): void {
    for (const track of trackStore.value?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.type !== 'grand-boule') {
                continue;
            }
            silenceWebAudioGrandBoule(track.id, device.id);
            silenceNativeGrandBoule(track.id, device.id);
        }
    }
}

/**
 * Kill the Web Audio node's voices and raise its three pedals.
 *
 * The kill goes first: with a pedal still engaged the node holds its voices
 * exactly as the engine's body does, so lifting the pedals ahead of it would
 * release the strings into a ring-out rather than into silence.
 *
 * A node that is not ready has no worklet to receive any of this, and there is
 * nothing sounding on it to silence.
 *
 * Addressed by id alone: the caller already knows this device is a Grand Boule,
 * and `resolveDeviceNode`'s kind arm matches the first node of that kind in
 * strip order, so a strip hosting two pianos would silence the first one twice
 * and the second never.
 */
function silenceWebAudioGrandBoule(trackId: string, deviceId: string): void {
    const strip = audioEngine.getTrackStrip(trackId);
    const controls = resolveDeviceNode(strip, { deviceId })?.grandBouleControls;
    if (!controls?.ready) {
        return;
    }

    controls.allNotesOff();
    controls.setSustain(0);
    controls.setSostenuto(false);
    controls.setUnaCorda(false);
}

/**
 * Send the engine's body the two channel-mode messages a panic is made of.
 *
 * All Sound Off kills the voices; Reset All Controllers lifts the pedals that
 * made the kill necessary, and discharges the renderer's memory of them on the
 * way through, so the body built for the next play does not come up standing on
 * a pedal this panic just raised (`liveMidiControlLatch.ts`).
 *
 * Held rather than carried: a shadowed session sounds nothing and still builds
 * the bodies, so a pedal can be latched on one nobody hears.
 */
function silenceNativeGrandBoule(trackId: string, deviceId: string): void {
    if (!isDeviceHeldByNativeSession(trackId, deviceId)) {
        return;
    }
    for (const controller of [CC_ALL_SOUND_OFF, CC_RESET_ALL_CONTROLLERS]) {
        void sendNativeLiveMidiControl({
            trackId,
            deviceId,
            controller,
            value: PANIC_VALUE,
            channel: PANIC_CHANNEL,
        });
    }
}
