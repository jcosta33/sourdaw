import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateEvidenceManifest } from '../../../scripts/agent-campaign/evidenceManifest';

const manifestPath = resolve(process.cwd(), 'evidence/agent-campaign/manifest.json');
const manifestSource = readFileSync(manifestPath, 'utf8');

function replaceOnce(find: string, replacement: string): string {
    const changed = manifestSource.replace(find, replacement);
    expect(changed).not.toBe(manifestSource);
    return changed;
}

describe('agent campaign evidence manifest', () => {
    it('accepts the frozen canonical baseline', () => {
        expect(validateEvidenceManifest(manifestSource)).toEqual([]);
    });

    it.each([
        {
            name: 'unknown required fields',
            source: replaceOnce('"schemaVersion": 1,', '"schemaVersion": 1,\n  "unknown": true,'),
            error: 'manifest fields must be exactly',
        },
        {
            name: 'malformed IDs',
            source: replaceOnce('"id": "webllm"', '"id": "bad id"'),
            error: 'malformed ID',
        },
        {
            name: 'duplicate IDs',
            source: replaceOnce('"id": "native-local"', '"id": "webllm"'),
            error: 'duplicate ID webllm',
        },
        {
            name: 'missing SHA-256 digests',
            source: replaceOnce(
                '"lockfileSha256": "993d570ce02a3e110ba75bcfff0cab873e32024ba716123735820cff7c0d37d4"',
                '"lockfileSha256": "missing"'
            ),
            error: 'lockfileSha256 must be SHA-256',
        },
        {
            name: 'governing hash drift',
            source: replaceOnce(
                '"campaignIndex": "15f084e9138beb2dfe5e4b1bf61448b05a0061839579ecacacdedbb4f976e505"',
                '"campaignIndex": "05f084e9138beb2dfe5e4b1bf61448b05a0061839579ecacacdedbb4f976e505"'
            ),
            error: 'governing hashes do not match',
        },
        {
            name: 'undeclared references',
            source: replaceOnce(
                '"fixtureIds": [], "status": "pending"',
                '"fixtureIds": ["missing"], "status": "pending"'
            ),
            error: 'references undeclared fixture missing',
        },
        {
            name: 'capability promotion',
            source: replaceOnce(
                '"id": "bounce-critique", "status": "unadmitted"',
                '"id": "bounce-critique", "status": "admitted"'
            ),
            error: 'bounce-critique cannot be promoted',
        },
        {
            name: 'dirty integrated state',
            source: replaceOnce('"dirty": false', '"dirty": true'),
            error: 'integrated state must use the frozen baseline and be clean',
        },
        {
            name: 'threshold mutation',
            source: replaceOnce(
                '"unsafeWriteFalsePositives": ["maximum", 0]',
                '"unsafeWriteFalsePositives": ["maximum", 1]'
            ),
            error: 'frozen thresholds are missing or changed',
        },
        {
            name: 'named suite mutation',
            source: replaceOnce('"id": "accessibility"', '"id": "accessibility-v2"'),
            error: 'named suite inventory changed',
        },
    ])('fails closed on $name', ({ source, error }) => {
        expect(validateEvidenceManifest(source)).toContainEqual(expect.stringContaining(error));
    });
});
