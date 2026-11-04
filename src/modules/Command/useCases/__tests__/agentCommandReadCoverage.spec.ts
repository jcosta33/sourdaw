import { afterEach, describe, expect, it } from 'vitest';

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';

import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { isExecutableAppActionType } from '../executableAppActionRegistry';
import { getAgentCommandLedger } from '../getAgentCommandLedger';

describe('agent command read discovery', () => {
    afterEach(() => {
        clearHandlerRegistry();
    });

    it('publishes the transient read without granting mutation or preview authority', () => {
        clearHandlerRegistry();
        const ledger = getAgentCommandLedger();
        expect(ledger.readOnlyEntries).toEqual([
            {
                operationId: 'analysis.detectTransients',
                category: 'audio-editing',
                owner: 'AiRuntime',
                descriptorVersion: null,
                packet: 'executeTransientOnsetRead',
                closure: 'supported',
                minimumWriteSet: false,
                previewExecution: 'not-applicable',
            },
        ]);
        expect(ledger.entries.some((entry) => entry.operationId === 'analysis.detectTransients')).toBe(false);
        expect(isExecutableAppActionType('analysis.detectTransients')).toBe(false);
    });

    it('binds each read to an available callable capability with the same owner and version', () => {
        const reads = getAgentCommandLedger().readOnlyEntries;
        if (reads === undefined) {
            throw new Error('The live ledger must publish read discovery.');
        }
        expect(reads.length).toBeGreaterThan(0);
        const catalog = getAgentCapabilityCatalog([]);
        for (const read of reads) {
            expect(catalog.entries.find((entry) => entry.id === read.operationId)).toMatchObject({
                availability: 'available',
                version: read.descriptorVersion,
                evidence: { owner: read.owner, callable: true, surface: 'application-tool' },
            });
        }
    });
});
