import { isChordTrackState, isGrooveTemplateState } from '#/modules/MIDI/stores';

import { isProductionBrief } from '../../../models/ProductionBrief';
import {
    isCanonicalProjectId,
    isSupportedProjectVersion,
    type ProjectAdjustmentLayers,
    type ProjectArrangementSnapshot,
    type ProjectAutomation,
    type ProjectClip,
    type ProjectChordTrackState,
    type ProjectExportedAudioBuffer,
    type ProjectGrooveState,
    type ProjectMeta,
    type ProjectMarker,
    type ProjectMidi,
    type ProjectSidechainRoute,
    type ProjectTakeLaneStoreState,
    type ProjectTempoMap,
    type ProjectTimeSignatureMap,
    type ProjectTrack,
    type ProjectTrackAlternative,
    type ProjectTransport,
    type ProjectYeastState,
} from '../../../models/ProjectData';

export type HydratableProjectTrack = Pick<ProjectTrack, 'id' | 'name' | 'kind' | 'clips'> &
    Partial<Omit<ProjectTrack, 'id' | 'name' | 'kind' | 'clips' | 'alternatives'>> & {
        alternatives?: ProjectTrackAlternative[];
    };

export type HydratableArrangementSnapshot = Pick<ProjectArrangementSnapshot, 'id' | 'name'> & {
    tracks?: {
        tracks: HydratableProjectTrack[];
        selectedTrackId: string | null;
    };
    automation?: ProjectAutomation;
    midi?: ProjectMidi;
    tempoMap?: ProjectArrangementSnapshot['tempoMap'];
    timeSignatureMap?: ProjectArrangementSnapshot['timeSignatureMap'];
    markers?: ProjectArrangementSnapshot['markers'];
    takeLanes?: ProjectArrangementSnapshot['takeLanes'];
};

export type HydratableProjectData = {
    version: number;
    meta: ProjectMeta;
    arrangement: { tracks: HydratableProjectTrack[] };
    transport?: ProjectTransport;
    automation?: ProjectAutomation;
    midi?: ProjectMidi;
    chordTrack?: ProjectChordTrackState;
    grooves?: ProjectGrooveState;
    yeast?: ProjectYeastState;
    markers?: ProjectMarker[];
    tempoMap?: ProjectTempoMap;
    timeSignatureMap?: ProjectTimeSignatureMap;
    takeLanes?: ProjectTakeLaneStoreState;
    sidechainRoutes?: ProjectSidechainRoute[];
    arrangements?: HydratableArrangementSnapshot[];
    activeArrangementId?: string;
    audioBuffers?: Record<string, ProjectExportedAudioBuffer>;
    adjustmentLayers?: ProjectAdjustmentLayers;
    mixer?: unknown;
    /**
     * Mix state whose decoding belongs to the module that owns it. Left as
     * `unknown` deliberately: each owner's hydrator runs the same sanitizer its
     * CRDT slot uses and degrades a bad row to that module's default, whereas
     * validating here would make one unreadable modulator reject the entire
     * project file (`isHydratableProjectData` is all-or-nothing).
     */
    vcaGroups?: unknown;
    gainEnvelopes?: unknown;
    modulation?: unknown;
    cvGate?: unknown;
    history?: unknown;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyNumbers(values: unknown): boolean {
    return Array.isArray(values) && values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

const PROJECT_YEAST_PROCESSOR_TYPES = new Set([
    'arpeggiator',
    'chord',
    'chordMemory',
    'scale',
    'harmonizer',
    'repeater',
    'velocity',
    'humanizer',
    'filter',
    'transposer',
    'groove',
    'ccGenerator',
    'euclidean',
    'markov',
    'mutation',
]);

function isYeastState(value: unknown): value is ProjectYeastState {
    if (
        !isRecord(value) ||
        Object.keys(value).some((key) => key !== 'processors') ||
        !Array.isArray(value.processors)
    ) {
        return false;
    }
    const ids = new Set<string>();
    return value.processors.every((processor) => {
        if (
            !isRecord(processor) ||
            Object.keys(processor).some(
                (key) => key !== 'id' && key !== 'type' && key !== 'name' && key !== 'bypassed' && key !== 'params'
            ) ||
            typeof processor.id !== 'string' ||
            processor.id.normalize('NFKC').trim() !== processor.id ||
            ids.has(processor.id) ||
            typeof processor.type !== 'string' ||
            !PROJECT_YEAST_PROCESSOR_TYPES.has(processor.type) ||
            typeof processor.name !== 'string' ||
            processor.name.trim().length === 0 ||
            typeof processor.bypassed !== 'boolean' ||
            (processor.params !== undefined &&
                (!isRecord(processor.params) ||
                    !Object.values(processor.params).every(
                        (parameter) => typeof parameter === 'number' && Number.isFinite(parameter)
                    )))
        ) {
            return false;
        }
        ids.add(processor.id);
        return true;
    });
}

function hasOptionalType({
    record,
    keys,
    type,
}: {
    record: UnknownRecord;
    keys: readonly string[];
    type: 'boolean' | 'number' | 'string';
}): boolean {
    return keys.every(
        (key) =>
            record[key] === undefined ||
            (typeof record[key] === type && (type !== 'number' || Number.isFinite(record[key])))
    );
}

function hasType({
    record,
    keys,
    type,
}: {
    record: UnknownRecord;
    keys: readonly string[];
    type: 'boolean' | 'number' | 'string';
}): boolean {
    return keys.every((key) => typeof record[key] === type && (type !== 'number' || Number.isFinite(record[key])));
}

function hasOptionalNullableStrings(record: UnknownRecord, keys: readonly string[]): boolean {
    return keys.every((key) => record[key] === undefined || record[key] === null || typeof record[key] === 'string');
}

function hasOptionalEnum(record: UnknownRecord, key: string, values: readonly string[]): boolean {
    return record[key] === undefined || (typeof record[key] === 'string' && values.includes(record[key]));
}

function isNumberRecord(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isMeta(value: unknown): value is ProjectMeta {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        typeof value.createdAt === 'number' &&
        Number.isFinite(value.createdAt) &&
        typeof value.updatedAt === 'number' &&
        Number.isFinite(value.updatedAt) &&
        typeof value.keyRoot === 'number' &&
        Number.isFinite(value.keyRoot) &&
        typeof value.scaleName === 'string' &&
        isRecord(value.tuning) &&
        typeof value.tuning.name === 'string' &&
        hasOnlyNumbers(value.tuning.frequencies) &&
        (value.productionBrief === undefined || isProductionBrief(value.productionBrief))
    );
}

function isTransport(value: unknown): value is ProjectTransport {
    if (!isRecord(value)) {
        return false;
    }
    return (
        hasType({
            record: value,
            keys: [
                'tempo',
                'timeSignatureNumerator',
                'timeSignatureDenominator',
                'loopStart',
                'loopEnd',
                'metronomeVolume',
                'punchInBeat',
                'punchOutBeat',
                'countInBars',
                'preRollBars',
                'masterGain',
            ],
            type: 'number',
        }) &&
        hasType({
            record: value,
            keys: ['isLooping', 'metronomeEnabled', 'punchInEnabled', 'countInEnabled', 'preRollEnabled'],
            type: 'boolean',
        })
    );
}

function isMidiNote(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        hasType({
            record: value,
            keys: ['pitch', 'startBeat', 'duration', 'velocity'],
            type: 'number',
        }) &&
        hasOptionalType({
            record: value,
            keys: ['probability', 'pressure', 'slide', 'pitchBend'],
            type: 'number',
        })
    );
}

function isKneadState(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.blobs) &&
        value.blobs.every(
            (blob) =>
                isRecord(blob) &&
                typeof blob.id === 'string' &&
                hasType({
                    record: blob,
                    keys: ['startTime', 'endTime', 'pitchCenterCents', 'voicedConfidence'],
                    type: 'number',
                }) &&
                hasOnlyNumbers(blob.pitchCurveCents) &&
                hasOptionalType({ record: blob, keys: ['originalPitchCenterCents'], type: 'number' })
        ) &&
        hasType({ record: value, keys: ['retuneSpeedMs', 'humanizePercent'], type: 'number' }) &&
        typeof value.formantPreserve === 'boolean'
    );
}

/**
 * `deviceState` is deliberately not validated here, for the same reason
 * `externalStateChunk` is not: a failure in this predicate does not drop a field or a
 * device, it makes `isHydratableProjectData` reject the **entire project file**
 * (`isTrack` → `return false` → `applyImportedProjectData` abandons the import).
 *
 * A device-state chunk is opaque to this layer and written by whichever module owns
 * the device, so a version this build has never seen is an ordinary, expected value —
 * not a corrupt file. Checking it here would let one unrecognised chunk make a
 * project unopenable. The chunk is validated where a failure costs only the chunk:
 * `normalize_device_state` in the track projection, which every import path runs
 * through afterwards, and which degrades a malformed chunk to the module default.
 */
function isDevice(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['id', 'name', 'type'], type: 'string' }) &&
        typeof value.bypassed === 'boolean' &&
        isNumberRecord(value.parameterValues) &&
        hasOptionalType({ record: value, keys: ['externalPluginId', 'externalInstanceId'], type: 'string' })
    );
}

function isSend(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.busId === 'string' &&
        typeof value.level === 'number' &&
        Number.isFinite(value.level) &&
        typeof value.preFader === 'boolean'
    );
}

function isMidiFx(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['id', 'name'], type: 'string' }) &&
        ['arp', 'velocity', 'probability'].includes(String(value.type)) &&
        typeof value.bypassed === 'boolean' &&
        isNumberRecord(value.parameterValues)
    );
}

function isFreezeState(value: unknown): boolean {
    if (
        !isRecord(value) ||
        !['unfrozen', 'freezing', 'frozen', 'stale', 'error'].includes(String(value.status)) ||
        !hasOptionalType({
            record: value,
            keys: [
                'freezeId',
                'frozenBufferId',
                'frozenAudioHash',
                'sourceContentHash',
                'deviceChainHash',
                'errorMessage',
            ],
            type: 'string',
        }) ||
        !hasOptionalType({
            record: value,
            keys: ['renderProgress', 'renderedAt', 'compensationSeconds'],
            type: 'number',
        })
    ) {
        return false;
    }
    if (value.renderSettings === undefined) {
        return true;
    }
    return (
        isRecord(value.renderSettings) &&
        hasType({
            record: value.renderSettings,
            keys: ['sampleRate', 'bitDepth', 'channelCount', 'tailLengthSeconds'],
            type: 'number',
        }) &&
        // Optional: absent means the buffer predates the field, which is the
        // documented meaning of version 0. Validating it keeps a hand-edited or
        // foreign `.sdaw` from smuggling a non-numeric version past hydration.
        hasOptionalType({ record: value.renderSettings, keys: ['bakeVersion'], type: 'number' })
    );
}

function isClip(value: unknown): value is ProjectClip {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.id === 'string' &&
        typeof value.trackId === 'string' &&
        typeof value.name === 'string' &&
        (value.type === 'audio' || value.type === 'midi') &&
        hasType({
            record: value,
            keys: ['startBeat', 'endBeat', 'fadeInBeats', 'fadeOutBeats', 'gain'],
            type: 'number',
        }) &&
        hasType({ record: value, keys: ['locked', 'muted'], type: 'boolean' }) &&
        typeof value.color === 'string' &&
        hasOptionalType({
            record: value,
            keys: [
                'sampleStartBeat',
                'audioOffsetBeats',
                'midiOffsetBeats',
                'stretchRatio',
                'loopLength',
                'sourceKeyRoot',
            ],
            type: 'number',
        }) &&
        hasOptionalType({
            record: value,
            keys: ['loopEnabled', 'generating', 'isGhost', 'isInlineEditing', 'isLinkedInstance'],
            type: 'boolean',
        }) &&
        hasOptionalType({
            record: value,
            keys: ['bufferId', 'audioBufferId', 'assetHash', 'parentClipId', 'sourceScaleName'],
            type: 'string',
        }) &&
        hasOptionalEnum(value, 'stretchMode', ['off', 'repitch', 'timestretch']) &&
        hasOptionalEnum(value, 'followAction', [
            'stop',
            'play_next',
            'play_previous',
            'play_random',
            'play_first',
            'play_last',
        ]) &&
        (value.notes === undefined || (Array.isArray(value.notes) && value.notes.every(isMidiNote))) &&
        (value.overrides === undefined ||
            (isRecord(value.overrides) && Object.values(value.overrides).every((item) => typeof item === 'boolean'))) &&
        (value.kneadState === undefined || isKneadState(value.kneadState))
    );
}

function isTrack(value: unknown): value is HydratableProjectTrack {
    if (!isRecord(value) || !Array.isArray(value.clips)) {
        return false;
    }
    if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        !['audio', 'midi', 'bus', 'master', 'folder'].includes(String(value.kind))
    ) {
        return false;
    }
    if (!value.clips.every(isClip)) {
        return false;
    }
    if (
        value.alternatives !== undefined &&
        (!Array.isArray(value.alternatives) ||
            !value.alternatives.every(
                (alternative) =>
                    isRecord(alternative) &&
                    typeof alternative.id === 'string' &&
                    typeof alternative.name === 'string' &&
                    Array.isArray(alternative.clips) &&
                    alternative.clips.every(isClip)
            ))
    ) {
        return false;
    }
    if (value.freezeState !== undefined && !isFreezeState(value.freezeState)) {
        return false;
    }
    if (value.midiFx !== undefined && (!Array.isArray(value.midiFx) || !value.midiFx.every(isMidiFx))) {
        return false;
    }
    if (
        (value.devices !== undefined && (!Array.isArray(value.devices) || !value.devices.every(isDevice))) ||
        (value.sends !== undefined && (!Array.isArray(value.sends) || !value.sends.every(isSend)))
    ) {
        return false;
    }
    return (
        hasOptionalType({
            record: value,
            keys: ['gain', 'pan', 'height'],
            type: 'number',
        }) &&
        hasOptionalType({
            record: value,
            keys: [
                'muted',
                'soloed',
                'armed',
                'frozen',
                'collapsed',
                'hidden',
                'disabled',
                'soloSafe',
                'followChordTrack',
                'showVariationLanes',
            ],
            type: 'boolean',
        }) &&
        hasOptionalType({
            record: value,
            keys: ['color', 'frozenBufferId', 'outputId', 'notes', 'activeAlternativeId'],
            type: 'string',
        }) &&
        hasOptionalEnum(value, 'inputMonitoring', ['auto', 'on', 'off']) &&
        hasOptionalEnum(value, 'automationMode', ['read', 'write', 'latch', 'touch', 'off']) &&
        hasOptionalNullableStrings(value, ['parentId', 'groupId', 'inputId', 'vcaGroupId', 'midiOutputTrackId'])
    );
}

function isTracks(value: unknown): value is HydratableProjectTrack[] {
    return Array.isArray(value) && value.every(isTrack);
}

function isMidiCc(value: unknown): boolean {
    return (
        isRecord(value) && hasType({ record: value, keys: ['beat', 'controller', 'value', 'channel'], type: 'number' })
    );
}

function isMidiPitchBend(value: unknown): boolean {
    return isRecord(value) && hasType({ record: value, keys: ['beat', 'value', 'channel'], type: 'number' });
}

function isArrayRecordOf(value: unknown, predicate: (item: unknown) => boolean): boolean {
    return isRecord(value) && Object.values(value).every((items) => Array.isArray(items) && items.every(predicate));
}

function isMidi(value: unknown): value is ProjectMidi {
    return (
        isRecord(value) &&
        (value.probabilitySeed === undefined ||
            (typeof value.probabilitySeed === 'number' &&
                Number.isInteger(value.probabilitySeed) &&
                value.probabilitySeed >= 0 &&
                value.probabilitySeed <= 0xffff_ffff)) &&
        isArrayRecordOf(value.notesByClipId, isMidiNote) &&
        isArrayRecordOf(value.ccByClipId, isMidiCc) &&
        isArrayRecordOf(value.pitchBendByClipId, isMidiPitchBend)
    );
}

function isGrooves(value: unknown): value is ProjectGrooveState {
    return isGrooveTemplateState(value);
}

function isMarker(value: unknown): value is ProjectMarker {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.beat === 'number' &&
        Number.isFinite(value.beat) &&
        typeof value.name === 'string' &&
        typeof value.color === 'string'
    );
}

function isAutomationPoint(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['beat', 'value', 'tension'], type: 'number' }) &&
        ['linear', 'exponential', 'step', 's-curve', 'stairs', 'smooth', 'bezier'].includes(String(value.curve))
    );
}

function isAutomationObject(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['id', 'laneId', 'name'], type: 'string' }) &&
        hasType({ record: value, keys: ['startBeat', 'endBeat'], type: 'number' }) &&
        Array.isArray(value.points) &&
        value.points.every(isAutomationPoint)
    );
}

function isAutomation(value: unknown): value is ProjectAutomation {
    return (
        isRecord(value) &&
        Array.isArray(value.lanes) &&
        value.lanes.every(
            (lane) =>
                isRecord(lane) &&
                Array.isArray(lane.points) &&
                lane.points.every(isAutomationPoint) &&
                Array.isArray(lane.objects) &&
                lane.objects.every(isAutomationObject) &&
                hasType({ record: lane, keys: ['id', 'trackId', 'parameterId', 'parameterName'], type: 'string' }) &&
                // `virginTerritory` was removed from the lane model. It used to be a
                // *required* boolean here, so dropping it from this list is what keeps
                // older files loadable: a file written before the removal still
                // carries the key, and an unlisted extra key is ignored rather
                // than rejected.
                //
                // No schema version bump, because relaxing a required key to
                // "ignored" is backward-compatible on its own — every file this
                // build can read, it could read before. (A bump would not have
                // broken old files either: `isSupportedProjectVersion` accepts
                // the inclusive range [MIN_SUPPORTED, CURRENT], so raising
                // CURRENT to 2 while MIN stays 1 keeps version-1 files loadable.
                // The bump is simply unnecessary here, not unsafe.)
                hasType({
                    record: lane,
                    keys: ['visible', 'enabled', 'collapsed'],
                    type: 'boolean',
                }) &&
                hasType({ record: lane, keys: ['minValue', 'maxValue'], type: 'number' }) &&
                hasOptionalType({ record: lane, keys: ['color'], type: 'string' })
        )
    );
}

function isTempoChange(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        hasType({ record: value, keys: ['beat', 'tempo'], type: 'number' }) &&
        ['instant', 'linear'].includes(String(value.curve))
    );
}

function isProjectTempoMap(value: unknown): value is ProjectTempoMap {
    return (
        isRecord(value) &&
        Array.isArray(value.changes) &&
        value.changes.every(
            (change) =>
                isRecord(change) &&
                hasType({ record: change, keys: ['beat', 'tempo'], type: 'number' }) &&
                hasOptionalType({ record: change, keys: ['id'], type: 'string' }) &&
                hasOptionalEnum(change, 'curve', ['instant', 'linear'])
        )
    );
}

function isTimeSignatureChange(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        hasType({ record: value, keys: ['beat', 'numerator', 'denominator'], type: 'number' })
    );
}

function isProjectTimeSignatureMap(value: unknown): value is ProjectTimeSignatureMap {
    return (
        isRecord(value) &&
        Array.isArray(value.changes) &&
        value.changes.every(
            (change) =>
                isRecord(change) &&
                hasType({ record: change, keys: ['beat', 'numerator', 'denominator'], type: 'number' }) &&
                hasOptionalType({ record: change, keys: ['id'], type: 'string' })
        )
    );
}

function isSection(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['id', 'name', 'color'], type: 'string' }) &&
        hasType({ record: value, keys: ['startBeat', 'endBeat'], type: 'number' })
    );
}

function isTake(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['id', 'clipId', 'name'], type: 'string' }) &&
        hasType({ record: value, keys: ['startBeat', 'endBeat'], type: 'number' }) &&
        typeof value.selected === 'boolean'
    );
}

function isCompRegion(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.takeId === 'string' &&
        hasType({ record: value, keys: ['startBeat', 'endBeat'], type: 'number' })
    );
}

function isTakeLane(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['id', 'trackId'], type: 'string' }) &&
        hasOptionalType({ record: value, keys: ['automationLaneId'], type: 'string' }) &&
        Array.isArray(value.takes) &&
        value.takes.every(isTake) &&
        Array.isArray(value.activeCompRegions) &&
        value.activeCompRegions.every(isCompRegion)
    );
}

function isTakeLaneStore(value: unknown): value is ProjectTakeLaneStoreState {
    return isRecord(value) && Array.isArray(value.lanes) && value.lanes.every(isTakeLane);
}

function isSidechainRoute(value: unknown): value is ProjectSidechainRoute {
    return (
        isRecord(value) &&
        hasType({
            record: value,
            keys: ['id', 'sourceTrackId', 'targetTrackId', 'targetDeviceId', 'targetParameterId'],
            type: 'string',
        }) &&
        typeof value.gain === 'number' &&
        Number.isFinite(value.gain)
    );
}

function isArrangementSnapshot(value: unknown): value is HydratableArrangementSnapshot {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
        return false;
    }
    if (
        value.tracks !== undefined &&
        (!isRecord(value.tracks) ||
            !isTracks(value.tracks.tracks) ||
            (value.tracks.selectedTrackId !== null && typeof value.tracks.selectedTrackId !== 'string'))
    ) {
        return false;
    }
    return (
        (value.midi === undefined || isMidi(value.midi)) &&
        (value.automation === undefined || isAutomation(value.automation)) &&
        (value.tempoMap === undefined ||
            (isRecord(value.tempoMap) &&
                Array.isArray(value.tempoMap.changes) &&
                value.tempoMap.changes.every(isTempoChange))) &&
        (value.timeSignatureMap === undefined ||
            (isRecord(value.timeSignatureMap) &&
                Array.isArray(value.timeSignatureMap.changes) &&
                value.timeSignatureMap.changes.every(isTimeSignatureChange))) &&
        (value.markers === undefined ||
            (isRecord(value.markers) &&
                Array.isArray(value.markers.markers) &&
                value.markers.markers.every(isMarker) &&
                Array.isArray(value.markers.sections) &&
                value.markers.sections.every(isSection))) &&
        (value.takeLanes === undefined ||
            (isRecord(value.takeLanes) &&
                Array.isArray(value.takeLanes.lanes) &&
                value.takeLanes.lanes.every(isTakeLane)))
    );
}

function isAdjustmentParameter(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasType({ record: value, keys: ['name', 'unit'], type: 'string' }) &&
        hasType({ record: value, keys: ['value', 'min', 'max'], type: 'number' })
    );
}

function isAdjustmentRegion(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        hasType({
            record: value,
            keys: ['startBeat', 'endBeat', 'blend', 'fadeInBeats', 'fadeOutBeats'],
            type: 'number',
        })
    );
}

function isAdjustmentLayers(value: unknown): value is ProjectAdjustmentLayers {
    return (
        isRecord(value) &&
        Array.isArray(value.layers) &&
        value.layers.every(
            (layer) =>
                isRecord(layer) &&
                Array.isArray(layer.parameters) &&
                layer.parameters.every(isAdjustmentParameter) &&
                Array.isArray(layer.affectedTrackIds) &&
                layer.affectedTrackIds.every((trackId) => typeof trackId === 'string') &&
                Array.isArray(layer.regions) &&
                layer.regions.every(isAdjustmentRegion) &&
                hasType({ record: layer, keys: ['id', 'name', 'color'], type: 'string' }) &&
                [
                    'eq',
                    'compressor',
                    'reverb',
                    'delay',
                    'saturation',
                    'filter',
                    'stereo-width',
                    'volume',
                    'pan',
                ].includes(String(layer.effectType)) &&
                hasType({ record: layer, keys: ['insertionIndex', 'mix'], type: 'number' }) &&
                typeof layer.enabled === 'boolean'
        )
    );
}

type AudioBufferReferenceCensus = {
    frozenIds: Set<string>;
    ordinaryIds: Set<string>;
};

const PROJECT_SCOPED_FREEZE_ID = /^freeze-project-(\d+)-/;

function hasForeignEncodedFreezeProjectId(bufferId: string, projectId: number): boolean {
    const match = PROJECT_SCOPED_FREEZE_ID.exec(bufferId);
    if (!match) {
        return false;
    }
    const encodedProjectId = Number(match[1]);
    return !Number.isSafeInteger(encodedProjectId) || encodedProjectId !== projectId;
}

function addTrackBufferReferences(census: AudioBufferReferenceCensus, tracks: readonly HydratableProjectTrack[]): void {
    for (const track of tracks) {
        const frozenBufferId = track.freezeState?.frozenBufferId ?? track.frozenBufferId;
        if (frozenBufferId) {
            census.frozenIds.add(frozenBufferId);
        }
        for (const clip of [
            ...track.clips,
            ...(track.alternatives ?? []).flatMap((alternative) => alternative.clips),
        ]) {
            const bufferId = clip.bufferId ?? clip.audioBufferId;
            if (bufferId) {
                census.ordinaryIds.add(bufferId);
            }
        }
    }
}

function collectAudioBufferReferences({
    arrangements,
    tracks,
}: {
    arrangements?: HydratableArrangementSnapshot[];
    tracks: HydratableProjectTrack[];
}): AudioBufferReferenceCensus {
    const census: AudioBufferReferenceCensus = { frozenIds: new Set(), ordinaryIds: new Set() };
    addTrackBufferReferences(census, tracks);
    for (const arrangement of arrangements ?? []) {
        addTrackBufferReferences(census, arrangement.tracks?.tracks ?? []);
    }
    return census;
}

function isAudioBuffers(
    value: unknown,
    projectId: number,
    references: AudioBufferReferenceCensus
): value is Record<string, ProjectExportedAudioBuffer> {
    return (
        isRecord(value) &&
        Object.entries(value).every(
            ([bufferId, buffer]) =>
                isRecord(buffer) &&
                typeof buffer.sampleRate === 'number' &&
                Number.isFinite(buffer.sampleRate) &&
                buffer.sampleRate > 0 &&
                typeof buffer.numberOfChannels === 'number' &&
                Number.isInteger(buffer.numberOfChannels) &&
                buffer.numberOfChannels > 0 &&
                Array.isArray(buffer.channelData) &&
                buffer.channelData.length === buffer.numberOfChannels &&
                buffer.channelData.every((channel) => typeof channel === 'string') &&
                (buffer.freezeProjectId === undefined ||
                    (buffer.freezeProjectId === projectId &&
                        references.frozenIds.has(bufferId) &&
                        !references.ordinaryIds.has(bufferId) &&
                        !hasForeignEncodedFreezeProjectId(bufferId, projectId)))
        )
    );
}

function isCanonicalChordTrackState(value: unknown): boolean {
    if (!isChordTrackState(value)) {
        return false;
    }

    let previousBeat = Number.NEGATIVE_INFINITY;
    for (const event of value.events) {
        if (event.beat < previousBeat) {
            return false;
        }
        previousBeat = event.beat;
    }
    return true;
}

export function isHydratableProjectData(value: unknown): value is HydratableProjectData {
    if (!isRecord(value) || !Number.isInteger(value.version) || !isSupportedProjectVersion(value.version)) {
        return false;
    }
    if (!isMeta(value.meta) || !isRecord(value.arrangement) || !isTracks(value.arrangement.tracks)) {
        return false;
    }
    if (value.version >= 2 && !isCanonicalProjectId(value.meta.projectId)) {
        return false;
    }
    if (value.transport !== undefined && !isTransport(value.transport)) {
        return false;
    }
    if (value.midi !== undefined && !isMidi(value.midi)) {
        return false;
    }
    if (value.chordTrack !== undefined && !isCanonicalChordTrackState(value.chordTrack)) {
        return false;
    }
    if (value.grooves !== undefined && !isGrooves(value.grooves)) {
        return false;
    }
    if (value.yeast !== undefined && !isYeastState(value.yeast)) {
        return false;
    }
    if (value.automation !== undefined && !isAutomation(value.automation)) {
        return false;
    }
    if (value.markers !== undefined && (!Array.isArray(value.markers) || !value.markers.every(isMarker))) {
        return false;
    }
    if (value.tempoMap !== undefined && !isProjectTempoMap(value.tempoMap)) {
        return false;
    }
    if (value.timeSignatureMap !== undefined && !isProjectTimeSignatureMap(value.timeSignatureMap)) {
        return false;
    }
    if (value.takeLanes !== undefined && !isTakeLaneStore(value.takeLanes)) {
        return false;
    }
    if (
        value.sidechainRoutes !== undefined &&
        (!Array.isArray(value.sidechainRoutes) || !value.sidechainRoutes.every(isSidechainRoute))
    ) {
        return false;
    }
    if (value.adjustmentLayers !== undefined && !isAdjustmentLayers(value.adjustmentLayers)) {
        return false;
    }
    if (
        value.arrangements !== undefined &&
        (!Array.isArray(value.arrangements) || !value.arrangements.every(isArrangementSnapshot))
    ) {
        return false;
    }
    if (value.activeArrangementId !== undefined && typeof value.activeArrangementId !== 'string') {
        return false;
    }
    if (value.audioBuffers === undefined) {
        return true;
    }
    const references = collectAudioBufferReferences({
        arrangements: value.arrangements,
        tracks: value.arrangement.tracks,
    });
    return isAudioBuffers(value.audioBuffers, value.meta.createdAt, references);
}
