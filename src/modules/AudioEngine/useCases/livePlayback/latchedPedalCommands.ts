/**
 * The pedals the player is standing on, as controllers a batch that builds
 * bodies can carry itself (#3998).
 *
 * Every native body comes up with its pedals raised and the engine never lifts
 * one (`AudioScheduler::pay_owed_releases`), so the foot the renderer
 * remembered (`liveMidiControlLatch.ts`) has to be pressed back onto each body
 * the engine builds — a session start, a rebind, a chain rebuild, an insert an
 * edit makes.
 *
 * Inside the building batch rather than behind it, which is the whole reason
 * this exists as commands rather than as a replay. `map_batch` maps a batch's
 * commands in order against one mutable registry
 * (`crates/sourdaw-native/src/commands/graph.rs`), so a body registered ahead
 * of a controller is a body the controller can address, and the engine applies
 * the whole batch inside one drain — the body takes the pedal before it renders
 * its first block. A pedal sent as its own later batch costs at least one
 * bridge round trip, and the engine renders that round trip: a clip note at the
 * play position would be struck with the hammers at full travel under a held
 * una corda, since stiffness is baked at `note_on`, and a sostenuto edge inside
 * that window would capture nothing.
 *
 * Both halves of the address are compared. A device id is unique per project,
 * but the latch is keyed by (track, device, controller) and the engine refuses a
 * controller naming a device some other strip holds, so the track has to match
 * too.
 *
 * In the latch's own order, which is first-press order: two pedals on one body
 * are independent positions, so no order between them changes what the body
 * ends up holding.
 */

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { readLatchedLiveMidiControls } from '../../services/liveMidiControlLatch';

export function latchedPedalCommands(
    inserted: readonly Readonly<{ trackId: string; deviceId: string }>[]
): readonly AudioGraphCommand[] {
    return readLatchedLiveMidiControls()
        .filter((control) =>
            inserted.some((address) => address.trackId === control.trackId && address.deviceId === control.deviceId)
        )
        .map((control) => ({
            kind: 'send-midi-control',
            target: { trackId: control.trackId, deviceId: control.deviceId },
            controller: control.controller,
            value: control.value,
            channel: control.channel,
        }));
}
