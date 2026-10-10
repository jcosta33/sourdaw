import { resolveDeviceNode } from '../../models/ResolveDeviceNode';

import type { WebMidiInstrumentStrip } from './engineStripAccess';

export type WebMidiInstrumentTrack = Readonly<{
    id: string;
    devices: readonly Readonly<{
        id: string;
        type: string;
    }>[];
}>;

/**
 * Deliver one Note Off to whichever instrument device node the given track
 * hosts (fermenter / grand-boule / levain). The first matching device wins,
 * matching the priority `handleNoteOff` uses. Fermenter and Levain only call a
 * ready strip control. Grand Boule also emits its MIDI note-off event whenever
 * the track has a Grand Boule device, even when the strip/control is not ready.
 *
 * `releaseVelocity` (normalized 0..1) is the MIDI note-off velocity; it is
 * forwarded to the Grand Boule control so the release dynamic survives the
 * rack-routed path.
 */
export function routeYeastNoteOffToInstrument(
    instrumentTrack: WebMidiInstrumentTrack,
    strip: WebMidiInstrumentStrip | undefined,
    note: number,
    releaseVelocity: number,
    emitGrandBouleEvent: (deviceId: string, midiNote: number) => void,
    sampleFrame?: number
): void {
    const fDev = instrumentTrack.devices.find((data) => data.type === 'fermenter');
    if (fDev) {
        const dn = resolveDeviceNode(strip, { type: 'fermenter' });
        if (sampleFrame === undefined) {
            dn?.fermenterControls?.noteOff(note);
        } else {
            dn?.fermenterControls?.noteOff(note, sampleFrame);
        }
        return;
    }
    const gbDev = instrumentTrack.devices.find((data) => data.type === 'grand-boule');
    if (gbDev) {
        const dn = resolveDeviceNode(strip, { type: 'grand-boule' });
        dn?.grandBouleControls?.noteOff(note, sampleFrame, releaseVelocity);
        emitGrandBouleEvent(gbDev.id, note);
        return;
    }
    const lDev = instrumentTrack.devices.find((data) => data.type === 'levain');
    if (lDev) {
        const dn = resolveDeviceNode(strip, { type: 'levain' });
        if (sampleFrame === undefined) {
            dn?.levainControls?.noteOff(note);
        } else {
            dn?.levainControls?.noteOff(note, sampleFrame);
        }
    }
}
