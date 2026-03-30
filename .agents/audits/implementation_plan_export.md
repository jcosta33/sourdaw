# Export Architecture Repair & Bakery UI Redesign

This implementation plan outlines the fixes required to restore the Sourdaw export process (for audio and project files) across both Web and Desktop platforms, alongside a complete UI overhaul of the Export Dialog to align with Sourdaw's "bakery-themed" aesthetic.

## User Review Required

> [!WARNING]  
> The web-based fix requires asking the user for their desired save-location **before** beginning the audio export render. Currently, Sourdaw renders out the mixdown to memory for several minutes, and *then* asks where to drop the file. We are reversing this exact order. Due to browser security tokens expiring within 5 seconds of a click interaction, it's the only way to avoid the `showSaveFilePicker` timing out and failing to present a dialog.

## Proposed Changes

### Core Export Logic 

#### [MODIFY] `src/modules/Project/useCases/projectPersistence/downloadProjectFile.ts`
- Detect `isTauri`. If true, utilize `@tauri-apps/plugin-dialog` to natively procure a file path, and use `@tauri-apps/plugin-fs` to write the `.sourdaw` JSON buffer directly to the local filesystem.
- For the Web fallback, remove the suppressing `catch { return; }` logic. If `showSaveFilePicker` throws an error not related to user cancellation (i.e. browser timeout or security environment drop), the system will successfully fallback to the HTML anchor `<a download>` blob click mechanism.

#### [MODIFY] `src/modules/AudioEngine/repositories/audioEncoders/wavEncoder.ts`
#### [MODIFY] `src/modules/AudioEngine/repositories/audioEncoders/mp3Encoder.ts`
#### [MODIFY] `src/modules/AudioEngine/repositories/audioEncoders/flacEncoder.ts`
- Implement identical adjustments: bypass `triggerBlobDownload` entirely on the desktop (Tauri) and execute `writeFile()` streams.
- Refactor the Web process to correctly bubble structural exceptions back up if the fallback fails, triggering a unified failure notification instead of silently returning an empty promise. 
- *Note:* The actual instantiation of the native Save File Picker or the Anchor Click logic will be hoisted out to happen at the beginning of the interaction instead, handled correctly inside the Export flow.

---

### The "Bakery" Export UI Overhaul

#### [MODIFY] `src/modules/Project/presentations/views/ExportDialog.tsx`
Redesign the `ExportDialog` component to embrace Sourdaw's "Baking" theme, elevating its visual aesthetics from a basic generic gray modal to a dynamic, vibrant centerpiece.
- **Tongue in Cheek Re-theming**:
  - `Export Audio` → `The Bakery` (or `Baking Audio`)
  - `Mixdown` → `Whole Loaf` (Master)
  - `Stems` → `Sourdough Slices` (Individual Tracks)
  - `Cancel Export` → `Turn off the Oven`
  - Render Button → `Start Baking` 🥖
- **Color Aesthetics**: 
  - Introduce glowing warm accents (amber, orange, glowing reds).
  - Use dynamic pulsing/glowing styles for the "Baking" progress state, visualizing heat and creation.
- **Improved Loading States**:
  - Replace the generic static progress bar with a vibrant animated `progress` bar that has glowing drop-shadows.
  - Detail precisely what step of "proofing" or "baking" the engine is currently processing.
- **Workflow Restructuring**: 
  - *Web execution:* Restructure the button event so that clicking "Start Baking" immediately asks the user to pick a target save folder/file (`showSaveFilePicker`), secures the `WritableFileStream` descriptor into memory, and *then* triggers the massive offline CPU rendering function, bypassing timeout restrictions. 

## Open Questions

> [!CAUTION]  
> If the user selects "Slices" (Stems), and they have selected multiple formats (WAV + MP3), downloading dozens of individual files on the web natively is tricky because `showSaveFilePicker` only returns a single file handle. 
> 
> My recommendation for **Web Stems**: We utilize `showDirectoryPicker` to request an overarching output folder, and then stream the files into it. If that is unavailable entirely upon fallback, we must generate a ZIP archive containing the stems. Would you prefer a ZIP archive handler integration, or just falling back to spawning 10 tabs simulating 10 individual `href` downloads simultaneously? 

## Verification Plan

### Automated / Manual Verification
1. Open Sourdaw locally on the Development Desktop `.app` build natively.
2. Launch `The Bakery` inside Sourdaw and "bake" a WAV Mixdown.
3. Validate that the Rust/Tauri dialog window intercepts the request seamlessly, providing the file cleanly upon completion to the system without silently stalling.
