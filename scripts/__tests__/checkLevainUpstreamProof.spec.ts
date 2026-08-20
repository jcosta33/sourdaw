import { describe, expect, it } from 'vitest';

import { gitObjectSha, validateLevainUpstreamProof } from '../checkLevainUpstreamProof';

import type { LevainProvenance } from '../checkLevainProvenance';

function treeEntry(mode: '100644' | '40000', name: string, sha: string): Buffer[] {
    return [Buffer.from(`${mode} ${name}\0`), Buffer.from(sha, 'hex')];
}

function fixture(): {
    provenance: LevainProvenance;
    commit: Buffer;
    license: Buffer;
    tree: string;
} {
    const license = Buffer.from('CC0');
    const sample = Buffer.from('sample');
    const licenseBlob = gitObjectSha('blob', license);
    const sampleBlob = gitObjectSha('blob', sample);
    const sampleTree = gitObjectSha('tree', Buffer.concat(treeEntry('100644', 'note.wav', sampleBlob)));
    const treeBody = Buffer.concat([
        ...treeEntry('100644', 'LICENSE', licenseBlob),
        ...treeEntry('40000', 'Samples', sampleTree),
    ]);
    const tree = gitObjectSha('tree', treeBody);
    const commit = Buffer.from(
        `tree ${tree}\nauthor Test <test@example.com> 0 +0000\ncommitter Test <test@example.com> 0 +0000\n\nfixture\n`
    );
    const revision = gitObjectSha('commit', commit);
    return {
        provenance: {
            schemaVersion: 1,
            source: {
                repository: 'https://github.com/example/source',
                revision,
                tree,
                license: 'CC0-1.0',
                licensePath: 'LICENSE',
                licenseBlob,
            },
            samples: [
                {
                    path: 'public/samples/levain/note.wav',
                    sourcePath: 'Samples/note.wav',
                    gitBlob: sampleBlob,
                    sha256: 'a'.repeat(64),
                    license: 'CC0-1.0',
                },
            ],
            generatedFiles: [],
        },
        commit,
        license,
        tree: [
            `#\trevision\t${revision}`,
            `#\ttree\t${tree}`,
            'mode\ttype\tsha\tpath',
            `100644\tblob\t${licenseBlob}\tLICENSE`,
            `040000\ttree\t${sampleTree}\tSamples`,
            `100644\tblob\t${sampleBlob}\tSamples/note.wav`,
        ].join('\n'),
    };
}

describe('Levain upstream proof', () => {
    it('rebuilds the pinned commit, tree, license, and sample path', () => {
        const value = fixture();
        expect(validateLevainUpstreamProof(value.provenance, value.commit, value.license, value.tree)).toEqual([]);
    });

    it('rejects a false source mapping', () => {
        const value = fixture();
        value.provenance.samples[0]!.gitBlob = 'b'.repeat(40);
        expect(validateLevainUpstreamProof(value.provenance, value.commit, value.license, value.tree)).toContain(
            'public/samples/levain/note.wav: upstream path does not match Git blob'
        );
    });

    it('rejects a tree relabeled as a blob with its descendants removed', () => {
        const value = fixture();
        const relabeled = value.tree
            .split('\n')
            .filter((line) => !line.endsWith('\tSamples/note.wav'))
            .map((line) => line.replace('040000\ttree\t', '040000\tblob\t'))
            .join('\n');
        expect(() => validateLevainUpstreamProof(value.provenance, value.commit, value.license, relabeled)).toThrow(
            'Malformed Levain upstream tree row'
        );
    });
});
