/**
 * What one native session plays, read against the topology it is building.
 *
 * The attach state travels with it because the programme cannot be projected
 * without it: whether a MIDI strip stays Web Audio's turns on whether the
 * engine already holds the instrument its notes address. Taken as an argument
 * rather than off the topology, because a session states its programme more
 * than once — again when the first batch reports newly attached plugins — and
 * a programme projected against the earlier set would leave an instrument the
 * engine has just taken web-voiced in a batch that gates Web Audio out of it.
 *
 * Read twice where a strip the engine carries holds a body the engine
 * compensates itself, because the two readings answer different questions of
 * each other. Which strips the engine carries is decided from the programme's
 * *shape* — what plays, what is baked, what stays web-voiced — never from its
 * figures, so the first reading is a sound input to the carrier law whatever
 * compensation it carried. The second reading is what corrects the figures,
 * with the engine-hosted strips named so the hold the engine takes for them is
 * not applied twice. A session holding no such body is one reading, because
 * the exclusion would be empty.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { engineHostedStripIds } from './engineHostedStripIds';
import { type LiveGraphProgramme } from './projectLiveGraphProgramme';
import { readLiveGraphProgramme } from './readLiveGraphProgramme';
import { projectStripCarriers } from './stripCarriers';

export type ReadSessionProgrammeInput = Readonly<{
    /** Every track and bus this session builds a strip for, in project order. */
    stripTracks: readonly Track[];
    /** The tracks whose Web Audio strip is receiving a live input signal. */
    inputMonitoredTrackIds: ReadonlySet<string>;
    /** The external plugin instances the native engine currently owns. */
    attachedInstanceIds: ReadonlySet<string>;
    /** The frame grid every beat is placed on, matching the caller's transport. */
    sampleRate: number;
}>;

export function readSessionProgramme(input: ReadSessionProgrammeInput): LiveGraphProgramme {
    const programme = readLiveGraphProgramme({
        stripTracks: input.stripTracks,
        attachedInstanceIds: input.attachedInstanceIds,
        sampleRate: input.sampleRate,
    });
    const hostedStripIds = engineHostedStripIds(
        projectStripCarriers({
            stripTracks: input.stripTracks,
            attachedInstanceIds: input.attachedInstanceIds,
            programme,
            inputMonitoredTrackIds: input.inputMonitoredTrackIds,
        }),
        input.stripTracks
    );
    if (hostedStripIds.size === 0) {
        return programme;
    }
    return readLiveGraphProgramme({
        stripTracks: input.stripTracks,
        attachedInstanceIds: input.attachedInstanceIds,
        sampleRate: input.sampleRate,
        engineHostedStripIds: hostedStripIds,
    });
}
