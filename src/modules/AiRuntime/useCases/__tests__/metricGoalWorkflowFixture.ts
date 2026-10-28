import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { chatStore } from '../../stores/chatStore';
import { clearPendingActionConfirmations } from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected a published object.');
    }
    return value;
}
function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError('Expected a published array.');
    }
    return value;
}
function text(value: unknown): string {
    if (typeof value !== 'string') {
        throw new TypeError('Expected a published string.');
    }
    return value;
}
function index(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError('Expected a published table index.');
    }
    return value;
}
function numberOrNull(value: unknown): number | null {
    if (value === null) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('Expected a finite published number.');
    }
    return value;
}
function textOrNull(value: unknown): string | null {
    return value === null ? null : text(value);
}

/** Decode only the actual provider bytes/strict enum; no app-private source records complete this inverse. */
export function readMetricPublication(schema: { function: { description?: string; parameters: unknown } }) {
    const description = schema.function.description ?? '';
    const printed: unknown = JSON.parse(description.slice(description.lastIndexOf('View: ') + 'View: '.length));
    const view = object(printed);
    const parameters = object(schema.function.parameters);
    const definitions = parameters.$defs === undefined ? {} : object(parameters.$defs);
    function resolved(value: unknown, seen = new Set<string>()): Record<string, unknown> {
        const node = object(value);
        if (typeof node.$ref !== 'string') {
            return node;
        }
        if (!node.$ref.startsWith('#/$defs/') || seen.has(node.$ref)) {
            throw new TypeError('Expected an in-document non-cyclic schema reference.');
        }
        seen.add(node.$ref);
        return resolved(definitions[node.$ref.slice('#/$defs/'.length)], seen);
    }
    function objectBranch(value: unknown): Record<string, unknown> | null {
        const node = resolved(value);
        if (
            (node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))) &&
            node.additionalProperties === false &&
            node.properties !== null &&
            typeof node.properties === 'object' &&
            !Array.isArray(node.properties)
        ) {
            return node;
        }
        for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
            if (!Array.isArray(node[keyword])) {
                continue;
            }
            for (const composed of array(node[keyword])) {
                const found = objectBranch(composed);
                if (found !== null) {
                    return found;
                }
            }
        }
        return null;
    }
    const branch = objectBranch(object(parameters.properties).metricIntent);
    if (branch === null) {
        throw new TypeError('Expected the closed metric branch.');
    }
    const rowProperties = object(resolved(resolved(object(branch.properties).objectives).items).properties);
    const ids = array(resolved(rowProperties.objectiveId).enum).map(text);
    const scopes = array(resolved(rowProperties.scopeCandidateId).enum)
        .filter((entry) => entry !== null)
        .map(text);
    const eligibility = array(view.metricEligibility).map((entry) => array(entry).map(index));
    const roles = array(view.metricRoles).map(text);
    const roleSets = array(view.metricRoleSets).map((entry) => array(entry).map(index));
    const metrics = array(view.metricMetrics).map(array);
    const expectations = array(view.metricExpectations).map(array);
    const policies = array(view.metricPolicies).map(text);
    return array(view.metricObjectives).map((entry, ordinal) => {
        const row = array(entry);
        return {
            id: ids[ordinal],
            kind: text(row[0]),
            recipeId: textOrNull(row[1]),
            label: text(row[2]),
            eligibleScopeIds: eligibility[index(row[3])]!.map((reference) => scopes[reference]),
            defaultScopeIds: eligibility[index(row[4])]!.map((reference) => scopes[reference]),
            roles: roleSets[index(row[5])]!.map((reference) => roles[reference]),
            goals: array(row[6]).map((reference) => {
                const expectation = expectations[index(reference)]!;
                const metric = metrics[index(expectation[0])]!;
                let policyId: string | null = null;
                if (expectation[5] !== null) {
                    policyId = policies[index(expectation[5])] ?? null;
                }
                return {
                    metricName: text(metric[0]),
                    unit: textOrNull(metric[1]),
                    band: textOrNull(expectation[1]),
                    relation: text(expectation[2]),
                    targetValue: numberOrNull(expectation[3]),
                    tolerance: numberOrNull(expectation[4]),
                    policyId,
                };
            }),
        };
    });
}

/** Shared real compiler/CRDT/Command harness; callers replace only configured provider/audio ports. */
export function configureMetricGoalProject(input: {
    tracks: NonNullable<typeof trackStore.value>['tracks'];
    sections: NonNullable<typeof markerStore.value>['sections'];
    label: string;
}): void {
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    configureAiWorkflowCommandPreflightFixture();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority(input.label);
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({ tracks: input.tracks, selectedTrackId: null, ghostClips: [] });
    markerStore.set({ markers: [], sections: input.sections });
    transportStore.set({ ...defaultTransportState, tempo: 120 });
    flushAutomergeStorageWrites();
    clearAgentMeasurementArtifacts();
}

export function resetMetricGoalProject(): void {
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    clearAgentMeasurementArtifacts();
    resetAiWorkflowCommandPreflightFixture();
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    markerStore.set({ markers: [], sections: [] });
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
}

/** Full native AudioBuffer shape consumed by actual production metering. */
export function metricGoalAudioBuffer(sample: (seconds: number) => number, seconds: number): AudioBuffer {
    const sampleRate = 48_000;
    const length = Math.round(seconds * sampleRate);
    const channels = [new Float32Array(length), new Float32Array(length)];
    for (const channel of channels) {
        for (let frame = 0; frame < length; frame++) {
            channel[frame] = sample(frame / sampleRate);
        }
    }
    return {
        sampleRate,
        length,
        numberOfChannels: channels.length,
        duration: length / sampleRate,
        getChannelData(channel) {
            const data = channels[channel];
            if (data === undefined) {
                throw new RangeError('Unknown audio channel.');
            }
            return data;
        },
        copyFromChannel(destination, channelNumber, bufferOffset = 0) {
            destination.set(
                this.getChannelData(channelNumber).subarray(bufferOffset, bufferOffset + destination.length)
            );
        },
        copyToChannel(source, channelNumber, bufferOffset = 0) {
            this.getChannelData(channelNumber).set(source.subarray(0, length - bufferOffset), bufferOffset);
        },
    };
}

/** A scripted provider's semantic plan; no metric result or private source identity is supplied here. */
export function metricGoalProviderPlan(objective: string, targetIds: readonly string[]) {
    return {
        semantic: { classification: 'complex', uncertainty: [] },
        objective,
        constraints: ['Require actual objective proof before approval.'],
        scope: { targetIds: [...targetIds], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        capabilityIds: [],
        assetIds: [],
        alternatives: [],
        validationStrategy: ['Check the actual named-range measurements against the frozen criteria.'],
        stoppingConditions: ['Stop before mutation if actual metric proof is missing or incompatible.'],
    };
}
