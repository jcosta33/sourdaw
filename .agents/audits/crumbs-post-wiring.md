# Post-Wiring Audit: Crumbs (Sampler) Plugin

## Status
- [x] Rename refactor complete (Sampler -> Crumbs).
- [x] Audio graph integration complete (rtrb, Arc, atomics).
- [x] Multi-instance frontend stores.
- [x] **Performance Issue Resolved:** 60fps React re-renders eliminated in `CrumbsPanel`.

## Aggressive Review Findings & Actions

### 1. Frontend Performance (Issue 5 in original audit)
- **Problem:** `CrumbsPanel` was re-rendering 60 times per second due to cursor updates.
- **Action:** Moved cursor animation to `WaveformDisplay` using direct DOM manipulation.
- **Architectural Fix:** Passed `onPositionSubscribe` as a prop from the View to the Component to avoid cross-module internal imports.

### 2. Store Lifecycle
- **Problem:** Stores were leaking memory by never removing device state.
- **Action:** Implemented `removeInstance` logic in all Crumbs stores and wired it to `teardownCrumbsEngine`.

### 3. Error Handling
- **Status:** Basic logging implemented. Future work could include a "Device Error" state in the store.

### 4. Code Quality
- **Status:** High. Strict multi-instance isolation achieved across the entire stack.

## Conclusion
The Crumbs plugin is now architecturally sound, performance-optimized, and fully integrated into the DAW's native audio engine.
