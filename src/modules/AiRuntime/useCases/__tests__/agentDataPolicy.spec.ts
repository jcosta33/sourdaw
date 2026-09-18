import { describe, expect, it } from 'vitest';

import { REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';

import { createRequest, finishEnvelope } from './modelProviderProtocolFixture';

describe('discloseRemoteTransmission', () => {
    it('requires a consumed remote disclosure before a remote-allowed session starts', () => {
        // capabilities.dataPolicies is exactly ['remote-allowed'] for 'anthropic' (also true for 'openai');
        // 'anthropic' is picked here.
        const categories = [...REMOTE_TEXT_AGENT_DATA_CATEGORIES];
        const correlationId = 'disclosure-correlation-1';
        const requestId = 'disclosure-request-1';
        const disclosure = remoteTransmissionDisclosure.issue({ categories, correlationId, requestId });

        const { protocol, compiled } = createRequest({
            provider: 'anthropic',
            correlationId,
            requestId,
            dataPolicy: 'remote-allowed',
            dataCategories: categories,
            remoteDisclosure: disclosure,
        });
        if (compiled.status !== 'ready') {
            throw new Error(compiled.failure.safeMessage);
        }

        const undisclosedRequest = { ...compiled.request };
        delete undisclosedRequest.remoteDisclosure;
        expect(() => protocol.start(undisclosedRequest)).toThrow(
            'The hosted provider request lacks admitted data disclosure.'
        );

        const unpublishedDisclosure = remoteTransmissionDisclosure.prepare({
            categories,
            correlationId: 'disclosure-correlation-2',
            requestId: 'disclosure-request-2',
        });
        const { protocol: unpublishedProtocol, compiled: unpublishedCompiled } = createRequest({
            provider: 'anthropic',
            correlationId: 'disclosure-correlation-2',
            requestId: 'disclosure-request-2',
            dataPolicy: 'remote-allowed',
            dataCategories: categories,
            remoteDisclosure: unpublishedDisclosure,
        });
        if (unpublishedCompiled.status !== 'ready') {
            throw new Error(unpublishedCompiled.failure.safeMessage);
        }
        expect(() => unpublishedProtocol.start(unpublishedCompiled.request)).toThrow(
            'The hosted provider request lacks admitted data disclosure.'
        );

        const session = protocol.start(compiled.request);
        expect(() => protocol.start(compiled.request)).toThrow(
            'The hosted provider request lacks admitted data disclosure.'
        );
        const result = session.finish(finishEnvelope(compiled.request, 0, { reason: 'stop' }));

        expect(result.status).toBe('complete');
        // createSession's resultForFinish never assigns remoteDisclosure on the finish() result.
        expect(result).not.toHaveProperty('remoteDisclosure');
    });
});
