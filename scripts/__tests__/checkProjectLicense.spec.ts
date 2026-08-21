import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
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
        write(root, 'LICENSE', license);
        write(root, 'public/legal/APACHE-2.0.txt', license);
        write(root, 'NOTICE', PROJECT_NOTICE);
        write(root, 'public/legal/SOURDAW-NOTICE.txt', PROJECT_NOTICE);
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '# Third-Party Notices\n');
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

    it('rejects license and notice drift', () => {
        write(root, 'public/legal/APACHE-2.0.txt', 'wrong');
        write(root, 'NOTICE', 'wrong');
        write(root, 'public/legal/SOURDAW-NOTICE.txt', 'wrong');
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                'public/legal/APACHE-2.0.txt: Apache-2.0 text drifted',
                'NOTICE: project attribution drifted',
                'public/legal/SOURDAW-NOTICE.txt: project attribution drifted',
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
