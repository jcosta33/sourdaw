import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import {
    captureProjectRootIdentity,
    getCrdtDoc,
    hasForeignPendingProjectWrites,
    stageCommandSourcePublication,
} from '#/modules/CrdtDocument/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { type AppAction, type CommandSourceProof, type HandlerCommitValidation } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';
import { readTempoMapRows } from '#/utils/tempoMapRowPlan';
import { type TempoSourceClock } from '#/utils/tempoSourceClock';

import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { projectAudioSourcePrefixTracks } from '../../stores/projectAudioSourcePrefixTracks';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';
import { reKeyedTakeLaneOwnersMatchStore } from '../comping/reKeyedTakeLaneOwnersMatchStore';

import { audioClipStartTrimState } from './audioClipStartTrimState';
import { clipSplitSource } from './clipSplitSource';
import { observeClipSplitSource } from './observeClipSplitSource';
import { type PreparedClipSplit } from './preparedClipSplit';
import { projectClipReplayPrefix } from './projectClipReplayPrefix';
import { readClipSplitSourceAuthority } from './readClipSplitSourceAuthority';

type Root = Readonly<Record<string, unknown>>;

function readSplitSourceOwners(
    document: Root,
    trackId: string,
    clipIds: ReadonlySet<string>,
    laneIds: ReadonlySet<string>
) {
    const tracks: readonly unknown[] =
        isRecord(document.tracks) && Array.isArray(document.tracks.tracks) ? document.tracks.tracks : [];
    const lanes: readonly unknown[] =
        isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
    return clipSplitSource.json({
        clips: Array.from(tracks).flatMap((track) => {
            if (!isRecord(track) || !Array.isArray(track.clips)) {
                return [];
            }
            return Array.from(track.clips)
                .filter((clip) => isRecord(clip) && clipIds.has(String(clip.id)))
                .map((clip) => ({ trackId: track.id, clip: isRecord(clip) ? clipSplitSource.fields(clip) : null }));
        }),
        lanes: Array.from(lanes)
            .filter((lane) => isRecord(lane) && (lane.trackId === trackId || laneIds.has(String(lane.id))))
            .map((lane) => {
                if (!isRecord(lane)) {
                    return null;
                }
                let takes: ReturnType<typeof clipSplitSource.takeFields>[] | null = null;
                if (Array.isArray(lane.takes)) {
                    takes = Array.from(lane.takes).filter(isRecord).map(clipSplitSource.takeFields);
                }
                return {
                    id: lane.id,
                    trackId: lane.trackId,
                    takes,
                    regions: lane.activeCompRegions,
                    gaps: lane.baseGapAudioSources,
                };
            }),
        clock: {
            tempo: isRecord(document.transport) ? document.transport.tempo : DEFAULT_TEMPO_BPM,
            changes: readTempoMapRows(document),
        },
    });
}

function readAuthoritativeSplitPrefix(root: Root, priorActions: readonly AppAction[]) {
    const lanes = isRecord(root.takeLanes) ? root.takeLanes.lanes : [];
    const takes = Array.isArray(lanes) ? decodeExactTakeLaneSnapshots(Array.from(lanes), 'source-prefix') : null;
    const automation = isRecord(root.automation) ? root.automation.lanes : [];
    const changes = readTempoMapRows(root);
    const tempo = isRecord(root.transport) ? root.transport.tempo : DEFAULT_TEMPO_BPM;
    if (
        !takes ||
        !isExactAutomationLaneSnapshots(automation) ||
        !changes ||
        typeof tempo !== 'number' ||
        !Number.isFinite(tempo) ||
        tempo <= 0
    ) {
        return null;
    }
    return projectClipReplayPrefix(priorActions, {
        tracks: projectAudioSourcePrefixTracks(root.tracks ?? { tracks: [] }),
        takeLanes: takes,
        automationLanes: Array.from(automation),
        clock: { tempo, changes },
    });
}

function matchesAuthoritativeSplitPrefix(
    root: Root,
    plan: PreparedClipSplit,
    clock: TempoSourceClock,
    priorActions: readonly AppAction[]
): boolean {
    const prefix = readAuthoritativeSplitPrefix(root, priorActions);
    const owners = prefix?.clips.filter((row) => row.clip.id === plan.previous.leftClip.id);
    const current = owners?.[0];
    return (
        prefix !== null &&
        owners?.length === 1 &&
        current?.owningTrackId === plan.previous.trackId &&
        isExactClipSnapshot(current.clip, plan.previous.leftClip.id, current.owningTrackId) &&
        current.clip.locked === plan.previous.leftClip.locked &&
        valuesEqual(clipSplitSource.fields(current.clip), clipSplitSource.fields(plan.previous.leftClip)) &&
        !prefix.clips.some((row) => row.clip.id === plan.rightClipId) &&
        valuesEqual(prefix.clock, clock) &&
        reKeyedTakeLaneOwnersMatchStore(plan.takeReKeyTransitions ?? [], 'apply', [], prefix.takeLanes)
    );
}

function matchesWrittenSplitSource(
    plan: PreparedClipSplit,
    transitions: NonNullable<PreparedClipSplit['takeReKeyTransitions']>,
    current: unknown
): boolean {
    const expectedClips = clipSplitSource.json(
        [plan.next.leftClip, plan.next.rightClip].flatMap((clip) =>
            clip ? [{ trackId: plan.next.trackId, clip: clipSplitSource.fields(clip) }] : []
        )
    );
    if (!isRecord(current) || !valuesEqual(current.clips, expectedClips)) {
        return false;
    }
    for (const transition of transitions) {
        const lane = takeLaneStore.value?.lanes.find((row) => row.id === transition.laneId);
        if (
            !lane ||
            lane.trackId !== transition.trackId ||
            !valuesEqual(
                clipSplitSource.json(lane.takes.map(clipSplitSource.takeFields)),
                clipSplitSource.json(transition.takesAfter.map(clipSplitSource.takeFields))
            ) ||
            !valuesEqual(clipSplitSource.json(lane.activeCompRegions), clipSplitSource.json(transition.regionsAfter)) ||
            !valuesEqual(
                clipSplitSource.json(lane.baseGapAudioSources),
                clipSplitSource.json(transition.baseGapAudioSourcesAfter)
            )
        ) {
            return false;
        }
    }
    return true;
}

/** Only the retained forward plan in its entered command owner can attest this event. */
export function captureClipSplitSource(
    plan: PreparedClipSplit,
    clock: TempoSourceClock,
    undoEntryId: string | undefined,
    reference: CommandSourceProof,
    priorActions: readonly AppAction[]
): { validation: HandlerCommitValidation; captureWrittenState: () => boolean } | null {
    const owner = getCurrentAutomergeStorageMutationOwner();
    const root = getCrdtDoc<Root>('root');
    if (
        !owner ||
        !root ||
        !undoEntryId ||
        hasForeignPendingProjectWrites() ||
        !valuesEqual(audioClipStartTrimState.captureClock(), clock) ||
        !matchesAuthoritativeSplitPrefix(root, plan, clock, priorActions)
    ) {
        return null;
    }
    const identity = captureProjectRootIdentity();
    const clipIds = new Set([plan.previous.leftClip.id, plan.rightClipId]);
    const transitions = plan.takeReKeyTransitions ?? [];
    const laneIds = new Set(transitions.map((row) => row.laneId));
    const read = (document: Root) => readSplitSourceOwners(document, plan.previous.trackId, clipIds, laneIds);
    const projected = () =>
        read({
            ...getCrdtDoc('root'),
            tracks: trackStore.value,
            takeLanes: takeLaneStore.value,
            transport: transportStore.value,
            tempoMap: tempoMapStore.value,
        });
    const takeIds = new Set(
        transitions.flatMap((row) => [...row.takesBefore, ...row.takesAfter].map((take) => take.id))
    );
    const readOwners = (document: Root) => {
        const authority = readClipSplitSourceAuthority(document, {
            trackId: plan.previous.trackId,
            rightClipId: plan.rightClipId,
            clipIds,
            laneIds,
            takeIds,
        });
        return authority === null ? null : { source: read(document), authority };
    };
    const before = readOwners(root);
    if (!before) {
        return null;
    }
    const observation = observeClipSplitSource({ root, before, identity, owner, read, projected, readOwners });
    let publish: () => void;
    try {
        publish = stageCommandSourcePublication(
            clipSplitSource.kind,
            clipSplitSource.projection(undoEntryId, plan.previous, plan.next, transitions),
            reference
        );
    } catch (error) {
        observation.release();
        throw error;
    }
    return {
        captureWrittenState: () => {
            const current = projected();
            if (!matchesWrittenSplitSource(plan, transitions, current)) {
                return false;
            }
            return observation.recordWrittenState(current);
        },
        validation: {
            documentId: 'root',
            beforeCommit: observation.beforeCommit,
            beforeMutation: observation.beforeMutation,
            validateDocument: observation.validateDocument,
            release: observation.release,
            afterPublication: publish,
        },
    };
}
