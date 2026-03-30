# Export Feature Technical Audit

After conducting a comprehensive top-to-bottom audit of the entire codebase's export mechanisms, I have identified that the core underlying architecture for file persistence is flawed. This isn't just limited to audio exports; it affects every single mechanism that attempts to save a generated file to the user's hard drive.

## Files Implicated:
1. `src/modules/AudioEngine/repositories/audioEncoders/wavEncoder.ts`
2. `src/modules/AudioEngine/repositories/audioEncoders/mp3Encoder.ts`
3. `src/modules/AudioEngine/repositories/audioEncoders/flacEncoder.ts`
4. `src/modules/Project/repositories/project/downloadProjectFile.ts`

## Critical Technical Flaws

### 1. The Fallback Swallow (`try/catch` suppression)
Every one of the files listed above implements an identical helper function (e.g. `triggerBlobDownload` or inline logic in `downloadProjectFile`) with the following structure:
```typescript
if ('showSaveFilePicker' in window) {
    try {
        const handle = await window.showSaveFilePicker({...});
        // Write the blob
        return;
    } catch {
        // ERROR IS HERE:
        return; 
    }
}
// Unreachable if showSaveFilePicker exists but throws.
const url = URL.createObjectURL(blob);
a.click();
```
* **The Problem:** `showSaveFilePicker` can throw errors in many scenarios beyond simple user cancellation:
  - If it is triggered natively without a strict transient user activation token (e.g., clicking export, waiting 2 minutes for rendering, and *then* attempting to show the picker).
  - If it's executed inside a generic WebView/WKWebView wrapper like Tauri that doesn't fully support the File System Access API.
* **The Result:** The `catch` block intercepts the security error and blindly `return`s. The user never sees the browser's save picker, and the fallback `<a href="...">` method is permanently bypassed. The export silently vaporizes.

### 2. User Activation Timeout 
As previously noted, `showSaveFilePicker` and `a.click()` enforce strict execution windows. Because Sourdaw renders audio *before* requesting the file destination, the initial "Export" button click gesture token expires. The browser correctly categorizes the delayed popup file picker or the download element click as unsolicited and blocks it.

### 3. Tauri Extrusion
In the compiled desktop application, `window.showSaveFilePicker` behaves unpredictably and automatic downloads via HTMLAnchorElements are stripped or trapped within the WebKit container depending on OS policies. The desktop app lacks the required bindings to the native filesystem.

---

## Technical Practical Solutions

### Fix 1: Universal Tauri Integrations
Since the packages `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` are already installed in Sourdaw, any file persistence event should instantly query `isTauri`. 
* If `isTauri` is true, Sourdaw MUST use the native rust bindings:
  1. `await save({ filters: ... })` from Tauri Dialog to procure a destination path.
  2. `await writeFile(path, new Uint8Array(blobData))` from Tauri FS to bypass the blob URL altogether.

### Fix 2: Pre-Emptive Web Allocation
On browsers, we cannot delay the save picker.
* **For Project Exports:** These are instantaneous. However, we must ensure if `showSaveFilePicker` errors, we explicitly catch `AbortError` (user cancellation), but if it's another error, we successfully proceed to the `<a download>` fallback instead of blindly returning.
* **For Audio Exports:** We MUST ask for the file destination *prior* to beginning the OfflineRender process.
  * *Option A:* When the user hits Export, show `showSaveFilePicker()`, obtain the `FileSystemWritableFileStream`, commence rendering, chunk write via `flush`, and then `close()`.
  * *Option B:* If using `<a download>`, we might need to open a `window.open('about:blank')` at the exact moment of click, execute the offline render, then alter the location of that generic tab to the Blob URL to circumvent the timer loss.

By implementing the Tauri native plugins for the desktop and correctly managing user activation for the Web, export stability will be definitively restored across both platforms.

---

## UI/UX Design Audit & Overhaul

The current interface provided by `ExportDialog.tsx` is completely isolated from the "tongue in cheek" bakery theming that characterizes Sourdaw's core identity (Levain, Gluten, Yeast, Crumb). 

### UX Analysis: Identifying the "Weakness"
1. **Generic Identity:** The modal is essentially a plain `shadcn/ui` dialog using a dark slate/gray generic gradient `linear-gradient(180deg, #080808 0%, #0e0e0e 100%)`.
2. **Clinical Copywriting:** Strings like "Mode: Mixdown / Stems" and "Format: WAV / MP3" are technically accurate but lack Sourdaw’s playful character. 
3. **Sterile Loading States:** The existing progress bar is a minimalist `h-1.5 bg-primary` strip. Considering the render can stall the browser for a full minute, such a clinical loading state fails to engage the user emotionally during a high-friction wait period.
4. **Poor Contrast Hierarchy:** The options are tightly boxed in grids (`grid-cols-3` and `grid-cols-2`), producing a cluttered "technical settings" form instead of an exciting "culmination/release" experience for the user completing a musical track.

### Proposed Aesthetic Refactor ("The Bakery" Model)
To fix this, the entire Export modal should be reskinned as **"The Bakery"**.

* **Thematic Lexicon Adjustments**:
  * **"Export Audio"** becomes **"The Bakery"** (or **"Baking Audio"**).
  * **"Mixdown"** becomes **"Whole Loaf"** (Master Render).
  * **"Stems"** becomes **"Slices"** (Individual Tracks).
  * **"Cancel"** becomes **"Turn Off Oven"**.
  * **"Export"** becomes **"Start Baking"**.
* **Vibrant Palette System**:
  * Replace the grayscale gradients with warm, glowing accents using Tailwind palettes (`orange-500`, `amber-600` blending into dark obsidian backgrounds).
  * Introduce subtle inner box shadows that mimic glowing "oven heat" when a user presses "Start Baking".
* **Immersive Animated Loading State**:
  * The progress bar will be expanded into a larger, dynamic UI element.
  * As progress ticks up, the UI will reflect "Proofing", "Kneading Dough", and "Baking" states.
  * Use pulsing SVGs or `lucide-react` icons (like `Flame` or custom heat lines) to communicate that Sourdaw is actively crunching high-intensity audio rendering in real-time.
