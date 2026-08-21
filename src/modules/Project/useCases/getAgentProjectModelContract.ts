import {
    AGENT_PROJECT_MODEL_SCHEMA,
    AGENT_PROJECT_MODEL_SCHEMA_VERSION,
    type AgentProjectAsset,
    type AgentProjectClip,
    type AgentProjectDevice,
    type AgentProjectMidiNote,
    type AgentProjectModelContract,
    type AgentProjectRoute,
    type AgentProjectTrack,
} from '../models/AgentProjectModelContract';
import {
    CURRENT_PROJECT_VERSION,
    isCanonicalProjectId,
    type ProjectAutomationLane,
    type ProjectClip,
    type ProjectData,
    type ProjectDevice,
    type ProjectMidiNote,
    type ProjectTrack,
} from '../models/ProjectData';

import { buildProjectData } from './projectPersistence/fileIO/buildProjectData';
import { isHydratableProjectData } from './projectPersistence/helpers/isHydratableProjectData';

type GetAgentProjectModelContractInput = {
    projectData?: ProjectData;
};

type CanonicalProjectData = ProjectData & {
    meta: ProjectData['meta'] & { projectId: string };
};

function isCanonicalProjectData(data: ProjectData): data is CanonicalProjectData {
    return (
        data.version === CURRENT_PROJECT_VERSION &&
        isHydratableProjectData(data) &&
        isCanonicalProjectId(data.meta.projectId)
    );
}

function projectMidiNote(note: ProjectMidiNote): AgentProjectMidiNote {
    return {
        id: note.id,
        pitch: note.pitch,
        timing: {
            startBeat: note.startBeat,
            durationBeats: note.duration,
            releaseBeat: note.startBeat + note.duration,
        },
        velocity: note.velocity,
        channel: note.channel ?? 1,
        probability: note.probability ?? 100,
        articulation: note.articulation ?? null,
        expression: {
            pressure: note.pressure ?? 0,
            slide: note.slide ?? 0,
            pitchBend: note.pitchBend ?? 0,
            pitchBendRangeSemitones: note.pitchBendRangeSemitones ?? null,
        },
        perNoteAutomation: [],
        quantization: null,
        humanization: null,
        provenance: null,
    };
}

function projectDevice(device: ProjectDevice, slot: number): AgentProjectDevice {
    return {
        instanceId: device.id,
        name: device.name,
        type: device.type,
        version: device.deviceState?.version ?? null,
        slot,
        bypassed: device.bypassed,
        preset: null,
        parameters: Object.entries(device.parameterValues)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([id, value]) => ({ id, value, unit: null })),
        ports: { inputs: [], outputs: [] },
        latencySeconds: null,
        tailSeconds: null,
        state:
            device.deviceState ??
            (device.externalStateChunk ? { version: null, opaqueBase64: device.externalStateChunk } : null),
        manifest: null,
    };
}

function clipAutomation(data: ProjectData, trackId: string): ProjectAutomationLane[] {
    return (data.automation?.lanes ?? [])
        .filter((lane) => lane.trackId === trackId)
        .map((lane) => structuredClone(lane));
}

function clipStorageKind(clip: ProjectClip): AgentProjectClip['source']['storageKind'] {
    if (clip.type !== 'audio') {
        return null;
    }
    if (clip.fileId) {
        return 'reference';
    }
    if (clip.bufferId ?? clip.audioBufferId) {
        return 'embedded';
    }
    return 'unresolved';
}

function projectClip(data: ProjectData, clip: ProjectClip): AgentProjectClip {
    const lane = data.takeLanes?.lanes.find((candidate) => candidate.takes.some((take) => take.clipId === clip.id));
    const automation = clipAutomation(data, clip.trackId);
    const notes = clip.notes ?? data.midi?.notesByClipId[clip.id] ?? [];
    const assetId = clip.assetHash ?? null;
    const storageKind = clipStorageKind(clip);
    return {
        id: clip.id,
        name: clip.name,
        source: {
            kind: clip.type,
            assetId,
            storageKind,
            bufferId: clip.bufferId ?? clip.audioBufferId ?? null,
            fileId: clip.fileId ?? null,
        },
        timing: {
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            durationBeats: clip.endBeat - clip.startBeat,
        },
        offset: {
            audioBeats: clip.sampleStartBeat ?? clip.audioOffsetBeats ?? 0,
            midiBeats: clip.midiOffsetBeats ?? 0,
        },
        loop: { enabled: clip.loopEnabled ?? false, lengthBeats: clip.loopLength ?? null },
        gain: clip.gain,
        fades: { inBeats: clip.fadeInBeats, outBeats: clip.fadeOutBeats },
        stretch: { mode: clip.stretchMode ?? 'off', ratio: clip.stretchRatio ?? 1 },
        pitch: { keyRoot: clip.sourceKeyRoot ?? null, scaleName: clip.sourceScaleName ?? null },
        warp: { markers: [], kneadState: clip.kneadState ?? null },
        takes: lane?.takes.filter((take) => take.clipId === clip.id).map((take) => structuredClone(take)) ?? [],
        comp: lane?.activeCompRegions.map((region) => ({ ...region })) ?? [],
        automation,
        locks: clip.locked ? [`clip:${clip.id}`] : [],
        midi: clip.type === 'midi' ? { notes: notes.map(projectMidiNote) } : null,
    };
}

function projectTrack(data: ProjectData, track: ProjectTrack, order: number): AgentProjectTrack {
    const role =
        data.meta.productionBrief?.trackRoles.find((candidate) => candidate.trackId === track.id)?.role ?? null;
    const briefLocked = data.meta.productionBrief?.locks.some(
        (lock) => lock.scope.kind === 'track' && lock.scope.trackId === track.id
    );
    return {
        id: track.id,
        name: track.name,
        type: track.kind,
        order,
        hierarchy: { parentId: track.parentId, groupId: track.groupId },
        tags: [],
        role,
        controls: {
            gain: track.gain,
            pan: track.pan,
            muted: track.muted,
            soloed: track.soloed,
            armed: track.armed,
            monitoring: track.inputMonitoring,
        },
        io: { inputId: track.inputId, outputId: track.outputId },
        devices: track.devices.map(projectDevice),
        sends: track.sends.map((_send, index) => `route:send:${track.id}:${_send.busId}:${index}`),
        sidechains: (data.sidechainRoutes ?? [])
            .filter((route) => route.sourceTrackId === track.id || route.targetTrackId === track.id)
            .map((route) => route.id),
        clips: track.clips.map((clip) => projectClip(data, clip)),
        automation: clipAutomation(data, track.id),
        freeze: structuredClone(track.freezeState),
        locked: Boolean(briefLocked),
    };
}

function outputRoutes(tracks: readonly ProjectTrack[]): AgentProjectRoute[] {
    return tracks.map((track) => ({
        id: `route:output:${track.id}`,
        type: 'output',
        source: { trackId: track.id, portId: null },
        target: { trackId: track.outputId, deviceId: null, parameterId: null },
        gain: track.gain,
        faderMode: 'post',
        channelMap: null,
        sidechain: false,
        cyclePolicy: 'reject',
        enabled: !track.disabled,
        groupId: track.groupId,
    }));
}

function sendRoutes(tracks: readonly ProjectTrack[]): AgentProjectRoute[] {
    return tracks.flatMap((track) =>
        track.sends.map((send, index) => ({
            id: `route:send:${track.id}:${send.busId}:${index}`,
            type: 'send' as const,
            source: { trackId: track.id, portId: null },
            target: { trackId: send.busId, deviceId: null, parameterId: null },
            gain: send.level,
            faderMode: send.preFader ? ('pre' as const) : ('post' as const),
            channelMap: null,
            sidechain: false,
            cyclePolicy: 'reject' as const,
            enabled: !track.disabled,
            groupId: track.groupId,
        }))
    );
}

function sidechainRoutes(data: ProjectData): AgentProjectRoute[] {
    return (data.sidechainRoutes ?? []).map((route) => ({
        id: route.id,
        type: 'sidechain',
        source: { trackId: route.sourceTrackId, portId: null },
        target: {
            trackId: route.targetTrackId,
            deviceId: route.targetDeviceId,
            parameterId: route.targetParameterId,
        },
        gain: route.gain,
        faderMode: 'pre',
        channelMap: null,
        sidechain: true,
        cyclePolicy: 'reject',
        enabled: true,
        groupId: null,
    }));
}

function fileFormat(fileId: string | undefined): string | null {
    const extension = fileId?.split('.').pop();
    return extension && extension !== fileId ? extension.toLowerCase() : null;
}

function projectAssets(data: ProjectData): AgentProjectAsset[] {
    const byHash = new Map<string, AgentProjectAsset>();
    for (const track of data.arrangement.tracks) {
        for (const clip of track.clips) {
            if (clip.type !== 'audio' || !clip.assetHash || byHash.has(clip.assetHash)) {
                continue;
            }
            const bufferId = clip.bufferId ?? clip.audioBufferId;
            const buffer = bufferId ? data.audioBuffers?.[bufferId] : undefined;
            byHash.set(clip.assetHash, {
                id: clip.assetHash,
                contentHash: clip.assetHash,
                storageKind: clip.fileId ? 'reference' : 'embedded',
                name: clip.name,
                durationSeconds: null,
                sampleRate: buffer?.sampleRate ?? null,
                channels: buffer?.numberOfChannels ?? null,
                format: fileFormat(clip.fileId),
                sourceMetadata: { fileId: clip.fileId ?? null, bufferId: bufferId ?? null },
            });
        }
    }
    return [...byHash.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function sampleRate(data: ProjectData): number | null {
    const embedded = Object.values(data.audioBuffers ?? {})[0]?.sampleRate;
    if (embedded !== undefined) {
        return embedded;
    }
    for (const track of data.arrangement.tracks) {
        const frozen = track.freezeState.renderSettings?.sampleRate;
        if (frozen !== undefined) {
            return frozen;
        }
    }
    return null;
}

function projectContract(data: CanonicalProjectData): AgentProjectModelContract {
    const activeArrangement = data.arrangements?.find((arrangement) => arrangement.id === data.activeArrangementId);
    const sections = activeArrangement?.markers?.sections ?? [];
    const endBeat = Math.max(
        0,
        ...data.arrangement.tracks.flatMap((track) => track.clips.map((clip) => clip.endBeat)),
        ...sections.map((section) => section.endBeat)
    );
    const masterTrack = data.arrangement.tracks.find((track) => track.kind === 'master');
    return {
        schema: AGENT_PROJECT_MODEL_SCHEMA,
        schemaVersion: AGENT_PROJECT_MODEL_SCHEMA_VERSION,
        projectSchemaVersion: data.version,
        identity: { projectId: data.meta.projectId, legacyProjectId: String(data.meta.createdAt) },
        metadata: {
            name: data.meta.name,
            createdAt: data.meta.createdAt,
            updatedAt: data.meta.updatedAt,
            keyRoot: data.meta.keyRoot,
            scaleName: data.meta.scaleName,
            tuningName: data.meta.tuning.name,
        },
        sampleRate: sampleRate(data),
        tempoMap: (data.tempoMap?.changes ?? [{ beat: 0, tempo: data.transport.tempo, curve: 'instant' as const }]).map(
            (change, index) => ({
                id: change.id ?? `tempo:${index}`,
                beat: change.beat,
                tempo: change.tempo,
                curve: change.curve ?? 'instant',
            })
        ),
        meterMap: (
            data.timeSignatureMap?.changes ?? [
                {
                    beat: 0,
                    numerator: data.transport.timeSignatureNumerator,
                    denominator: data.transport.timeSignatureDenominator,
                },
            ]
        ).map((change, index) => ({ id: change.id ?? `meter:${index}`, ...change })),
        markers: structuredClone(data.markers),
        sections: structuredClone(sections),
        arrangement: {
            activeArrangementId: data.activeArrangementId ?? null,
            startBeat: 0,
            endBeat,
            loop: {
                enabled: data.transport.isLooping,
                startBeat: data.transport.loopStart,
                endBeat: data.transport.loopEnd,
            },
        },
        master: {
            trackId: masterTrack?.id ?? null,
            gain: data.transport.masterGain,
            pan: masterTrack?.pan ?? 0,
            muted: masterTrack?.muted ?? false,
            soloed: masterTrack?.soloed ?? false,
            outputId: masterTrack?.outputId ?? null,
        },
        settings: {
            metronome: { enabled: data.transport.metronomeEnabled, volume: data.transport.metronomeVolume },
            punch: {
                enabled: data.transport.punchInEnabled,
                inBeat: data.transport.punchInBeat,
                outBeat: data.transport.punchOutBeat,
            },
            countIn: { enabled: data.transport.countInEnabled, bars: data.transport.countInBars },
            preRoll: { enabled: data.transport.preRollEnabled, bars: data.transport.preRollBars },
        },
        locks: structuredClone(data.meta.productionBrief?.locks ?? []),
        brief: data.meta.productionBrief ? structuredClone(data.meta.productionBrief) : null,
        warnings: data.meta.productionBrief?.unresolvedQuestions.map((question) => question.statement) ?? [],
        tracks: data.arrangement.tracks.map((track, order) => projectTrack(data, track, order)),
        routing: [
            ...outputRoutes(data.arrangement.tracks),
            ...sendRoutes(data.arrangement.tracks),
            ...sidechainRoutes(data),
        ],
        assets: projectAssets(data),
        history: structuredClone(data.history.checkpoints),
    };
}

export async function getAgentProjectModelContract(
    input: GetAgentProjectModelContractInput = {}
): Promise<AgentProjectModelContract | null> {
    const data = input.projectData ?? (await buildProjectData())?.data;
    return data && isCanonicalProjectData(data) ? projectContract(data) : null;
}
