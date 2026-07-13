---
type: bug
id: BUG-windows-native-path-basename
title: Native Windows paths are displayed as full paths instead of basenames
status: fixed
owner: The Sourdaw team
sources:
  - "Transient finding: deep-codebase-risk-audit-2026-06-27"
  - SPEC-sample-library
  - SPEC-chrome-first-capability
---

# Bug: Native Windows paths are displayed as full paths instead of basenames

## Symptom

Native/Tauri file and folder paths that use Windows backslashes keep the whole absolute path as the visible file or folder name.

This affects at least connected Sample Library roots, Crumbs sample metadata, and Tauri file picker `File.name` values.

## Reproduction

1. From `/Users/josecosta/dev/sourdaw`, run this minimal reproduction of the current basename expression:

```text
node - <<'NODE'
const paths = [String.raw`C:\Users\jose\Samples`, String.raw`D:\Loops\kick.wav`];
for (const value of paths) {
  const current = value.split('/').pop() ?? value.split('\\').pop() ?? value;
  const corrected = value.split(/[\\/]/).pop() ?? value;
  console.log(`${value} -> current:${current} corrected:${corrected}`);
}
NODE
```

**Expected:** `C:\Users\jose\Samples` displays as `Samples`, and `D:\Loops\kick.wav` displays as `kick.wav`.
**Actual:** the current expression returns the full Windows path.
**Conditions:** Reproduced on 2026-06-27 from the local `sourdaw` working tree with Node.

```text
C:\Users\jose\Samples -> current:C:\Users\jose\Samples corrected:Samples
D:\Loops\kick.wav -> current:D:\Loops\kick.wav corrected:kick.wav
```

The same pattern is present in source:

```text
/Users/josecosta/dev/sourdaw/src/modules/SampleLibrary/useCases/connectFolder/connectFolder.ts:50:        const folderName = selected.split('/').pop() ?? selected.split('\\').pop() ?? selected;
/Users/josecosta/dev/sourdaw/src/modules/Project/repositories/nativeFileDialog/pickFiles.ts:80:                const name = param.split('/').pop() ?? param.split('\\').pop() ?? param;
/Users/josecosta/dev/sourdaw/src/modules/Crumbs/useCases/loadSample.ts:81:        const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
```

## Root cause

`src/modules/SampleLibrary/useCases/connectFolder/connectFolder.ts:50`, `src/modules/Project/repositories/nativeFileDialog/pickFiles.ts:80`, and `src/modules/Crumbs/useCases/loadSample.ts:81` all call `value.split('/').pop()` first. For a Windows path with no forward slash, `.pop()` returns the original full string, so the `?? value.split('\\').pop()` fallback never executes.

## Affected requirements

- `SPEC-sample-library#AC-015` - the user-library root flow should not register a Tauri-selected folder with the full absolute path as its display name.
- `SPEC-chrome-first-capability#AC-004` - this is current evidence that raw platform filesystem path handling is duplicated at call sites instead of routed through one adapter/normalization boundary.
