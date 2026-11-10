import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    captureOfflineRenderProjectSource,
    captureOfflineRenderRuntimeInput,
    getAudioContext,
} from '#/modules/AudioEngine/useCases';
import {
    settlePendingProjectWritesAndCaptureRevision,
    captureProjectRootIdentity,
    getCrdtDoc,
    projectRevisionMatchesLiveWithinProjection,
} from '#/modules/CrdtDocument/useCases';
import { getMidiStoreState } from '#/modules/MIDI/useCases';
import { DEFAULT_TEMPO_BPM, readBeatAtSamples, readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { type HandlerCommitValidation } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type Track } from '../../models/Track';
import { selectOfflineRenderSubgraph } from '../selectOfflineRenderSubgraph';
import { collectTracksClipBufferIds } from '../timeOperations/collectTracksClipBufferIds';

import { selectionBounceSourceProjection } from './selectionBounceSourceProjection';

const SOURCE_CHANGED = 'Bounce source changed while rendering';

function captureRuntimeFacts(currentTracks: readonly Track[], renderTracks: readonly Track[], sampleRate: number) {
    const runtime = captureOfflineRenderRuntimeInput(currentTracks, sampleRate);
    const renderDeviceIds = new Set(renderTracks.flatMap((row) => row.devices.map((device) => device.id)));
    return {
        sampleRate: getAudioContext().sampleRate,
        scheduleGrainMs: captureOfflineRenderProjectSource().transport?.scheduleGrainMs,
        latency: [...runtime.deviceLatencyMs],
        calibration: Array.from(runtime.calibrationByDevice).filter(([id]) => renderDeviceIds.has(id)),
        loadedPlugins: [...runtime.loadedExternalInstanceIds].toSorted(),
        externalParameters: runtime.externalPluginParameters,
    };
}

function captureMaterialFacts(sourceTracks: Track[]) {
    const bufferIds = new Set(collectTracksClipBufferIds(sourceTracks));
    for (const row of sourceTracks) {
        if (row.freezeState.status === 'frozen' && row.freezeState.frozenBufferId) {
            bufferIds.add(row.freezeState.frozenBufferId);
        }
    }
    return Array.from(bufferIds, (id) => {
        const buffer = audioBufferCache.get(id);
        return {
            id,
            buffer,
            publication: buffer ? audioBufferCache.readRuntimeMaterialPublication(id, buffer) : undefined,
        };
    });
}

function collectSourceClipIds(
    sourceTracks: Track[],
    lanes: ReturnType<typeof captureOfflineRenderProjectSource>['takeLanes']
) {
    const clipIds = new Set(sourceTracks.flatMap((row) => row.clips.map((clip) => clip.id)));
    for (const lane of lanes?.lanes ?? []) {
        if (sourceTracks.some((row) => row.id === lane.trackId)) {
            for (const take of lane.takes) {
                clipIds.add(take.clipId);
            }
        }
    }
    return clipIds;
}

function captureSourceTimeline(project: ReturnType<typeof captureOfflineRenderProjectSource>) {
    const clock = {
        tempo: project.transport?.tempo ?? DEFAULT_TEMPO_BPM,
        changes: structuredClone(project.tempoMap?.changes ?? []),
    };
    return {
        secondsAtBeat: (beat: number) => readSecondsAtBeat({ beat, clock }),
        tempoAtBeat: (beat: number) => readTempoAtBeat({ beat, clock }),
        beatAtSeconds: (seconds: number) => readBeatAtSamples({ samples: seconds, sampleRate: 1, clock }),
    };
}

/** Authenticates published project/source and decoded material. Live device previews remain #6305. */
export function captureSelectionBounceSource(track: Track, signal?: AbortSignal) {
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const root = getCrdtDoc('root');
    if (!root) {
        return null;
    }
    const rootIdentity = captureProjectRootIdentity();
    const project = captureOfflineRenderProjectSource();
    const tracks = project.tracks?.tracks ?? [];
    const sampledTrack = tracks.find((row) => row.id === track.id);
    if (!sampledTrack) {
        return null;
    }
    const { renderTracks } = selectOfflineRenderSubgraph({
        targetTrack: sampledTrack,
        allTracks: tracks,
        sidechainRoutes: project.sidechainRoutes,
        includeSendReturns: true,
    });
    const toasterIds = new Set(
        renderTracks.filter((row) => row.devices.some((device) => device.type === 'toaster')).map((row) => row.id)
    );
    const sourceTracks = tracks.filter(
        (row) => renderTracks.includes(row) || (row.parentId !== null && toasterIds.has(row.parentId))
    );
    const trackIds = new Set(sourceTracks.map((row) => row.id));
    const clipIds = collectSourceClipIds(sourceTracks, project.takeLanes);
    const projectSource = selectionBounceSourceProjection(trackIds, clipIds);
    const expectedSource = projectSource(root);
    const sampleRate = getAudioContext().sampleRate;
    const runtime = captureRuntimeFacts(tracks, renderTracks, sampleRate);
    const materials = captureMaterialFacts(sourceTracks);
    function runtimeMatches(): boolean {
        const current = captureOfflineRenderProjectSource();
        return (
            valuesEqual(captureRuntimeFacts(current.tracks?.tracks ?? [], renderTracks, sampleRate), runtime) &&
            materials.every(
                ({ id, buffer, publication }) =>
                    audioBufferCache.get(id) === buffer &&
                    (!buffer || audioBufferCache.readRuntimeMaterialPublication(id, buffer) === publication)
            )
        );
    }
    function matches(): boolean {
        const current = getCrdtDoc('root');
        return (
            !signal?.aborted &&
            captureProjectRootIdentity() === rootIdentity &&
            current !== undefined &&
            valuesEqual(projectSource(current), expectedSource) &&
            projectRevisionMatchesLiveWithinProjection(revision, projectSource) &&
            runtimeMatches()
        );
    }
    const timeline = captureSourceTimeline(project);
    return {
        matches,
        track: sampledTrack,
        timeline,
        commitValidation(replacementTracks: Track[]): HandlerCommitValidation {
            const replacementMidi = getMidiStoreState();
            const afterClipIds = new Set([
                ...clipIds,
                ...replacementTracks
                    .filter((row) => trackIds.has(row.id))
                    .flatMap((row) => row.clips.map((clip) => clip.id)),
            ]);
            const projectAfter = selectionBounceSourceProjection(trackIds, afterClipIds);
            const expectedAfter = projectAfter({
                ...root,
                tracks: { tracks: replacementTracks },
                midi: valuesEqual(replacementMidi, project.midi) ? root.midi : replacementMidi,
            });
            return {
                documentId: 'root',
                beforeCommit: () => (matches() ? null : SOURCE_CHANGED),
                beforeMutation: (document) =>
                    !signal?.aborted &&
                    captureProjectRootIdentity() === rootIdentity &&
                    valuesEqual(projectSource(document), expectedSource) &&
                    runtimeMatches()
                        ? null
                        : SOURCE_CHANGED,
                validateDocument: (document) => {
                    const actual = projectAfter(document);
                    const changed = Object.keys(expectedAfter).filter(
                        (key) => !valuesEqual(actual[key], expectedAfter[key])
                    );
                    return changed.length === 0
                        ? null
                        : `Bounce output differs from its captured publication: ${changed.join(', ')}`;
                },
                release: () => undefined,
            };
        },
    };
}
