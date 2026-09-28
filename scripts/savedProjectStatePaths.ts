/**
 * One surface registry for saved-project state and undo, shared by the review risk policy
 * (`reviewRiskPolicy.ts`) and the semantic review's three project-state rules
 * (`semanticReview/rules.ts`), so the two can no longer disagree about which paths carry that
 * responsibility. The registry holds each surface once, tagged with the view(s) it belongs to:
 *
 * - `undo` — the risk policy's `undo` risk class. Its scope is unchanged from the policy's original
 *   predicate, except that the `undo` marker now matches a path word rather than a bare substring
 *   (a false-positive correction: `crumbsAllSoundOff.ts` no longer matches).
 * - `persisted-state` — the three project-state rules. It is the `undo` view plus the Project
 *   module's persisted-shape, migration, repair, and persisted-slot owners and the composition-root
 *   files that wire them.
 *
 * Both predicates fold over the same registry, and the rules digest is a lossless encoding of each
 * persisted-state matcher (kind plus every field) rather than a rendered glob, so editing a matcher
 * changes what the rules match and the digest together, never one without the other.
 *
 * Case decision: matching is case-insensitive. The path is lowercased before substring, prefix,
 * suffix, and exact matches, and the `wordPrefix` match searches the lowercased path while reading
 * word boundaries off the original casing (so a camelCase boundary still counts). A correctly cased
 * and a mis-cased path classify alike.
 */

/** One shape a matcher implements. */
export type SavedProjectStateMatcher =
    | { readonly kind: 'wordPrefix'; readonly value: string }
    | { readonly kind: 'substring'; readonly value: string }
    | { readonly kind: 'prefix'; readonly value: string }
    | { readonly kind: 'suffix'; readonly value: string }
    | { readonly kind: 'prefixAndSubstring'; readonly prefix: string; readonly substring: string }
    | { readonly kind: 'exact'; readonly value: string };

export type SavedProjectStateScope = 'undo' | 'persisted-state';

export type SavedProjectStateSurface = {
    readonly matcher: SavedProjectStateMatcher;
    readonly scopes: readonly SavedProjectStateScope[];
};

function assertUnreachableMatcher(matcher: never): never {
    throw new Error(`unhandled saved-project-state matcher kind: ${JSON.stringify(matcher)}`);
}

function isAsciiLower(char: string): boolean {
    return char >= 'a' && char <= 'z';
}

function isAsciiUpper(char: string): boolean {
    return char >= 'A' && char <= 'Z';
}

function isAsciiDigit(char: string): boolean {
    return char >= '0' && char <= '9';
}

function isSeparator(char: string): boolean {
    return char === '/' || char === '-' || char === '_' || char === '.' || char === ' ';
}

/**
 * A word starts at the beginning of the path, after a segment separator (`/ - _ .` or a space), or at
 * a camelCase boundary (lowercase to uppercase, or a letter/digit transition). `wordPrefix` matches a
 * value only at such a start, so `undo` matches `undoLastAction` and `getUndoRedoHandlers` but not the
 * `soundOff` of `crumbsAllSoundOff` (whose `undo` begins mid-word).
 */
function isWordStartChar(path: string, index: number): boolean {
    if (index === 0) {
        return true;
    }
    const previous = path[index - 1]!;
    const current = path[index]!;
    if (isSeparator(previous)) {
        return true;
    }
    if (isAsciiLower(previous) && isAsciiUpper(current)) {
        return true;
    }
    return isAsciiDigit(previous) !== isAsciiDigit(current);
}

function matchesWordPrefix(path: string, value: string): boolean {
    const lower = path.toLowerCase();
    let index = lower.indexOf(value);
    while (index !== -1) {
        if (isWordStartChar(path, index)) {
            return true;
        }
        index = lower.indexOf(value, index + 1);
    }
    return false;
}

function matchesMatcher(path: string, matcher: SavedProjectStateMatcher): boolean {
    const lower = path.toLowerCase();
    switch (matcher.kind) {
        case 'wordPrefix':
            return matchesWordPrefix(path, matcher.value);
        case 'substring':
            return lower.includes(matcher.value);
        case 'prefix':
            return lower.startsWith(matcher.value);
        case 'suffix':
            return lower.endsWith(matcher.value);
        case 'prefixAndSubstring':
            return lower.startsWith(matcher.prefix) && lower.includes(matcher.substring);
        case 'exact':
            return lower === matcher.value;
        default:
            return assertUnreachableMatcher(matcher);
    }
}

/**
 * The single surface registry.
 *
 * Persisted-state owners, from their sources:
 * - `undo` (word): a path whose name declares undo ownership — the Command module's undo engine and
 *   undo tree, CrdtDocument's action history, and any other undo action.
 * - `crdtdocument` (substring): the full `src/modules/CrdtDocument/` module, whose `AGENTS.md`
 *   documents Automerge persistence, `.sdaw` bundle encoding, durable branch-state authority, and
 *   semantic action history/undo, with every persistent write routed through `mutateCrdtDoc`.
 * - the project-persistence use cases and repositories the risk policy lists (#3377 AC-009
 *   calibration): the layer that actually writes saved projects.
 * - `.sdaw`: the saved-project bundle shape.
 * - the `src/app/` bootstrap surface and the composition files that wire persisted state
 *   (`main.tsx`, `registerDependencies.ts`, `resolveAppComposition.ts`).
 * - `migration`, `repairprojectdata`, `projectdata`: the canonical `.sourdaw` schema and version
 *   contract (`ProjectData.ts`), its migrations (`VcaTrackMigration.ts` and other modules' legacy
 *   migrations), and its repair (`repairProjectData`, `handleRepairProjectData`).
 * - `projectstore`, `arrangementstore`, `productionbrief`, the `recentProjects/` use cases: the
 *   persisted CRDT slots (`projectStore`'s durable `projectMeta` keys, `arrangementStore`'s
 *   `arrangements` slot, the `productionBrief` durable key) and the recent-projects persistence.
 * - the Project module's direct persisted-slot writers and saved-project creators whose names carry
 *   none of the markers above: the `useCases/arrangement/` snapshot/edit use cases (which write
 *   `arrangementStore` and clear undo history), the metadata and tuning writers (`setProjectKeyRoot`,
 *   `setProjectScaleName`, `importSclFile`, `finishProjectLoading`, `reportProjectLoadFailure`,
 *   `createFreshProjectMetadata`, `setTrackCanonicalRole`), the production-brief writers
 *   (`acceptCreativeIntent`, `unlockProjectScopedBrief`), the project-template handler
 *   (`handleCreateProjectFromTemplate`), the persisted-store barrel
 *   (`stores/index.ts`), and the composition-root handler-map registration
 *   (`src/app/getProductionCommandHandlerMaps.ts`).
 * - `projectversioning`: the ProjectVersioning module's persisted-shape and snapshot/restore owners —
 *   the `stores/versionControlStore.ts` `sourdaw-version-control` localStorage slot and its
 *   `stores/index.ts` barrel, `models/ProjectVersion.ts` (the version/snapshot/branch shape), the
 *   `snapshotHelpers/captureSnapshot.ts` serializer and `snapshotHelpers/restoreSnapshot.ts` hydrator
 *   (which writes the track, marker, transport, MIDI and automation stores), the version lifecycle
 *   (`createProjectVersion`, `restoreVersion`, `autoSaveVersion`), branching (`createVersionBranch`,
 *   `switchBranch`, `deleteBranch`), tagging (`tagVersion`, `removeTag`), the `setAutoSaveInterval`
 *   writer, and the three version-control handlers that route those mutations.
 * - the Project module's template and demo writers, whose own sources write persisted CRDT slots or
 *   replace the saved project: the `templateFiles/` builders (each runs `initProject` then
 *   `finalizeTemplate`), the `templateDefinitions/createFromTemplate.ts` replacement and the
 *   `templateDefinitions/applyProjectTemplate.ts` app-action entry, the writing `templateHelpers/`
 *   (`initProject`, `addMarkers`, `addSections`, `setChordProgression`, `setGroove`,
 *   `finalizeTemplate`, `commitVcaGroups`, `configureYeastArpeggiator`), and the demo writers
 *   `demoUtils/syncArrangement.ts` and `nebulaDrift/createNebulaDriftDemo.ts`.
 *
 * Deliberately not matched, with no persisted-project or undo ownership documented in their own
 * `AGENTS.md`: `MIDI/` and `Arrangement/` beyond their migration files, `Command/` beyond its undo
 * files, the Project module's presentation views (`presentations/views/`), its semantic queries
 * (`semanticProjectQueries`, `semanticProjectIndex`, `semanticRangeOverlap`,
 * `getSemanticProjectIndexDiagnostics`, `parseSemanticProjectQueryInput`, the `SemanticProjectQuery`
 * model), its creative-brief read surfaces (`collectProtectedScopes`, `getProjectScopedBriefLock`,
 * `isProjectWideScope`, `getDurableProjectOwnerId`, `getCanonicalTrackRole`,
 * `getCanonicalTrackRoleOptions`, the `CanonicalTrackRole` model), its agent discovery and
 * agent-facing query surfaces (`services/agentDiscovery/`, `useCases/agentDiscovery/`,
 * `queryAgentDiscovery`, `parseAgentDiscoveryInput`, `agentCapabilityDiscoveryPort`,
 * `agentAssetFileBoundary`, `getAgentProjectModelContract`, `getProjectProtocolContracts`,
 * `createBoundedRevisionToken`, the `AgentDiscoveryQuery` and `AgentProjectModelContract` models),
 * its template registry and read surfaces (`useCases/projectTemplates/templateDefinitions/helpers.ts`
 * and `getTemplates.ts`), the pure in-memory track/device factories in
 * `useCases/projectTemplates/templateHelpers/` (`buildDevice`, `createAudioTrack`,
 * `createInstrumentTrack`, `createBus`, `createFolder`, `createVca`, `addSend`,
 * `attachSidechainCompressor`, `addDeviceChain`, `setMasterChain`), the template preview data
 * (`useCases/projectTemplates/templatePreviews/previewLoops.ts`), the demo in-memory builders
 * (`useCases/demoProjects/demoUtils/applyPreset.ts`, `createMidiClip.ts`, `note.ts`), the
 * `ProjectTemplateTypes` and `DemoProjectTypes` models, its session-scoped stores
 * (`missingMediaStore`, `projectLoadFailureStore`), its read-only barrels and handler assembly
 * (`events/index.ts`, `useCases/index.ts`, `getProjectHandlers`), its file dialog and runtime
 * detection (`fileDialog`, `isNativeProjectRuntimeAvailable`), ProjectVersioning's read-only
 * version queries (`useCases/versionControl/queries/getBranchCount`, `getCurrentBranchName`,
 * `getVersionCount`, `getVersionHistory`) and its `snapshotHelpers/getActiveCheckpointOwnerId`
 * read, ProjectVersioning's handler-map assembly (`getVersionControlHandlers`) and
 * `useCases/index.ts` barrel (it owns no presentations), and the rest of `src/app/` (router,
 * query client, error handlers, notification bus, native device state, browser display, agent
 * production-readiness and protocol manifest, startup error surfaces) that wires no persisted state.
 */
export const SAVED_PROJECT_STATE_SURFACES: readonly SavedProjectStateSurface[] = [
    { matcher: { kind: 'wordPrefix', value: 'undo' }, scopes: ['undo', 'persisted-state'] },
    { matcher: { kind: 'substring', value: 'crdtdocument' }, scopes: ['undo', 'persisted-state'] },
    {
        matcher: { kind: 'prefix', value: 'src/modules/project/usecases/projectpersistence/' },
        scopes: ['undo', 'persisted-state'],
    },
    {
        matcher: { kind: 'prefix', value: 'src/modules/project/repositories/' },
        scopes: ['undo', 'persisted-state'],
    },
    { matcher: { kind: 'suffix', value: '.sdaw' }, scopes: ['undo', 'persisted-state'] },
    {
        matcher: { kind: 'prefixAndSubstring', prefix: 'src/app/', substring: 'bootstrap' },
        scopes: ['undo', 'persisted-state'],
    },
    { matcher: { kind: 'wordPrefix', value: 'migration' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'substring', value: 'repairprojectdata' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'wordPrefix', value: 'projectdata' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'wordPrefix', value: 'productionbrief' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'wordPrefix', value: 'projectstore' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'wordPrefix', value: 'arrangementstore' }, scopes: ['persisted-state'] },
    {
        matcher: { kind: 'prefix', value: 'src/modules/project/usecases/recentprojects/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'prefix', value: 'src/modules/project/usecases/arrangement/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/setprojectkeyroot.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/setprojectscalename.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/importsclfile.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/finishprojectloading.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/reportprojectloadfailure.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/createfreshprojectmetadata.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/settrackcanonicalrole.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/acceptcreativeintent.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/project/usecases/unlockprojectscopedbrief.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/handlers/projecttemplate/handlecreateprojectfromtemplate.ts',
        },
        scopes: ['persisted-state'],
    },
    { matcher: { kind: 'exact', value: 'src/modules/project/stores/index.ts' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'exact', value: 'src/app/main.tsx' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'exact', value: 'src/app/registerdependencies.ts' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'exact', value: 'src/app/resolveappcomposition.ts' }, scopes: ['persisted-state'] },
    { matcher: { kind: 'exact', value: 'src/app/getproductioncommandhandlermaps.ts' }, scopes: ['persisted-state'] },
    {
        matcher: { kind: 'prefix', value: 'src/modules/project/usecases/projecttemplates/templatefiles/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatedefinitions/createfromtemplate.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatedefinitions/applyprojecttemplate.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/initproject.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/addmarkers.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/addsections.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/setchordprogression.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/setgroove.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/finalizetemplate.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/commitvcagroups.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/projecttemplates/templatehelpers/configureyeastarpeggiator.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/demoprojects/demoutils/syncarrangement.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/project/usecases/demoprojects/nebuladrift/createnebuladriftdemo.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'prefix', value: 'src/modules/projectversioning/stores/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'prefix', value: 'src/modules/projectversioning/handlers/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'prefix', value: 'src/modules/projectversioning/usecases/versioncontrol/branching/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'prefix', value: 'src/modules/projectversioning/usecases/versioncontrol/tagging/' },
        scopes: ['persisted-state'],
    },
    {
        matcher: { kind: 'exact', value: 'src/modules/projectversioning/models/projectversion.ts' },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/projectversioning/usecases/versioncontrol/createprojectversion.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/projectversioning/usecases/versioncontrol/restoreversion.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/projectversioning/usecases/versioncontrol/autosaveversion.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/projectversioning/usecases/versioncontrol/snapshothelpers/capturesnapshot.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/projectversioning/usecases/versioncontrol/snapshothelpers/restoresnapshot.ts',
        },
        scopes: ['persisted-state'],
    },
    {
        matcher: {
            kind: 'exact',
            value: 'src/modules/projectversioning/usecases/versioncontrol/queries/setautosaveinterval.ts',
        },
        scopes: ['persisted-state'],
    },
];

function matchersFor(scope: SavedProjectStateScope): readonly SavedProjectStateMatcher[] {
    return SAVED_PROJECT_STATE_SURFACES.filter((surface) => surface.scopes.includes(scope)).map(
        (surface) => surface.matcher
    );
}

/** Whether a path owns undo — the risk policy's `undo` risk class. */
export function isUndoPath(path: string): boolean {
    return matchersFor('undo').some((matcher) => matchesMatcher(path, matcher));
}

/** Whether a path owns persisted project state — the three project-state rules' scope. */
export function isPersistedProjectStatePath(path: string): boolean {
    return matchersFor('persisted-state').some((matcher) => matchesMatcher(path, matcher));
}

/**
 * A lossless digest encoding of one matcher: its kind and every field. Two matchers that would render
 * the same glob — a `.sdaw` suffix versus a wildcard prefix — still encode differently, so a matcher
 * edit that changes what the predicate matches necessarily changes the rules digest.
 */
export function renderSavedProjectStateMatcherDigest(matcher: SavedProjectStateMatcher): string {
    switch (matcher.kind) {
        case 'wordPrefix':
            return `wordPrefix:${matcher.value}`;
        case 'substring':
            return `substring:${matcher.value}`;
        case 'prefix':
            return `prefix:${matcher.value}`;
        case 'suffix':
            return `suffix:${matcher.value}`;
        case 'prefixAndSubstring':
            return `prefixAndSubstring:${matcher.prefix}\u0000${matcher.substring}`;
        case 'exact':
            return `exact:${matcher.value}`;
        default:
            return assertUnreachableMatcher(matcher);
    }
}

/**
 * The digest input for the three project-state rules: the lossless encodings of the persisted-state
 * matchers, in registry order. `computeRulesDigest` folds this list into the question identity.
 */
export const SAVED_PROJECT_STATE_DIGEST_ENTRIES: readonly string[] = matchersFor('persisted-state').map(
    renderSavedProjectStateMatcherDigest
);
