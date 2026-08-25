# DawInterchange module — Agent Guidelines

Import and export interchange translation between Sourdaw internal project state and the open standard `.dawproject` format (native Sourdaw file persistence belongs to Project and CrdtDocument).

## Public Contract Surface

- `useCases`: `importDawProject`, `pickAndImportDawProject`, `exportDawProject`, `getDawProjectHandlers`.
- Handlers: `getDawProjectHandlers` (`importDawProject`, `exportDawProject`).

## Key Subsystems

- **XML Serialization & Parsing**: Strict parsing and emission of DAWproject XML schemas (`project.xml`, `metadata.xml`) via `parseProjectXml.ts`, `serializeProjectXml.ts`, `parseMetadataXml.ts`, `serializeMetadataXml.ts`.
- **Zip Container Bundling**: `buildDawProjectZip.ts` and `readDawProjectZip.ts` pack and unpack `.dawproject` zip archives containing XML manifests and embedded audio assets.
- **Asset Translation & Mapping**: `decodeDawProjectAssets.ts` and `mapToProjectData.ts` map DAWproject tracks, channels, clips, time signatures, automation curves, and audio files to Sourdaw's `ProjectData` interchange contract.
- **File Dialog Adapters**: `repositories/saveDawProjectFileDialog.ts` and `repositories/writeDawProjectFile.ts` provide native desktop file dialogs (Tauri) with fallback to browser blob downloads.

## Invariants & Traps

- **DAWproject Schema Conformance**: Strict adherence to Bitwig / PreSonus DAWproject XML specification for tracks, clips, automation curves, and device metadata.
- **Asset Path Normalization**: Audio references in the zip container must live under the `audio/` path and be decoded with accurate channel counts and sample rates without audio buffer loss.
- **Round-Trip Fidelity**: Project interchange translation must preserve track order, clip boundaries, tempo maps, and plugin/mixer parameters where mapped.
- **Platform Isolation**: File system operations must switch cleanly between native desktop IPC and browser download streams without leaking Node/Tauri dependencies into web builds.

## Verification

```bash
pnpm vitest run src/modules/DawInterchange
```
