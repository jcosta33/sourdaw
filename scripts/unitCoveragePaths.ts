import { posix } from 'node:path';

const excludedDirectories = ['node_modules', '__tests__', 'testing'];
const excludedFiles = ['src/setupTests.ts', 'src/app/main.tsx'];

export const unitCoverageInclude = ['src/**/*.{ts,tsx}'];
export const unitCoverageExclude = [
    ...excludedDirectories.map((directory) => `**/${directory}/**`),
    '**/*.spec.{ts,tsx}',
    '**/*.d.ts',
    ...excludedFiles,
];

export function isProductionCoveragePath(path: string): boolean {
    const directories = path.split('/').slice(0, -1);
    return (
        path === posix.normalize(path) &&
        /^src\/.+\.tsx?$/s.test(path) &&
        !/\.(?:spec\.tsx?|d\.ts)$/.test(path) &&
        !directories.some((directory) => excludedDirectories.includes(directory)) &&
        !excludedFiles.includes(path)
    );
}

export const unitCoverageShardCount = 4;
export const unitCoverageShardDirectory = 'unit-coverage-shard';
export const unitCoverageJson = 'coverage-final.json';
export const maxUnitCoverageShardBytes = 128 * 1024 * 1024;
