import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assertLicenseExpressionEvidence } from '../dependencyLicenseReport';

const copying = readFileSync('public/legal/faustwasm-COPYING.txt', 'utf8');
function evidence(contents: string) {
    return [{ label: 'COPYING.txt', sha256: createHash('sha256').update(contents).digest('hex'), contents }];
}

describe('Faust LGPL2.1 metadata and actual grant', () => {
    it.each(['LGPL-2.1', 'LGPL-2.1-or-later'])('requires the actual wrapped grant for %s', (expression) => {
        expect(() =>
            assertLicenseExpressionEvidence('npm:@grame/faustwasm@0.20.2', expression, evidence(copying))
        ).not.toThrow();
    });

    it('does not normalize deprecated metadata without the actual or-later grant', () => {
        const only = copying.replace(
            /either version 2\.1 of the\s+License, or \(at your option\) any later version/u,
            'version2.1 only'
        );
        expect(only).not.toBe(copying);
        expect(() =>
            assertLicenseExpressionEvidence('npm:@grame/faustwasm@0.20.2', 'LGPL-2.1', evidence(only))
        ).toThrow();
    });

    it('rejects a title without a license grant', () => {
        expect(() =>
            assertLicenseExpressionEvidence(
                'npm:@grame/faustwasm@0.20.2',
                'LGPL-2.1',
                evidence('GNU Lesser General Public License version2.1')
            )
        ).toThrow();
    });
});
