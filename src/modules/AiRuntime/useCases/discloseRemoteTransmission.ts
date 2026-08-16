import {
    formatRemoteTransmissionDisclosure,
    type AgentDataCategory,
    type RemoteTransmissionDisclosure,
} from '../models/AgentDataPolicy';

import { agentRunLifecycle } from './agentRunLifecycle';
import { notifyAiChange } from './notifyAiChange';

type Admission = { categories: readonly AgentDataCategory[]; correlationId: string; requestId: string };
const admissions = new WeakMap<object, Admission>();

function discloseRemoteTransmission(input: {
    categories: readonly AgentDataCategory[];
    correlationId: string;
    requestId: string;
    runId?: string;
    provider?: string;
}): RemoteTransmissionDisclosure {
    notifyAiChange('Hosted AI privacy disclosure', [formatRemoteTransmissionDisclosure(input.categories)]);
    const evidence = {} as RemoteTransmissionDisclosure;
    admissions.set(evidence, { ...input, categories: [...input.categories] });
    if (input.runId !== undefined) {
        agentRunLifecycle.recordProviderUsage({
            runId: input.runId,
            usage: {
                provider: input.provider ?? 'cloud',
                model: null,
                inputTokens: null,
                outputTokens: null,
                provenance: 'unavailable',
                correlationId: input.correlationId,
                status: 'unavailable',
                disclosure: {
                    requestId: input.requestId,
                    categories: [...input.categories],
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
    return evidence;
}

function consumeRemoteTransmissionDisclosure(input: {
    evidence: RemoteTransmissionDisclosure | undefined;
    categories: readonly AgentDataCategory[];
    correlationId: string;
    requestId: string;
}): boolean {
    if (input.evidence === undefined || typeof input.evidence !== 'object' || input.evidence === null) {
        return false;
    }
    const admission = admissions.get(input.evidence);
    if (
        admission === undefined ||
        admission.correlationId !== input.correlationId ||
        admission.requestId !== input.requestId ||
        admission.categories.length !== input.categories.length ||
        admission.categories.some((category, index) => category !== input.categories[index])
    ) {
        return false;
    }
    admissions.delete(input.evidence);
    return true;
}

export const remoteTransmissionDisclosure = {
    issue: discloseRemoteTransmission,
    consume: consumeRemoteTransmissionDisclosure,
};
