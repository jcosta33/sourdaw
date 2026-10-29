import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import {
    captureProjectRootIdentity,
    getCrdtDoc,
    hasForeignPendingProjectWrites,
    stageCommandSourcePublication,
} from '#/modules/CrdtDocument/useCases';
import { isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { type AppAction, type CommandSourceProof, type HandlerCommitValidation } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';
import { readTempoMapRows } from '#/utils/tempoMapRowPlan';
import { type TempoSourceClock } from '#/utils/tempoSourceClock';

import { projectAudioSourcePrefixTracks } from '../../stores/projectAudioSourcePrefixTracks';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';

import { reKeyedTakeLaneOwnersMatchStore } from '../comping/reKeyedTakeLaneOwnersMatchStore';

import { projectClipReplayPrefix } from './projectClipReplayPrefix';
import { audioClipStartTrimState } from './audioClipStartTrimState';
import {
    CLIP_SPLIT_SOURCE_KIND,
    clipSplitSourceFields,
    clipSplitSourceJson,
    clipSplitSourceProjection,
    clipSplitTakeSourceFields,
} from './clipSplitSource';
import { type PreparedClipSplit } from './preparedClipSplit';

type Root = Readonly<Record<string, unknown>>;

function readSplitSourceOwners(document: Root, clipIds: ReadonlySet<string>, laneIds: ReadonlySet<string>) {
    const tracks: readonly unknown[] =
        isRecord(document.tracks) && Array.isArray(document.tracks.tracks) ? document.tracks.tracks : [];
    const lanes: readonly unknown[] =
        isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
    return clipSplitSourceJson({
        clips: Array.from(tracks).flatMap((track) => {
            if (!isRecord(track) || !Array.isArray(track.clips)) {
                return [];
            }
            return Array.from(track.clips)
                .filter((clip) => isRecord(clip) && clipIds.has(String(clip.id)))
                .map((clip) => ({ trackId: track.id, clip: isRecord(clip) ? clipSplitSourceFields(clip) : null }));
        }),
        lanes: Array.from(lanes)
            .filter((lane) => isRecord(lane) && laneIds.has(String(lane.id)))
            .map((lane) => {
                if (!isRecord(lane)) {
                    return null;
                }
                return {
                    id: lane.id,
                    trackId: lane.trackId,
                    takes: Array.isArray(lane.takes)
                        ? Array.from(lane.takes).filter(isRecord).map(clipSplitTakeSourceFields)
                        : null,
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

function matchesAuthoritativeSplitPrefix(
    root: Root,
    plan: PreparedClipSplit,
    clock: TempoSourceClock,
    priorActions: readonly AppAction[]
): boolean {
    const lanes = isRecord(root.takeLanes) ? root.takeLanes.lanes : [];
    const takes = Array.isArray(lanes) ? decodeExactTakeLaneSnapshots(Array.from(lanes), 'split-source-prefix') : null;
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
        return false;
    }
    const prefix = projectClipReplayPrefix(priorActions, {
        tracks: projectAudioSourcePrefixTracks(root.tracks ?? { tracks: [] }),
        takeLanes: takes,
        automationLanes: Array.from(automation),
        clock: { tempo, changes },
    });
    const owners = prefix?.clips.filter((row) => row.clip.id === plan.previous.leftClip.id);
    const current = owners?.[0];
    return (
        prefix !== null &&
        owners?.length === 1 &&
        current?.owningTrackId === plan.previous.trackId &&
        current.clip.locked === plan.previous.leftClip.locked &&
        valuesEqual(clipSplitSourceFields(current.clip), clipSplitSourceFields(plan.previous.leftClip)) &&
        !prefix.clips.some((row) => row.clip.id === plan.rightClipId) &&
        valuesEqual(prefix.clock, clock) &&
        reKeyedTakeLaneOwnersMatchStore(plan.takeReKeyTransitions ?? [], 'apply', [], prefix.takeLanes)
    );
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
    const read = (document: Root) => readSplitSourceOwners(document, clipIds, laneIds);
    const projected = () =>
        read({
            ...getCrdtDoc('root'),
            tracks: trackStore.value,
            takeLanes: takeLaneStore.value,
            transport: transportStore.value,
            tempoMap: tempoMapStore.value,
        });
    const before = read(root);
    let observed = projected();
    let expected: unknown;
    const basisHeads = getHeads(root).toSorted();
    let heads = basisHeads;
    let intervened = false;
    const observe = () => {
        const current = getCrdtDoc('root');
        const next = projected();
        const nextHeads = current ? getHeads(current).toSorted() : [];
        const changed = !valuesEqual(next, observed);
        intervened ||=
            !current ||
            captureProjectRootIdentity() !== identity ||
            !valuesEqual(heads, nextHeads) ||
            (changed && getCurrentAutomergeStorageMutationOwner() !== owner);
        if (expected !== undefined && changed && !intervened) {
            expected = next;
        }
        observed = next;
        heads = nextHeads;
    };
    const releases = [
        trackStore.subscribe(observe),
        takeLaneStore.subscribe(observe),
        transportStore.subscribe(observe),
        tempoMapStore.subscribe(observe),
    ];
    const release = () => {
        for (const unsubscribe of releases.splice(0)) {
            unsubscribe();
        }
    };
    const unchanged = () => {
        const current = getCrdtDoc<Root>('root');
        return (
            !intervened &&
            captureProjectRootIdentity() === identity &&
            current !== undefined &&
            valuesEqual(getHeads(current).toSorted(), basisHeads) &&
            valuesEqual(read(current), before)
        );
    };
    let publish: () => void;
    try {
        publish = stageCommandSourcePublication(
            CLIP_SPLIT_SOURCE_KIND,
            clipSplitSourceProjection(undoEntryId, plan.previous, plan.next, transitions),
            reference
        );
    } catch (error) {
        release();
        throw error;
    }
    return {
        captureWrittenState: () => {
            const expectedClips = [plan.next.leftClip, plan.next.rightClip].flatMap((clip) =>
                clip ? [{ trackId: plan.next.trackId, clip: clipSplitSourceFields(clip) }] : []
            );
            const current = projected();
            if (!isRecord(current) || !valuesEqual(current.clips, expectedClips)) {
                return false;
            }
            for (const transition of transitions) {
                const lane = takeLaneStore.value?.lanes.find((row) => row.id === transition.laneId);
                if (
                    !lane ||
                    lane.trackId !== transition.trackId ||
                    !valuesEqual(
                        clipSplitSourceJson(lane.takes.map(clipSplitTakeSourceFields)),
                        clipSplitSourceJson(transition.takesAfter.map(clipSplitTakeSourceFields))
                    ) ||
                    !valuesEqual(
                        clipSplitSourceJson(lane.activeCompRegions),
                        clipSplitSourceJson(transition.regionsAfter)
                    ) ||
                    !valuesEqual(
                        clipSplitSourceJson(lane.baseGapAudioSources),
                        clipSplitSourceJson(transition.baseGapAudioSourcesAfter)
                    )
                ) {
                    return false;
                }
            }
            expected = current;
            return !intervened;
        },
        validation: {
            documentId: 'root',
            beforeCommit: () => (unchanged() ? null : 'Split source owners or clock changed before commit'),
            validateDocument: (document) =>
                unchanged() && expected !== undefined && valuesEqual(read(document), expected)
                    ? null
                    : 'Split source effect did not reach committed owners',
            release,
            afterPublication: publish,
        },
    };
}
