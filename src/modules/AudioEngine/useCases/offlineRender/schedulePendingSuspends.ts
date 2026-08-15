import { resolveToasterPadIndex } from '#/utils/toasterNoteProjection';

import {
    type DeviceNoteOffRequest,
    type DeviceNoteOnRequest,
} from '../../repositories/deviceStrategy/AudioDeviceStrategy';

import { comparePendingWorkletEvents } from './comparePendingWorkletEvents';
import { type PendingWorkletEvent } from './types';

/**
 * The request is assembled key by key so an absent channel or articulation is
 * an absent key rather than an explicit `undefined`: a device that never had
 * one must not be told it has one set to nothing.
 */
type MutableNoteOnRequest = { -readonly [K in keyof DeviceNoteOnRequest]: DeviceNoteOnRequest[K] };
type MutableNoteOffRequest = { -readonly [K in keyof DeviceNoteOffRequest]: DeviceNoteOffRequest[K] };

/**
 * Pre-queue all collected worklet note events to their respective DSP processors.
 * Must be called ONCE after ALL tracks are scheduled and BEFORE startRendering().
 *
 * This uses the sample-accurate `sampleFrame` parameter instead of main-thread
 * OfflineAudioContext.suspend() polling, preventing timing drift.
 *
 * The note surface is addressed by name (`DeviceNoteOnRequest`). It used to be
 * positional, and the two branches below disagreed about what slot three meant:
 * the pad branch put a MIDI note there — correct for Toaster — while the pitch
 * branch put `undefined` there and the frame in slot four, which is Toaster's
 * layout, not the melodic one. Fermenter, Levain and Grand Boule read slot three
 * as `sampleFrame`, so every note of an offline part for those devices arrived
 * frameless and fired the moment its message was handled.
 */
export function schedulePendingSuspends(
    offlineCtx: OfflineAudioContext,
    events: PendingWorkletEvent[],
    durationSeconds: number
): void {
    if (events.length === 0) {
        return;
    }

    // Sort by time, then noteOff before noteOn at same time (release before re-trigger).
    events.sort(comparePendingWorkletEvents);

    for (const evt of events) {
        if (evt.time >= durationSeconds) {
            continue;
        }

        const sampleFrame = Math.max(0, Math.floor(evt.time * offlineCtx.sampleRate));

        if (evt.type === 'on') {
            if (evt.isToaster) {
                const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : resolveToasterPadIndex(evt.pitch);
                if (pad === null) {
                    continue;
                }
                evt.instrumentControls.noteOn({
                    noteOrPad: pad,
                    velocity: evt.velocity,
                    midiNote: evt.pitch,
                    sampleFrame,
                });
            } else {
                const request: MutableNoteOnRequest = { noteOrPad: evt.pitch, velocity: evt.velocity, sampleFrame };
                if (evt.channel !== undefined) {
                    request.channel = evt.channel;
                }
                if (evt.articulationId !== undefined) {
                    request.articulationId = evt.articulationId;
                }
                evt.instrumentControls.noteOn(request);
            }
        } else {
            if (evt.isToaster) {
                const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : resolveToasterPadIndex(evt.pitch);
                if (pad === null) {
                    continue;
                }
                evt.instrumentControls.noteOff({ noteOrPad: pad, sampleFrame });
            } else {
                const request: MutableNoteOffRequest = { noteOrPad: evt.pitch, sampleFrame };
                if (evt.channel !== undefined) {
                    request.channel = evt.channel;
                }
                evt.instrumentControls.noteOff(request);
            }
        }
    }
}
