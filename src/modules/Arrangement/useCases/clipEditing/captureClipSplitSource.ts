import { getHeads } from '@automerge/automerge';

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
import { type PreparedClipSplit } from './preparedClipSplit';
import { projectClipReplayPrefix } from './projectClipReplayPrefix';

type Root = Readonly<Record<string, unknown>>;

function readSplitSourceOwners(document: Root, clipIds: ReadonlySet<string>, laneIds: ReadonlySet<string>) {
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
            .filter((lane) => isRecord(lane) && laneIds.has(String(lane.id)))
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

function subscribeSplitSourceOwners(observe: () => void): () => void {
    const releases = [
        trackStore.subscribe(observe),
        takeLaneStore.subscribe(observe),
        transportStore.subscribe(observe),
        tempoMapStore.subscribe(observe),
    ];
    return () => {
        for (const unsubscribe of releases.splice(0)) {
            unsubscribe();
        }
    };
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
    const release = subscribeSplitSourceOwners(observe);
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
            clipSplitSource.kind,
            clipSplitSource.projection(undoEntryId, plan.previous, plan.next, transitions),
            reference
        );
    } catch (error) {
        release();
        throw error;
    }
    return {
        captureWrittenState: () => {
            const current = projected();
            if (!matchesWrittenSplitSource(plan, transitions, current)) {
                return false;
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
