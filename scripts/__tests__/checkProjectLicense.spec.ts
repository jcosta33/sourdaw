import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    DISTRIBUTION_PROJECT_NOTICE,
    PROJECT_LICENSE_ID,
    PROJECT_NOTICE,
    PROJECT_OWNER,
    SPDX_OWNERSHIP_HEADER,
    validateProjectLicense,
} from '../checkProjectLicense';

const ownershipFiles = [
    'src/infra/store/storage/LocalStorageKeys.ts',
    'src/modules/AiRuntime/models/ToolDefinitions.ts',
    'src/modules/AiRuntime/models/Tools/Types.ts',
    'src/modules/AiGeneration/models/MidiPatternType.ts',
];

function write(root: string, path: string, contents: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
}

describe('project license', () => {
    let root: string;
    const cargo = {
        packages: [{ name: 'crate-one', license: PROJECT_LICENSE_ID, authors: [PROJECT_OWNER] }],
    };

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'sourdaw-project-license-'));
        const license = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const serverThirdPartyNotices = readFileSync(join(process.cwd(), 'server/THIRD-PARTY-NOTICES.md'), 'utf8');
        const adaptedSourceLicense = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        write(root, 'LICENSE', license);
        write(root, 'public/legal/APACHE-2.0.txt', license);
        write(root, 'server/LICENSE', license);
        write(root, 'NOTICE', PROJECT_NOTICE);
        write(root, 'public/legal/SOURDAW-NOTICE.txt', DISTRIBUTION_PROJECT_NOTICE);
        write(root, 'server/NOTICE', DISTRIBUTION_PROJECT_NOTICE);
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '# Third-Party Notices\n');
        write(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt', adaptedSourceLicense);
        write(root, 'server/THIRD-PARTY-NOTICES.md', serverThirdPartyNotices);
        write(root, 'package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: PROJECT_LICENSE_ID } } }));
        for (const path of ownershipFiles) {
            write(root, path, `${SPDX_OWNERSHIP_HEADER}export {};\n`);
        }
        for (const path of [
            'release/open-source-inventory.json',
            'public/samples/levain/provenance.tsv',
            'scripts/checkLevainProvenance.ts',
            'scripts/checkReleaseInventory.ts',
        ]) {
            write(root, path, 'current');
        }
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('accepts one project grant across source and shipped metadata', () => {
        expect(validateProjectLicense(root, cargo)).toEqual([]);
    });

    it('rejects canonical LICENSE drift independently', () => {
        write(root, 'LICENSE', 'wrong');
        expect(validateProjectLicense(root, cargo)).toContain('LICENSE: Apache-2.0 text drifted');
    });

    it('rejects shipped license and notice drift', () => {
        write(root, 'public/legal/APACHE-2.0.txt', 'wrong');
        write(root, 'server/LICENSE', 'wrong');
        write(root, 'NOTICE', 'wrong');
        write(root, 'public/legal/SOURDAW-NOTICE.txt', 'wrong');
        write(root, 'server/NOTICE', 'wrong');
        write(root, 'server/THIRD-PARTY-NOTICES.md', 'wrong');
        write(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt', 'wrong');
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                'public/legal/APACHE-2.0.txt: Apache-2.0 text drifted',
                'server/LICENSE: Apache-2.0 text drifted',
                'NOTICE: project attribution drifted',
                'public/legal/SOURDAW-NOTICE.txt: project attribution drifted',
                'server/NOTICE: project attribution drifted',
                'server/THIRD-PARTY-NOTICES.md: third-party notices drifted',
                'public/legal/MI-PLAITS-DSP-RS-MIT.txt: upstream MIT license drifted',
            ])
        );
    });

    it('rejects package and crate metadata drift', () => {
        write(root, 'package.json', JSON.stringify({ license: 'MIT' }));
        expect(
            validateProjectLicense(root, {
                packages: [{ name: 'crate-one', license: null, authors: [] }],
            })
        ).toEqual(
            expect.arrayContaining([
                'package.json: license must be Apache-2.0',
                'crate-one: Cargo license must be Apache-2.0',
                'crate-one: Cargo authors must include Jose Costa',
            ])
        );
    });

    it('rejects server/package.json drift independently', () => {
        write(root, 'server/package.json', JSON.stringify({ license: 'MIT' }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package.json: license must be Apache-2.0');
    });

    it('rejects server/package-lock.json drift independently', () => {
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: 'MIT' } } }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package-lock.json: license must be Apache-2.0');
    });

    it('rejects stale proprietary headers and pending project grants', () => {
        write(root, ownershipFiles[0]!, 'all rights reserved');
        write(root, 'release/open-source-inventory.json', 'pending:OS-10-project-grant');
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                `${ownershipFiles[0]}: SPDX ownership header drifted`,
                `${ownershipFiles[0]}: stale proprietary ownership claim`,
                'release/open-source-inventory.json: stale project-license marker pending:OS-10-project-grant',
            ])
        );
    });
});
