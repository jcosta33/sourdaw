# Standing probes: packaging hook lifecycle

A packaging hook consumes a builder's intermediate state, which can change before the hook runs. A raw archive
fixture or a successful unrelated native-artifact check does not establish that state.

## Standing probes

1. **A hook must consume the builder's actual post-cleanup files (#6285).** The electron-builder dependency
   upgrade moved and renamed Electron legal files before `afterExtract`, while staging still read macOS
   `out/LICENSE`. Trace the installed builder from `prepareApplicationStageDirectory` through its cleanup and
   the subsequent `emitAfterExtract`, including platform-specific moves and renames. Drive the production
   one-argument `createAfterExtract` hook with that post-cleanup layout: macOS has `LICENSE.electron.txt` and
   `LICENSES.chromium.html` in `Electron.app/Contents/Resources`; Windows and Linux retain the renamed license
   and notices at `appOutDir`. Require pinned bytes under `Resources/legal`, then verify them after the macOS
   bundle rename. Missing and altered inputs must fail, as must an unpinned target. In a clean committed lane,
   revert only the macOS source root and license name to the pre-fix `appOutDir` and `LICENSE` behavior; run
   `pnpm guard --profile focused -- pnpm test:run scripts/__tests__/stageElectronLegalFiles.spec.ts` and require
   the darwin staging case to fail with ENOENT. Keep the pinned digest checks, final staged-file verification,
   native artifact admission and fuse readback. This focused fixture proves the hook against the modeled builder
   layout; it does not prove a native package build or signing. Read the relevant native packaging CI on the head
   for those claims.

## Scope

This class covers the ordering and intermediate filesystem contract between a third-party packaging framework
and a hook. Native-artifact identity probes establish binary target and kind, not whether cleanup moved a hook's
inputs. This observed lifecycle escape stands separately rather than inventing additional probes to reach a count.
