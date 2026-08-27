import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const browserAiAdmissionSource = readFileSync(
    join(repositoryRoot, 'tests/e2e/browserAiWebGpuAdmission.spec.ts'),
    'utf8'
);
const firstAdmissionTest = browserAiAdmissionSource.slice(
    browserAiAdmissionSource.indexOf("test('proves the live Chromium Browser AI admission boundary without skipping'"),
    browserAiAdmissionSource.indexOf(
        "test('renders an exact-duration DDSP preview from verified OPFS artifacts with hardware WebGPU'"
    )
);

describe('Browser AI WebGPU admission', () => {
    it('reserves the cold-start budget needed before the launch-screen readiness gate', () => {
        expect(firstAdmissionTest).toContain('test.setTimeout(180_000);');
    });
});
