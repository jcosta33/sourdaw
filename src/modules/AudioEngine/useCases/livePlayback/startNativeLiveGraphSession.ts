/**
 * Start the native engine and give it the session's topology (#3066, D3.c.4a).
 *
 * The native engine has no start command: `apply_graph_commands` boots it on
 * the first batch (#1984), so *this* is the start. What the engine gains from
 * running is plugin hosting — `load_plugin` takes its engine-owned branch only
 * while an engine exists, and otherwise warns that the instance will not
 * process audio. What it does not gain is the mix: the batch carries no
 * `schedule-clip` (see `projectLiveGraphTopology`), so the engine renders
 * silence and Web Audio remains the live product path.
 *
 * ── Declining is an outcome, not a failure ────────────────────────────────
 *
 * A browser has no bridge, a desktop build whose addon cannot answer has no
 * engine, and a project the native registry refuses to hold has no topology it
 * can mirror. All three decline with the reason, and the caller carries on with
 * Web Audio exactly as before — which is why the caller can fire this without
 * waiting for it. Narrowing the refusals into gates the app checks up front is
 * the parity slice's work, not this one's: today a refusal costs one bridge
 * round trip and leaves the engine unstarted, which is the same place the app
 * was already in.
 */

import {
    deriveEffectiveAudibility,
    deriveVcaMultiplier,
    getVcaGroupsState,
    shouldCreateLiveTrackStrip,
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';
import { createNativeLiveGraphBackend } from '../../repositories/nativeGraph/createNativeLiveGraphBackend';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { projectLiveGraphTopology } from './projectLiveGraphTopology';

export type StartNativeLiveGraphSessionInput = Readonly<{
    /** Where playback begins, on the engine's clock. */
    positionSeconds: number;
}>;

export type NativeLiveGraphSessionResult =
    | Readonly<{ outcome: 'started'; runtimeRevision: number; reports: readonly AudioGraphStripReport[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * The strips the live engine builds, and the solo gate over them.
 *
 * Both read the Arrangement projections the live Web Audio path reads —
 * `shouldCreateLiveTrackStrip` for eligibility and `deriveEffectiveAudibility`
 * for the solo law — so the two engines cannot disagree about which strips a
 * session has or which of them solo is silencing.
 */
function readSessionTopology(): Readonly<{
    stripTracks: readonly Track[];
    soloGatedTrackIds: ReadonlySet<string>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
}> {
    const projectTracks = trackStore.value?.tracks ?? [];
    const stripTracks = projectTracks.filter((track) => !track.disabled && shouldCreateLiveTrackStrip(track));
    // The live solo path's ambiguous-owner guard (#593): a track id appearing
    // more than once in the document has no unambiguous solo owner, so it can
    // neither engage nor answer solo.
    const stripTrackIds = new Set(
        stripTracks
            .filter((track) => projectTracks.filter((candidate) => candidate.id === track.id).length === 1)
            .map((track) => track.id)
    );
    const { soloGatedByTrackId } = deriveEffectiveAudibility({
        tracks: projectTracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        stripTrackIds,
    });
    const vcaGroups = getVcaGroupsState();
    return {
        stripTracks,
        soloGatedTrackIds: new Set(
            stripTracks.filter((track) => soloGatedByTrackId.get(track.id) ?? false).map((track) => track.id)
        ),
        vcaMultiplierByTrackId: new Map(
            stripTracks.map((track): [string, number] => [
                track.id,
                deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
            ])
        ),
    };
}

export function startNativeLiveGraphSession(
    input: StartNativeLiveGraphSessionInput
): Promise<NativeLiveGraphSessionResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<NativeLiveGraphSessionResult> => {
        const availability = await probeNativeGraphTransport();
        if (!availability.available) {
            return { outcome: 'declined', reason: availability.reason };
        }
        const topology = readSessionTopology();
        // Read after the probe, so the batch describes the project as it stands
        // when it is actually sent rather than when the gesture happened.
        const commands = projectLiveGraphTopology({
            ...topology,
            transport: { playing: true, positionSeconds: input.positionSeconds },
        });

        const backend = createNativeLiveGraphBackend({ transport: availability.transport });
        // Every play sends the session's whole topology, so every play replaces
        // the one before it. The native registry lives as long as the process
        // and has no remove-strip command, so an additive batch would collide
        // with its own strip ids the second time; replacing also means topology
        // the engineer changed between plays actually reaches the engine, rather
        // than only the transport doing so.
        const result = await backend.apply({ schemaVersion: 1, replaceTopology: true, commands });
        if (result.application !== 'applied') {
            backend.dispose();
            // Both non-applied outcomes carry a reason: a refusal names the
            // command it could not hold, a partial application names what it
            // could not finish. Neither leaves a session worth keeping.
            return { outcome: 'declined', reason: result.reason };
        }
        // The previous session's handle is closed only once its replacement is
        // applied: a decline must leave the engine reachable through the handle
        // that was already working.
        nativeLiveGraphSession.backend?.dispose();
        nativeLiveGraphSession.backend = backend;
        return { outcome: 'started', runtimeRevision: result.runtimeRevision, reports: result.reports };
    });
}
