import {
    formatRemoteTransmissionDisclosure,
    type AgentDataCategory,
    type RemoteTransmissionDisclosure,
} from '../models/AgentDataPolicy';

import { agentRunLifecycle } from './agentRunLifecycle';
import { notifyAiChange } from './notifyAiChange';

type Admission = {
    categories: readonly AgentDataCategory[];
    correlationId: string;
    requestId: string;
    published: boolean;
};
const admissions = new WeakMap<object, Admission>();

type RemoteTransmissionDisclosureInput = {
    categories: readonly AgentDataCategory[];
    correlationId: string;
    requestId: string;
    runId?: string;
    provider?: string;
};

function prepareRemoteTransmissionDisclosure(
    input: Pick<RemoteTransmissionDisclosureInput, 'categories' | 'correlationId' | 'requestId'>
): RemoteTransmissionDisclosure {
    const evidence = {} as RemoteTransmissionDisclosure;
    admissions.set(evidence, { ...input, categories: [...input.categories], published: false });
    return evidence;
}

function publishRemoteTransmissionDisclosure(input: {
    evidence: RemoteTransmissionDisclosure;
    runId?: string;
    provider?: string;
}): boolean {
    const admission = admissions.get(input.evidence);
    if (admission === undefined || admission.published) {
        return false;
    }
    admission.published = true;
    notifyAiChange('Hosted AI privacy disclosure', [formatRemoteTransmissionDisclosure(admission.categories)]);
    if (input.runId !== undefined) {
        agentRunLifecycle.recordProviderUsage({
            runId: input.runId,
            usage: {
                provider: input.provider ?? 'cloud',
                model: null,
                inputTokens: null,
                outputTokens: null,
                provenance: 'unavailable',
                correlationId: admission.correlationId,
                status: 'unavailable',
                disclosure: {
                    requestId: admission.requestId,
                    categories: [...admission.categories],
                    retention: {
                        applicationState: 'unknown',
                        abuseMonitoring: 'unknown',
                        promptCache: 'unknown',
                        safetyLegalException: 'unknown',
                        unknown: 'unknown',
                    },
                },
            },
        });
    }
    return true;
}

function discloseRemoteTransmission(input: RemoteTransmissionDisclosureInput): RemoteTransmissionDisclosure {
    const evidence = prepareRemoteTransmissionDisclosure(input);
    if (!publishRemoteTransmissionDisclosure({ evidence, runId: input.runId, provider: input.provider })) {
        throw new Error('Hosted AI privacy disclosure could not be published.');
    }
    return evidence;
}

function matchesRemoteTransmissionDisclosure(input: {
    evidence: RemoteTransmissionDisclosure | undefined;
    categories: readonly AgentDataCategory[];
    correlationId: string;
    requestId: string;
}): boolean {
    if (input.evidence === undefined || typeof input.evidence !== 'object' || input.evidence === null) {
        return false;
    }
    const admission = admissions.get(input.evidence);
    return (
        admission !== undefined &&
        admission.correlationId === input.correlationId &&
        admission.requestId === input.requestId &&
        admission.categories.length === input.categories.length &&
        !admission.categories.some((category, index) => category !== input.categories[index])
    );
}

function consumeRemoteTransmissionDisclosure(input: {
    evidence: RemoteTransmissionDisclosure | undefined;
    categories: readonly AgentDataCategory[];
    correlationId: string;
    requestId: string;
}): boolean {
    if (!matchesRemoteTransmissionDisclosure(input) || input.evidence === undefined) {
        return false;
    }
    const admission = admissions.get(input.evidence)!;
    if (!admission.published) {
        return false;
    }
    admissions.delete(input.evidence);
    return true;
}

export const remoteTransmissionDisclosure = {
    prepare: prepareRemoteTransmissionDisclosure,
    publish: publishRemoteTransmissionDisclosure,
    matches: matchesRemoteTransmissionDisclosure,
    issue: discloseRemoteTransmission,
    consume: consumeRemoteTransmissionDisclosure,
};
