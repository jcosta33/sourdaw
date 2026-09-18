import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { INIT_SAB_MESSAGE_TYPE, LATENCY_CHANGED_MESSAGE_TYPE } from '#/infra/audioWorklet/workletPortMessages';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');
const SERVICES = join(REPO_ROOT, 'src/modules/AudioEngine/services');

/** Processors that receive the telemetry SAB slot. */
const INIT_ONLY_PROCESSORS = ['fermenterProcessor.ts', 'scoringProcessor.ts', 'toasterProcessor.ts'] as const;

/** Processors that additionally report latency changes back to their node. */
const LATENCY_REPORTING_PROCESSORS = [
    'bacteriaProcessor.ts',
    'crustProcessor.ts',
    'glutenProcessor.ts',
    'grinderProcessor.ts',
    'proofProcessor.ts',
] as const;

const ALL_PROCESSORS = [...INIT_ONLY_PROCESSORS, ...LATENCY_REPORTING_PROCESSORS];

function processorSource(name: string): string {
    return readFileSync(join(SERVICES, name), 'utf8');
}

/**
 * The processors restate the port discriminants rather than importing them
 * (worklet isolation), so this spec is the pin the conventions require: if
 * either side of a pair drifts, the messages are silently dropped because
 * neither side errors. The processors are read as source text rather than
 * imported because each extends `AudioWorkletProcessor` at module scope, which
 * does not exist outside the worklet realm — `proofProcessor.spec.ts` reads its
 * worklet transcription the same way for the same reason.
 */
describe('worklet port message parity', () => {
    it("restates 'init-sab' exactly as the app-side owner spells it in every processor", () => {
        expect(INIT_SAB_MESSAGE_TYPE).toBe('init-sab');
        for (const name of ALL_PROCESSORS) {
            expect(processorSource(name), name).toContain(`INIT_SAB_MESSAGE_TYPE = '${INIT_SAB_MESSAGE_TYPE}'`);
        }
    });

    it("restates 'latency-changed' exactly as the app-side owner spells it in every latency reporter", () => {
        expect(LATENCY_CHANGED_MESSAGE_TYPE).toBe('latency-changed');
        for (const name of LATENCY_REPORTING_PROCESSORS) {
            expect(processorSource(name), name).toContain(
                `LATENCY_CHANGED_MESSAGE_TYPE = '${LATENCY_CHANGED_MESSAGE_TYPE}'`
            );
        }
    });

    it('keeps every restatement pointing back at the app-side owner', () => {
        for (const name of ALL_PROCESSORS) {
            expect(processorSource(name), name).toContain('audioWorklet/workletPortMessages');
        }
    });
});
