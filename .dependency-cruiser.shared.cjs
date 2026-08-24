/* SPDX-FileCopyrightText: Copyright Sourdaw Ltd. */
/* SPDX-License-Identifier: Apache-2.0 */

const SOURCE_FILE_RE = '[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
const SPEC_FILE_RE = '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
const STORY_FILE_RE = '[.]stories[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';

// Group 1 = prefix (including an optional Common/Supporting namespace)
// Group 2 = module name
const MODULE_ROOT = '^(src/modules/(?:Common/|Supporting/)?)([^/]+)/';

const MODULE_REPOSITORY_ROOT =
    '^src/modules/(?:Common/|Supporting/)?[^/]+/repositories(?:/|$)';
const DESKTOP_BRIDGE_PATH = '^src/utils/desktopBridge\\.ts$';
const DESKTOP_BRIDGE_TEST_PATH = '^src/utils/__tests__/desktopBridge\\.spec\\.ts$';
const MODEL_PATH_PREFIX = '^(?:src/modules/(?:Common/|Supporting/)?[^/]+/models/)';

// A model path is valid only when every segment starts with an uppercase
// letter. `__tests__/` descendants and the module-level models/index.ts barrel
// are the explicit test/support shapes that remain valid lowercase paths in
// the current tree. The filesystem preflight applies the same policy to files
// dependency-cruiser cannot reach through an import edge.
const MODEL_CASING_PATH = `${MODEL_PATH_PREFIX}(?:[^A-Z/]|.*\\/[^A-Z/])`;
const MODEL_TEST_SUPPORT_PATH =
    `${MODEL_PATH_PREFIX}(?:__tests__|.*\\/__tests__)(?:/|$)`;
const MODEL_SUPPORT_BARREL_PATH = `${MODEL_PATH_PREFIX}index\\.ts$`;

const DESKTOP_IPC_ONLY_IN_REPOSITORIES = {
    name: 'desktop-ipc-only-in-repositories',
    severity: 'error',
    comment:
        'Desktop IPC (invoke, listen, channel APIs) may only originate from module-root repositories or the exact ' +
        'src/utils/desktopBridge.ts adapter. All other src/** origins and bridge callers are forbidden, including ' +
        'nested useCases/repositories and presentations/repositories paths. The @tauri-apps pattern stays as a ' +
        'reintroduction guard: the dependency is deleted, and any import of it anywhere is an error.',
    from: {
        path: '^src/.+' + SOURCE_FILE_RE,
        // The main cruise excludes specs. The test-inclusive cruise permits
        // only this exact adapter spec to mock the adapter's own dependencies;
        // it is not a general test exemption. Other test origins remain
        // constrained.
        pathNot: [MODULE_REPOSITORY_ROOT, DESKTOP_BRIDGE_PATH, DESKTOP_BRIDGE_TEST_PATH],
    },
    to: {
        path: `(/@tauri-apps/|${DESKTOP_BRIDGE_PATH})`,
    },
};

const MODELS_MUST_BE_TITLE_CASE = {
    name: 'models-must-be-title-case',
    severity: 'error',
    comment:
        'Every directory and file segment below models/ must start with an uppercase letter. The exact models/index.ts ' +
        'support barrel and __tests__/ descendants are intentionally exempt.',
    from: {},
    to: {
        path: MODEL_CASING_PATH,
        pathNot: [MODEL_TEST_SUPPORT_PATH, MODEL_SUPPORT_BARREL_PATH],
    },
};

module.exports = {
    MODEL_CASING_PATH,
    MODEL_PATH_PREFIX,
    MODEL_SUPPORT_BARREL_PATH,
    MODEL_TEST_SUPPORT_PATH,
    MODELS_MUST_BE_TITLE_CASE,
    MODULE_ROOT,
    SOURCE_FILE_RE,
    SPEC_FILE_RE,
    STORY_FILE_RE,
    DESKTOP_IPC_ONLY_IN_REPOSITORIES,
};
