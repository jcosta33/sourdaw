import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ESLint hashes serializable configuration before invoking a parser. Bind its
// result cache to our actual compiler/client/config bytes even while upstream
// parser metadata keeps its truthful upstream version. This never starts or
// prepares a compiler and is safe for syntax-only configuration discovery.
export function nativeLintCacheIdentity() {
    const hash = createHash('sha256');
    const paths = [
        '../../pnpm-lock.yaml',
        '../../eslint.config.mjs',
        './identity.json',
        './compiler.patch',
        './compiler.mjs',
        './lintLifecycle.mjs',
        './lintIdentity.mjs',
        './windowsCache.mjs',
        './windows-cache.ps1',
        ...[
            '@eslint-react__core@5.30.2',
            '@eslint-react__eslint@5.30.2',
            '@tanstack__eslint-plugin-query@5.107.1',
            '@typescript-eslint__eslint-plugin@8.72.2',
            '@typescript-eslint__parser@8.72.2',
            '@typescript-eslint__types@8.72.2',
            '@typescript-eslint__typescript-estree@8.72.2',
            '@typescript-eslint__utils@8.72.2',
            'eslint-plugin-react-jsx@5.30.2',
            'eslint-plugin-react-x@5.30.2',
            'typescript-eslint@8.72.2',
            'typescript@7.0.2',
        ].map((name) => `../../patches/${name}.patch`),
    ];
    for (const path of paths) {
        hash.update(path)
            .update('\0')
            .update(readFileSync(new URL(path, import.meta.url)))
            .update('\0');
    }
    return hash.digest('hex');
}
