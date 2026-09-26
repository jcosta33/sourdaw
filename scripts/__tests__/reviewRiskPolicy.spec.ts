import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GOVERNANCE_TRANSITION_PATHS, parseReviewRiskPlan, planReviewRisk } from '../reviewRiskPolicy.ts';
import {
    BOOTSTRAP_PATH,
    commandEntries,
    trustedDependencyGraphs,
    trustedLocalImportClosure,
} from '../trustedGithubWriteBootstrap.ts';

import type { ReviewChangedPath } from '../reviewDiffSummary.ts';
import type { ReviewRiskClass, ReviewRiskPlan, ReviewStanceId } from '../reviewRiskPolicy.ts';
import type { TrustedGithubWriteCommand } from '../trustedGithubWriteBootstrap.ts';

/**
 * The stance union each class earns, declared independently of the policy under test so an omission
 * or an unearned addition reddens this spec.
 */
const EARNED_STANCES: Record<ReviewRiskClass, readonly ReviewStanceId[]> = {
    small: ['correctness', 'test-validity'],
    'test-only': ['test-validity'],
    ordinary: ['correctness', 'code-craft', 'module-boundaries', 'test-validity'],
    'cross-domain': ['correctness', 'module-boundaries', 'test-validity'],
    'realtime-audio': ['correctness', 'realtime-audio', 'test-validity'],
    'native-security': ['correctness', 'security-platform', 'test-validity'],
    undo: ['correctness', 'project-integrity-undo', 'test-validity'],
};

function earned(riskClasses: readonly ReviewRiskClass[]): ReviewStanceId[] {
    const stances = new Set<ReviewStanceId>();
    for (const riskClass of riskClasses) {
        for (const stance of EARNED_STANCES[riskClass]) {
            stances.add(stance);
        }
    }
    return [...stances].sort();
}

function changed(path: string, group: ReviewChangedPath['group'], added: number, deleted: number): ReviewChangedPath {
    return { path, group, added, deleted, binary: false };
}

function handwritten(path: string, added: number, deleted: number): ReviewChangedPath {
    return changed(path, 'handwritten', added, deleted);
}

function reviewPlan(paths: readonly ReviewChangedPath[]): ReviewRiskPlan {
    return planReviewRisk({ pr: 2999, headSha: 'head', baseSha: 'base', paths });
}

function readRepositorySource(): (path: string) => string | undefined {
    const repositoryRoot = join(import.meta.dirname, '..', '..');
    return (path: string): string | undefined => {
        try {
            return readFileSync(join(repositoryRoot, path), 'utf8');
        } catch {
            return undefined;
        }
    };
}

/**
 * The per-command closure contract: the declared set must start with the loader, carry the runtime's
 * own entry path at `[1]`, and equal exactly the static local-import closure of that entry plus the
 * loader's own static closure. Entry and closure are both derived from the runtime, never from the
 * declared array under test, so a swapped or truncated declaration reddens.
 */
function assertDeclaredClosure(
    command: TrustedGithubWriteCommand,
    declared: readonly string[],
    readSource: (path: string) => string | undefined
): void {
    expect(declared[0], `${command} declared loader`).toBe(BOOTSTRAP_PATH);
    expect(declared[1], `${command} declared entry`).toBe(commandEntries[command].path);
    const expected = new Set(trustedLocalImportClosure(commandEntries[command].path, readSource));
    for (const path of trustedLocalImportClosure(BOOTSTRAP_PATH, readSource)) {
        expected.add(path);
    }
    expect(new Set(declared), `${command} declared closure`).toEqual(expected);
}

describe('planReviewRisk', () => {
    it('should call a modest handwritten change small, needing only correctness and test validity', () => {
        const result = reviewPlan([handwritten('src/components/SafeMarkdown.tsx', 12, 4)]);

        expect(result.riskClasses).toEqual(['small']);
        expect(result.requiredStances).toEqual(['correctness', 'test-validity']);
        expect(result.triggers).toContain('small:handwritten-lines<=200');
    });

    it('should call a change that touches only tests test-only, with no size or specialist class', () => {
        const result = reviewPlan([
            changed('src/modules/Arrangement/useCases/__tests__/addTrack.spec.ts', 'tests', 30, 5),
            changed('scripts/__tests__/reviewDiffSummary.spec.ts', 'tests', 80, 0),
        ]);

        expect(result.riskClasses).toEqual(['test-only']);
        expect(result.requiredStances).toEqual(['test-validity']);
        expect(result.triggers).toContain('test-only:all-paths-are-tests');
    });

    it('should call handwritten paths spanning two module domains cross-domain', () => {
        const result = reviewPlan([
            handwritten('src/modules/Arrangement/useCases/addTrack.ts', 8, 2),
            handwritten('src/modules/Transport/models/TempoMap.ts', 4, 1),
        ]);

        expect(result.riskClasses).toEqual(['cross-domain']);
        expect(result.requiredStances).toEqual(['correctness', 'module-boundaries', 'test-validity']);
        expect(result.triggers).toContain('cross-domain:multiple-surfaces');
    });

    it('should call a change mixing a module path with a cross-cutting path cross-domain', () => {
        const result = reviewPlan([
            handwritten('src/modules/Transport/models/TempoMap.ts', 4, 1),
            handwritten('src/infra/audioContext/audioLatencyProfile.ts', 3, 1),
        ]);

        expect(result.riskClasses).toEqual(['cross-domain']);
        expect(result.requiredStances).toEqual(['correctness', 'module-boundaries', 'test-validity']);
        expect(result.triggers).toContain('cross-domain:multiple-surfaces');
    });

    it('should call a handwritten AudioEngine change realtime-audio', () => {
        const result = reviewPlan([handwritten('src/modules/AudioEngine/engine/BusNode.ts', 20, 3)]);

        expect(result.riskClasses).toEqual(['realtime-audio']);
        expect(result.requiredStances).toEqual(['correctness', 'realtime-audio', 'test-validity']);
        expect(result.triggers).toContain('realtime-audio:src/modules/AudioEngine/');
    });

    it('should call a handwritten electron change native-security', () => {
        const result = reviewPlan([handwritten('electron/main/bridge.ts', 15, 2)]);

        expect(result.riskClasses).toEqual(['native-security']);
        expect(result.requiredStances).toEqual(['correctness', 'security-platform', 'test-validity']);
        expect(result.triggers).toContain('native-security:electron/');
    });

    it('should call the trusted-write identity boundary native-security', () => {
        const result = reviewPlan([handwritten('src/utils/desktopBridge.ts', 6, 1)]);

        expect(result.riskClasses).toEqual(['native-security']);
        expect(result.requiredStances).toEqual(['correctness', 'security-platform', 'test-validity']);
        expect(result.triggers).toContain('native-security:src/utils/desktopBridge.ts');
    });

    it('should call a small playhead-scheduler change realtime-audio, since it can move audible timing (#3377)', () => {
        const result = reviewPlan([
            handwritten('src/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler.ts', 10, 10),
        ]);

        expect(result.riskClasses).toEqual(['realtime-audio']);
        expect(result.requiredStances).toEqual(['correctness', 'realtime-audio', 'test-validity']);
        expect(result.triggers).toContain('realtime-audio:src/modules/Transport/useCases/playheadScheduler/');
    });

    it('should call a small project-persistence change undo, since it can corrupt saved projects (#3377)', () => {
        const persistenceWrites = [
            'src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts',
            'src/modules/Project/repositories/project/writeProjectJson.ts',
            'src/modules/Project/repositories/nativeProjectFiles/saveProjectToFile.ts',
        ];

        for (const path of persistenceWrites) {
            const result = reviewPlan([handwritten(path, 10, 10)]);
            expect(result.riskClasses, path).toEqual(['undo']);
            expect(result.requiredStances, path).toEqual(['correctness', 'project-integrity-undo', 'test-validity']);
            expect(result.triggers, path).toContain(`undo:${path}`);
        }
    });

    it('should not fire the project-persistence trigger on a like-named path outside the Project module', () => {
        const result = reviewPlan([
            handwritten('src/modules/AgentStudio/presentations/projectPersistencePanel.tsx', 10, 10),
        ]);

        expect(result.riskClasses).toEqual(['small']);
    });

    it('should call a small privileged-transition script change native-security (#3377)', () => {
        const result = reviewPlan([handwritten('scripts/confirmReviewRepairs.ts', 10, 10)]);

        expect(result.riskClasses).toEqual(['native-security']);
        expect(result.requiredStances).toEqual(['correctness', 'security-platform', 'test-validity']);
        expect(result.triggers).toContain('native-security:scripts/confirmReviewRepairs.ts');
    });

    it('should pin the governance-transition list to the closure union as sets, in both directions', () => {
        const closurePaths = [...new Set(Object.values(trustedDependencyGraphs).flat())].sort();

        expect(closurePaths.length).toBeGreaterThan(0);
        expect([...GOVERNANCE_TRANSITION_PATHS].sort()).toEqual(closurePaths);
    });

    it('should classify every trusted GitHub-write closure path native-security, proving the wiring', () => {
        const closurePaths = [...new Set(Object.values(trustedDependencyGraphs).flat())].sort();

        for (const path of closurePaths) {
            const result = reviewPlan([handwritten(path, 1, 1)]);
            expect(result.riskClasses, path).toContain('native-security');
        }
    });

    /**
     * The union pin above is blind to per-command drift: removing one path from one command's closure
     * leaves the union unchanged when another command still declares it, so only the exact-closure
     * spec notices. This check asserts the per-command property the union cannot: each command's
     * declared closure equals exactly its static local-import closure (type-only edges included) plus
     * the loader's own static closure — so a single command losing a closure entry, or gaining one it
     * never statically imports, reddens this check. Classification stays with the union-wide checks
     * above, which already cover every declared path.
     */
    it('should pin each command closure to its entry static local imports, per command', () => {
        const readSource = readRepositorySource();

        for (const command of Object.keys(trustedDependencyGraphs) as TrustedGithubWriteCommand[]) {
            assertDeclaredClosure(command, trustedDependencyGraphs[command], readSource);
        }
    });

    /**
     * The entry the closure is walked from must come from the runtime's own command table, never from
     * the declared array itself: `declared[1]` is part of the value under test, so a declaration whose
     * entry is swapped for another declared path — type-valid, the same set — would pass every check
     * while the command dies with `ERR_MODULE_NOT_FOUND` mid-delivery. A same-set permutation leaves
     * the entry-position assertion as the only thing that can fail, so removing it reddens this case.
     */
    it('should refuse a command declaration whose entry is not its runtime entry', () => {
        const readSource = readRepositorySource();
        const declared = [...trustedDependencyGraphs.deliver];
        const entry = declared[1]!;
        const neighbour = declared[2]!;
        declared[1] = neighbour;
        declared[2] = entry;

        expect(() => assertDeclaredClosure('deliver', declared, readSource)).toThrow(/declared entry/);
    });

    /**
     * The loader must sit at `declared[0]`, not merely be present: the set comparison cannot see
     * order, so a declaration that buries the loader still satisfies it. Swapping the loader out of
     * position zero keeps the set identical, so only the loader-position assertion can fail.
     */
    it('should refuse a command declaration that does not start with the loader', () => {
        const readSource = readRepositorySource();
        const declared = [...trustedDependencyGraphs.deliver];
        const loader = declared[0]!;
        const neighbour = declared[2]!;
        declared[0] = neighbour;
        declared[2] = loader;

        expect(() => assertDeclaredClosure('deliver', declared, readSource)).toThrow(/declared loader/);
    });

    /**
     * The static closure is a deliberate superset of the executed graph: `import type` and
     * `export type ... from` edges are counted even though Node's type stripping erases them, because
     * the same union feeds the governance risk classification and must not shrink. This pins that
     * over-approximation so a future scanner that dropped type-only edges would redden.
     */
    it('should include type-only import edges in the static closure', () => {
        const readSource = (path: string): string | undefined => {
            const fixtures: Record<string, string> = {
                'scripts/entry.ts':
                    "import type { A } from './typeOnly.ts';\nexport type { B } from './reExported.ts';",
                'scripts/typeOnly.ts': 'export type A = string;',
                'scripts/reExported.ts': 'export type B = number;',
            };
            return fixtures[path];
        };

        expect([...trustedLocalImportClosure('scripts/entry.ts', readSource)].sort()).toEqual([
            'scripts/entry.ts',
            'scripts/reExported.ts',
            'scripts/typeOnly.ts',
        ]);
    });

    it('should flag every undo marker: action name, CRDT document, project file, and bootstrap wiring', () => {
        const markers = [
            handwritten('src/modules/AiRuntime/useCases/aiPanelActions/undoLastAction.ts', 6, 1),
            handwritten('src/modules/CrdtDocument/errors/BranchError.ts', 6, 1),
            handwritten('src/app/project.sdaw', 6, 1),
            handwritten('src/app/bootstrap.ts', 6, 1),
        ];

        for (const marker of markers) {
            const result = reviewPlan([marker]);
            expect(result.riskClasses).toEqual(['undo']);
            expect(result.requiredStances).toEqual(['correctness', 'project-integrity-undo', 'test-validity']);
            expect(result.triggers).toContain(`undo:${marker.path}`);
        }
    });

    it('should keep a change at exactly the 200-line budget small', () => {
        const result = reviewPlan([handwritten('src/modules/Transport/models/TempoMap.ts', 150, 50)]);

        expect(result.riskClasses).toEqual(['small']);
        expect(result.requiredStances).toEqual(['correctness', 'test-validity']);
        expect(result.triggers).toContain('small:handwritten-lines<=200');
    });

    it('should require ordinary review one line over the budget, including code craft and module boundaries', () => {
        const result = reviewPlan([handwritten('src/modules/Transport/models/TempoMap.ts', 151, 50)]);

        expect(result.riskClasses).toEqual(['ordinary']);
        expect(result.requiredStances).toEqual(['code-craft', 'correctness', 'module-boundaries', 'test-validity']);
        expect(result.triggers).toContain('ordinary:handwritten-lines>200');
    });

    it('should count only handwritten lines toward the budget', () => {
        const result = reviewPlan([
            handwritten('src/modules/Transport/models/TempoMap.ts', 100, 0),
            changed('public/wasm/manifest.json', 'generated', 900, 400),
            changed('docs/06-testing.md', 'docs', 40, 10),
        ]);

        expect(result.riskClasses).toEqual(['small']);
        expect(result.triggers).toContain('small:handwritten-lines<=200');
    });

    it('should union the stances when a change fires native-security and realtime-audio together', () => {
        const result = reviewPlan([
            handwritten('electron/main/bridge.ts', 10, 1),
            handwritten('crates/daw-dsp/src/lib.rs', 200, 10),
        ]);

        expect(result.riskClasses).toEqual(['native-security', 'realtime-audio']);
        expect(result.requiredStances).toEqual(['correctness', 'realtime-audio', 'security-platform', 'test-validity']);
        expect(result.triggers).toContain('native-security:electron/');
        expect(result.triggers).toContain('native-security:crates/');
        expect(result.triggers).toContain('realtime-audio:crates/daw-dsp/');
    });

    it('should call a docs-only change small, since docs never trigger a specialist class', () => {
        const result = reviewPlan([changed('docs/06-testing.md', 'docs', 12, 3)]);

        expect(result.riskClasses).toEqual(['small']);
        expect(result.requiredStances).toEqual(['correctness', 'test-validity']);
        expect(result.triggers).toEqual(['small:handwritten-lines<=200']);
    });

    it('should call an empty path list small', () => {
        const result = reviewPlan([]);

        expect(result.riskClasses).toEqual(['small']);
        expect(result.requiredStances).toEqual(['correctness', 'test-validity']);
        expect(result.triggers).toEqual(['small:handwritten-lines<=200']);
    });

    it('should require code-craft from the ordinary class alone, never from a small or specialist class', () => {
        const corpus = [
            reviewPlan([handwritten('src/components/SafeMarkdown.tsx', 5, 1)]),
            reviewPlan([changed('scripts/__tests__/reviewDiffSummary.spec.ts', 'tests', 50, 0)]),
            reviewPlan([
                handwritten('src/modules/Transport/models/TempoMap.ts', 5, 1),
                handwritten('src/modules/Arrangement/useCases/addTrack.ts', 5, 1),
            ]),
            reviewPlan([handwritten('src/modules/AudioEngine/engine/BusNode.ts', 5, 1)]),
            reviewPlan([handwritten('electron/main/bridge.ts', 5, 1)]),
            reviewPlan([handwritten('src/modules/AiRuntime/useCases/aiPanelActions/undoLastAction.ts', 5, 1)]),
        ];

        for (const result of corpus) {
            expect(result.requiredStances).toEqual(earned(result.riskClasses));
            expect(result.requiredStances).not.toContain('code-craft');
        }

        const overBudget = reviewPlan([handwritten('src/modules/Transport/models/TempoMap.ts', 201, 0)]);
        expect(overBudget.riskClasses).toEqual(['ordinary']);
        expect(overBudget.requiredStances).toEqual(earned(['ordinary']));
        expect(overBudget.requiredStances).toContain('code-craft');
    });
});

describe('parseReviewRiskPlan', () => {
    const validPlan = planReviewRisk({
        pr: 2999,
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        paths: [handwritten('src/components/SafeMarkdown.tsx', 5, 2)],
    });

    it('should round-trip a plan the policy produced', () => {
        expect(parseReviewRiskPlan(validPlan)).toEqual(validPlan);
        expect(parseReviewRiskPlan(structuredClone(validPlan))).toEqual(validPlan);
    });

    it('should refuse a plan whose requiredStances widens what its riskClasses earn', () => {
        expect(() =>
            parseReviewRiskPlan({
                ...validPlan,
                requiredStances: ['correctness', 'security-platform', 'test-validity'],
            })
        ).toThrow(/requiredStances must equal/u);
    });

    it('should refuse a plan whose requiredStances narrows what its riskClasses earn', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, requiredStances: ['correctness'] })).toThrow(
            /requiredStances must equal/u
        );
    });

    it('should refuse an unsorted requiredStances list', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, requiredStances: ['test-validity', 'correctness'] })).toThrow(
            /requiredStances must be sorted/u
        );
    });

    it('should refuse a duplicated riskClasses entry', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, riskClasses: ['small', 'small'] })).toThrow(
            /riskClasses must not contain duplicates/u
        );
    });

    it('should refuse an unknown riskClasses entry', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, riskClasses: ['ordinary', 'risky'] })).toThrow(
            /riskClasses contains an unknown class/u
        );
    });

    it('should refuse an unknown requiredStances entry', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, requiredStances: ['test-validity', 'vibes'] })).toThrow(
            /requiredStances contains an unknown stance/u
        );
    });

    it('should refuse a blank headSha', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, headSha: '   ' })).toThrow(/headSha/u);
    });

    it('should refuse an empty trigger list', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, triggers: [] })).toThrow(/triggers must not be empty/u);
    });

    it('should refuse a blank trigger', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, triggers: [' '] })).toThrow(/triggers/u);
    });

    it('should refuse a wrong format', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, format: 'risk-plan-v2' })).toThrow(/format/u);
    });

    it('should refuse a non-positive pr', () => {
        expect(() => parseReviewRiskPlan({ ...validPlan, pr: 0 })).toThrow(/pr must be a positive integer/u);
    });

    it('should refuse a value that is not an object', () => {
        expect(() => parseReviewRiskPlan('risk-plan-v1')).toThrow(/must be an object/u);
    });
});
