import { getNotesForClip, projectDrumPreviewCandidateNotes } from '#/modules/MIDI/useCases';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { type MaterializableRuntimeAction } from '../models/ExecutableRuntimeAction';
import { projectMidiArticulationTransfer } from '../transformers/projectMidiArticulationTransfer';

import { type BassProcessingCopyRequestScope } from './agentReference/getBassProcessingCopyPromptScope';
import { type DrumPreviewBranchesRequestScope } from './agentReference/getDrumPreviewBranchesPromptScope';
import { type MidiOverlapTransformRequestScope } from './agentReference/getMidiOverlapTransformPromptScope';
import { type SyncopatedArpeggioRequestScope } from './agentReference/getSyncopatedArpeggioPromptScope';
import { type ProjectContext, type ProjectContextAdjustmentLayer, type ProjectContextTrack } from './getProjectContext';

type MaterializeActionStateGuardsResult =
    { status: 'accepted'; actions: AppAction[] } | { status: 'rejected'; reason: string };

type MaterializeActionStateGuardsOptions = {
    appOwnedRenderTailSeconds?: number;
    bassProcessingCopyScope?: BassProcessingCopyRequestScope;
    midiOverlapTransformScope?: MidiOverlapTransformRequestScope;
    drumPreviewBranchesScope?: DrumPreviewBranchesRequestScope;
    syncopatedArpeggioScope?: SyncopatedArpeggioRequestScope;
};

function createProjectedBus(busId: string, name: string): ProjectContextTrack {
    return {
        id: busId,
        name,
        kind: 'bus',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        vcaGroupId: null,
        outputId: 'master',
        clipCount: 0,
        alternativeClipIds: [],
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

export function materializeActionStateGuards(
    actions: readonly MaterializableRuntimeAction[],
    context: ProjectContext,
    options: MaterializeActionStateGuardsOptions = {}
): MaterializeActionStateGuardsResult {
    const tracksById = new Map(context.tracks.map((track) => [track.id, track]));
    const frozenByTrack = new Map(context.tracks.map((track) => [track.id, track.frozen] as const));
    const reservedDeviceIds = new Set(context.tracks.flatMap((track) => track.devices.map((device) => device.id)));
    const reservedAdjustmentRegionIds = new Set(
        (context.adjustmentLayers ?? []).flatMap((layer) => layer.regions.map((region) => region.id))
    );
    const projectedAdjustmentLayers = new Map<string, ProjectContextAdjustmentLayer>(
        (context.adjustmentLayers ?? []).map((layer) => [
            layer.id,
            {
                ...layer,
                parameters: layer.parameters.map((parameter) => ({ ...parameter })),
                affectedTrackIds: [...layer.affectedTrackIds],
                regions: layer.regions.map((region) => ({ ...region })),
            },
        ])
    );
    const deviceIdsByTrack = new Map(
        context.tracks.map((track) => [track.id, track.devices.map((device) => device.id)] as const)
    );
    const materialized: AppAction[] = [];

    for (const action of actions) {
        if (action.type === 'addAdjustmentRegion') {
            const scope = options.bassProcessingCopyScope;
            const entry = scope?.entries.find(
                (candidate) =>
                    candidate.layer.id === action.payload.layerId &&
                    candidate.targetRegion.startBeat === action.payload.startBeat &&
                    candidate.targetRegion.endBeat === action.payload.endBeat &&
                    candidate.targetRegion.blend === action.payload.blend &&
                    candidate.targetRegion.fadeInBeats === action.payload.fadeInBeats &&
                    candidate.targetRegion.fadeOutBeats === action.payload.fadeOutBeats
            );
            const layer = projectedAdjustmentLayers.get(action.payload.layerId);
            if (!scope || !entry || !layer) {
                return { status: 'rejected', reason: 'EX-03 adjustment-layer scope is unavailable' };
            }
            const expectedTracks = layer.affectedTrackIds.flatMap((trackId) => {
                const track = tracksById.get(trackId);
                return track ? [{ trackId: track.id, trackName: track.name, frozen: track.frozen ?? false }] : [];
            });
            if (expectedTracks.length !== layer.affectedTrackIds.length) {
                return { status: 'rejected', reason: `EX-03 target track is unavailable: ${layer.id}` };
            }
            let regionId = `adjr-${crypto.randomUUID()}`;
            while (reservedAdjustmentRegionIds.has(regionId)) {
                regionId = `adjr-${crypto.randomUUID()}`;
            }
            reservedAdjustmentRegionIds.add(regionId);
            const region = {
                id: regionId,
                startBeat: action.payload.startBeat,
                endBeat: action.payload.endBeat,
                blend: action.payload.blend,
                fadeInBeats: action.payload.fadeInBeats,
                fadeOutBeats: action.payload.fadeOutBeats,
            };
            materialized.push({
                type: 'addAdjustmentRegion',
                payload: {
                    ...action.payload,
                    regionId,
                    sourceRegionId: entry.sourceRegion.id,
                    sourceSection: { ...scope.sourceSection },
                    targetSection: { ...scope.targetSection },
                    expectedLayer: {
                        ...layer,
                        parameters: layer.parameters.map((parameter) => ({ ...parameter })),
                        affectedTrackIds: [...layer.affectedTrackIds],
                        regions: layer.regions.map((region) => ({ ...region })),
                    },
                    expectedTracks,
                },
            });
            projectedAdjustmentLayers.set(layer.id, {
                ...layer,
                regions: [...layer.regions, region].sort((alpha, beta) => alpha.startBeat - beta.startBeat),
            });
            continue;
        }
        if (action.type === 'copyMidiArticulations') {
            const sourceTarget = context.tracks.flatMap((track) =>
                track.clips.filter((clip) => clip.id === action.payload.sourceClipId).map((clip) => ({ clip, track }))
            )[0];
            const targetTarget = context.tracks.flatMap((track) =>
                track.clips.filter((clip) => clip.id === action.payload.targetClipId).map((clip) => ({ clip, track }))
            )[0];
            if (
                !sourceTarget ||
                !targetTarget ||
                sourceTarget.track.id !== targetTarget.track.id ||
                sourceTarget.track.frozen === true ||
                sourceTarget.clip.type !== 'midi' ||
                targetTarget.clip.type !== 'midi' ||
                sourceTarget.clip.locked === true ||
                targetTarget.clip.locked === true
            ) {
                return { status: 'rejected', reason: 'MF-03 clip pair is unavailable or protected' };
            }
            const expectedSourceNotes = getNotesForClip(action.payload.sourceClipId).map((note) => ({ ...note }));
            const expectedTargetNotes = getNotesForClip(action.payload.targetClipId).map((note) => ({ ...note }));
            const projectedPairs = projectMidiArticulationTransfer({
                sourceNotes: expectedSourceNotes,
                targetNotes: expectedTargetNotes,
            });
            if (!projectedPairs) {
                return { status: 'rejected', reason: 'MF-03 note topology is incomplete or ambiguous' };
            }
            materialized.push({
                type: 'copyMidiArticulations',
                payload: {
                    trackId: sourceTarget.track.id,
                    sourceClipId: action.payload.sourceClipId,
                    targetClipId: action.payload.targetClipId,
                    notePairs: projectedPairs.map((pair) => ({
                        sourceNoteId: pair.sourceNoteId,
                        targetNoteId: pair.targetNoteId,
                    })),
                    expectedSourceNotes,
                    expectedTargetNotes,
                    expectedTrackFrozen: sourceTarget.track.frozen ?? false,
                    expectedSourceClipLocked: sourceTarget.clip.locked ?? false,
                    expectedTargetClipLocked: targetTarget.clip.locked ?? false,
                },
            });
            continue;
        }
        if (action.type === 'removeShortMidiOverlaps') {
            const scope = options.midiOverlapTransformScope;
            const entry = scope?.entries.find(
                (candidate) =>
                    candidate.clipId === action.payload.clipId &&
                    scope.maximumOverlapMs === action.payload.maximumOverlapMs
            );
            if (!scope || !entry) {
                return { status: 'rejected', reason: 'EX-04 selected MIDI overlap scope is unavailable' };
            }
            materialized.push({
                type: 'removeShortMidiOverlaps',
                payload: {
                    clipId: entry.clipId,
                    maximumOverlapMs: scope.maximumOverlapMs,
                    expectedTempo: scope.tempo,
                    expectedTrackId: entry.trackId,
                    trackName: entry.trackName,
                    expectedTrackFrozen: entry.expectedTrackFrozen,
                    clipName: entry.clipName,
                    expectedClipLocked: entry.expectedClipLocked,
                    expectedNotes: entry.expectedNotes.map((note) => ({ ...note })),
                },
            });
            continue;
        }
        if (action.type === 'arpeggiate') {
            const scope = options.syncopatedArpeggioScope;
            if (!scope || action.payload.clipId !== scope.clipId) {
                return { status: 'rejected', reason: 'EX-07 syncopated arpeggio scope is unavailable' };
            }
            const reservedNoteIds = new Set(scope.expectedNotes.map((note) => note.id));
            const addedNotes = scope.addedNotes.map((note) => {
                let id = `arp-${crypto.randomUUID()}`;
                while (reservedNoteIds.has(id)) {
                    id = `arp-${crypto.randomUUID()}`;
                }
                reservedNoteIds.add(id);
                return { id, ...note };
            });
            materialized.push({
                type: 'arpeggiate',
                payload: {
                    clipId: scope.clipId,
                    pattern: 'up',
                    rate: 8,
                    octaves: 1,
                    gate: 50,
                    expectedTrackId: scope.trackId,
                    trackName: scope.trackName,
                    expectedTrackFrozen: scope.expectedTrackFrozen,
                    clipName: scope.clipName,
                    expectedClipLocked: scope.expectedClipLocked,
                    expectedNotes: scope.expectedNotes.map((note) => ({ ...note })),
                    addedNotes,
                },
            });
            continue;
        }
        if (action.type === 'createDrumPreviewBranches') {
            const scope = options.drumPreviewBranchesScope;
            if (!scope || action.payload.sectionId !== scope.section.id) {
                return { status: 'rejected', reason: 'EX-05 drum preview branch scope is unavailable' };
            }
            const recipes = ['ghost-note-pocket', 'half-time-space', 'syncopated-hats'] as const;
            const candidates: Extract<
                AppAction,
                { type: 'createDrumPreviewBranches' }
            >['payload']['candidates'][number][] = [];
            for (const [index, recipe] of recipes.entries()) {
                const branchId = crypto.randomUUID();
                const snareNotes = projectDrumPreviewCandidateNotes({
                    branchId,
                    endBeat: scope.section.endBeat,
                    notes: scope.snare.expectedNotes,
                    recipe,
                    role: 'snare',
                    startBeat: scope.section.startBeat,
                });
                const hiHatNotes = projectDrumPreviewCandidateNotes({
                    branchId,
                    endBeat: scope.section.endBeat,
                    notes: scope.hiHat.expectedNotes,
                    recipe,
                    role: 'hi-hat',
                    startBeat: scope.section.startBeat,
                });
                if (!snareNotes || !hiHatNotes) {
                    return { status: 'rejected', reason: 'EX-05 drum candidate projection is unavailable' };
                }
                const names = ['Ghost-note Pocket', 'Half-time Space', 'Syncopated Hats'] as const;
                candidates.push({
                    branchId,
                    branchName: `Drum Candidate ${String(index + 1)} — ${names[index]!}`,
                    rootDocId: `branch_${branchId}`,
                    recipe,
                    snareNotes: snareNotes.map((note) => ({ ...note })),
                    hiHatNotes: hiHatNotes.map((note) => ({ ...note })),
                });
            }
            materialized.push({
                type: 'createDrumPreviewBranches',
                payload: {
                    ownerId: crypto.randomUUID(),
                    createdAt: Date.now(),
                    expectedSourceBranchId: scope.sourceBranchId,
                    expectedSourceHeads: [...scope.sourceHeads],
                    expectedDocuments: scope.expectedDocuments.map(({ docId, heads }) => ({
                        docId,
                        heads: [...heads],
                    })),
                    expectedBranchState: structuredClone(scope.expectedBranchState),
                    sectionId: scope.section.id,
                    sectionName: scope.section.name,
                    sectionStartBeat: scope.section.startBeat,
                    sectionEndBeat: scope.section.endBeat,
                    candidateCount: 3,
                    varyingRoles: ['snare', 'hi-hat'],
                    kick: { ...scope.kick, expectedNotes: scope.kick.expectedNotes.map((note) => ({ ...note })) },
                    snare: { ...scope.snare, expectedNotes: scope.snare.expectedNotes.map((note) => ({ ...note })) },
                    hiHat: { ...scope.hiHat, expectedNotes: scope.hiHat.expectedNotes.map((note) => ({ ...note })) },
                    candidates,
                },
            });
            continue;
        }
        if (action.type === 'setTrackGain') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'setTrackGain',
                payload: { ...action.payload, expectedGain: track.gain },
            });
            continue;
        }
        if (action.type === 'setTrackPan') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'setTrackPan',
                payload: { ...action.payload, expectedPan: track.pan },
            });
            continue;
        }
        if (action.type === 'muteTrack') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'muteTrack',
                payload: { ...action.payload, expectedMuted: track.muted },
            });
            continue;
        }
        if (action.type === 'addDevice') {
            const expectedFrozen = frozenByTrack.get(action.payload.trackId);
            if (expectedFrozen === undefined) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            if (expectedFrozen) {
                return { status: 'rejected', reason: `Track is frozen: ${action.payload.trackId}` };
            }
            const expectedDeviceIds = deviceIdsByTrack.get(action.payload.trackId);
            if (!expectedDeviceIds) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            let deviceId = action.payload.deviceId;
            if (deviceId) {
                if (reservedDeviceIds.has(deviceId)) {
                    return { status: 'rejected', reason: `Device identity is already in use: ${deviceId}` };
                }
            } else {
                const baseDeviceId = `device-ai-${action.payload.trackId}-${action.payload.deviceType}`;
                deviceId = baseDeviceId;
                let suffix = 2;
                while (reservedDeviceIds.has(deviceId)) {
                    deviceId = `${baseDeviceId}-${String(suffix)}`;
                    suffix += 1;
                }
            }
            reservedDeviceIds.add(deviceId);
            const nextDeviceIds = [...expectedDeviceIds];
            let insertionIndex = nextDeviceIds.length;
            if (action.payload.afterDeviceId) {
                const anchorIndex = nextDeviceIds.indexOf(action.payload.afterDeviceId);
                if (anchorIndex < 0) {
                    return {
                        status: 'rejected',
                        reason: `Device is unavailable: ${action.payload.afterDeviceId}`,
                    };
                }
                insertionIndex = anchorIndex + 1;
            }
            nextDeviceIds.splice(insertionIndex, 0, deviceId);
            deviceIdsByTrack.set(action.payload.trackId, nextDeviceIds);
            const projectedTrack = tracksById.get(action.payload.trackId);
            if (!projectedTrack) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            const projectedDevices = [...projectedTrack.devices];
            projectedDevices.splice(insertionIndex, 0, {
                id: deviceId,
                type: action.payload.deviceType,
                bypassed: false,
                parameters: [],
            });
            tracksById.set(action.payload.trackId, {
                ...projectedTrack,
                deviceCount: projectedDevices.length,
                devices: projectedDevices,
            });
            materialized.push({
                type: 'addDevice',
                payload: {
                    ...action.payload,
                    deviceId,
                    expectedDeviceIds,
                    expectedFrozen,
                },
            });
            continue;
        }
        if (action.type === 'createBus' && action.payload.busId) {
            if (tracksById.has(action.payload.busId)) {
                return { status: 'rejected', reason: `Bus identity is already in use: ${action.payload.busId}` };
            }
            tracksById.set(action.payload.busId, createProjectedBus(action.payload.busId, action.payload.name));
            deviceIdsByTrack.set(action.payload.busId, []);
            frozenByTrack.set(action.payload.busId, false);
            materialized.push(action);
            continue;
        }
        if (action.type === 'addSend') {
            const sourceTrack = tracksById.get(action.payload.trackId);
            const destinationBus = tracksById.get(action.payload.busId);
            if (!sourceTrack || destinationBus?.kind !== 'bus') {
                return {
                    status: 'rejected',
                    reason: `Send endpoints are unavailable: ${action.payload.trackId} -> ${action.payload.busId}`,
                };
            }
            if (sourceTrack.sends?.some((send) => send.busId === action.payload.busId)) {
                return {
                    status: 'rejected',
                    reason: `Send already exists: ${action.payload.trackId} -> ${action.payload.busId}`,
                };
            }
            const projectedSends = [
                ...(sourceTrack.sends ?? []),
                {
                    busId: action.payload.busId,
                    level: action.payload.level,
                    preFader: action.payload.preFader ?? false,
                },
            ];
            tracksById.set(action.payload.trackId, { ...sourceTrack, sends: projectedSends });
            materialized.push(action);
            continue;
        }
        if (action.type === 'automateSendRange') {
            const bus = tracksById.get(action.payload.busId);
            if (!bus || bus.kind !== 'bus') {
                return { status: 'rejected', reason: `Bus is unavailable: ${action.payload.busId}` };
            }
            const section = (context.sections ?? []).find(
                (candidate) => candidate.name.toLocaleLowerCase() === action.payload.sectionName.toLocaleLowerCase()
            );
            if (!section) {
                return { status: 'rejected', reason: `Section is unavailable: ${action.payload.sectionName}` };
            }
            const expectedSends = [];
            for (const trackId of action.payload.trackIds) {
                const track = tracksById.get(trackId);
                const send = track?.sends?.find((candidate) => candidate.busId === action.payload.busId);
                if (!track || !send) {
                    return {
                        status: 'rejected',
                        reason: `Send is unavailable: ${trackId} -> ${action.payload.busId}`,
                    };
                }
                expectedSends.push({ trackId, level: send.level, preFader: send.preFader });
            }
            materialized.push({
                type: 'automateSendRange',
                payload: {
                    ...action.payload,
                    busName: bus.name,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    expectedSends,
                    expectedSection: {
                        name: section.name,
                        startBeat: section.startBeat,
                        endBeat: section.endBeat,
                    },
                },
            });
            continue;
        }
        if (action.type === 'automateTrackGainRange') {
            const section = (context.sections ?? []).find(
                (candidate) => candidate.name.toLocaleLowerCase() === action.payload.sectionName.toLocaleLowerCase()
            );
            if (!section) {
                return { status: 'rejected', reason: `Section is unavailable: ${action.payload.sectionName}` };
            }
            const expectedTracks = [];
            for (const trackId of action.payload.trackIds) {
                const track = tracksById.get(trackId);
                if (!track || track.kind !== 'bus') {
                    return { status: 'rejected', reason: `Impact bus is unavailable: ${trackId}` };
                }
                if (
                    track.frozen === true ||
                    track.automationMode === 'off' ||
                    !Number.isFinite(track.gain) ||
                    track.gain <= 0 ||
                    // The fader's own ceiling, matching what
                    // `handleAutomateTrackGainRange` admits. Bounding at unity
                    // rejects a lift the fader itself can reach by hand.
                    track.gain * 10 ** (action.payload.gainDb / 20) > FADER_MAX_GAIN ||
                    (context.automationLanes ?? []).some(
                        (lane) =>
                            lane.id === `auto-gain-${encodeURIComponent(trackId)}` ||
                            (!lane.clipId && lane.trackId === trackId && lane.parameterId === 'gain')
                    )
                ) {
                    return { status: 'rejected', reason: `Impact bus cannot accept gain automation: ${trackId}` };
                }
                expectedTracks.push({
                    trackId,
                    trackName: track.name,
                    gain: track.gain,
                    automationMode: track.automationMode,
                    frozen: track.frozen ?? false,
                });
            }
            materialized.push({
                type: 'automateTrackGainRange',
                payload: {
                    ...action.payload,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    expectedTracks,
                    expectedSection: {
                        name: section.name,
                        startBeat: section.startBeat,
                        endBeat: section.endBeat,
                    },
                },
            });
            continue;
        }
        if (action.type === 'automateSendRanges') {
            const bus = tracksById.get(action.payload.busId);
            if (!bus || bus.kind !== 'bus') {
                return { status: 'rejected', reason: `Bus is unavailable: ${action.payload.busId}` };
            }
            const [numerator, denominator] = context.timeSignature;
            const beatsPerBar = numerator * (4 / denominator);
            const automationLengthBeats = beatsPerBar * action.payload.tailBars;
            if (!Number.isFinite(automationLengthBeats) || automationLengthBeats <= 0) {
                return { status: 'rejected', reason: 'Send automation requires a finite positive time signature' };
            }
            const sectionsById = new Map((context.sections ?? []).map((section) => [section.id, section]));
            const ranges = [];
            for (const sectionId of action.payload.sectionIds) {
                const section = sectionsById.get(sectionId);
                if (!section || section.endBeat - section.startBeat < automationLengthBeats) {
                    return { status: 'rejected', reason: `Section cannot accept send automation: ${sectionId}` };
                }
                ranges.push({
                    sectionId,
                    sectionName: section.name,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    automationStartBeat: section.endBeat - automationLengthBeats,
                });
            }
            const expectedTracks = [];
            for (const trackId of action.payload.trackIds) {
                const track = tracksById.get(trackId);
                const send = track?.sends?.find((candidate) => candidate.busId === action.payload.busId);
                const laneId = `auto-send-${encodeURIComponent(trackId)}-${encodeURIComponent(action.payload.busId)}`;
                if (
                    !track ||
                    track.frozen === true ||
                    track.automationMode === 'off' ||
                    !send ||
                    send.preFader ||
                    !Number.isFinite(send.level) ||
                    (context.automationLanes ?? []).some(
                        (lane) =>
                            lane.id === laneId ||
                            (!lane.clipId &&
                                lane.trackId === trackId &&
                                lane.parameterId === `send:${action.payload.busId}`)
                    )
                ) {
                    return { status: 'rejected', reason: `Track cannot accept send automation: ${trackId}` };
                }
                expectedTracks.push({
                    trackId,
                    trackName: track.name,
                    frozen: track.frozen ?? false,
                    automationMode: track.automationMode,
                    sendLevel: send.level,
                    sendPreFader: send.preFader,
                });
            }
            materialized.push({
                type: 'automateSendRanges',
                payload: {
                    ...action.payload,
                    busName: bus.name,
                    expectedTimeSignature: [numerator, denominator],
                    ranges,
                    expectedTracks,
                },
            });
            continue;
        }
        if (action.type === 'renderProjectSections') {
            const tailSeconds = options.appOwnedRenderTailSeconds;
            if (tailSeconds === undefined || !Number.isFinite(tailSeconds) || tailSeconds < 0) {
                return { status: 'rejected', reason: 'Section render tail was not materialized by the application' };
            }
            const sectionsById = new Map((context.sections ?? []).map((section) => [section.id, section]));
            const jobs = [];
            for (const sectionId of action.payload.sectionIds) {
                const section = sectionsById.get(sectionId);
                if (!section || !Number.isFinite(section.startBeat) || section.endBeat <= section.startBeat) {
                    return { status: 'rejected', reason: `Section cannot be rendered: ${sectionId}` };
                }
                jobs.push({
                    jobId: `render-job-ai-${crypto.randomUUID()}`,
                    sectionId,
                    sectionName: section.name,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    sampleRate: 44_100,
                    tailSeconds,
                });
            }
            materialized.push({ type: 'renderProjectSections', payload: { ...action.payload, jobs } });
            continue;
        }
        if (action.type === 'importStemSet') {
            return { status: 'rejected', reason: 'Stem imports require application-owned file materialization' };
        }
        materialized.push(action);
    }

    return { status: 'accepted', actions: materialized };
}
