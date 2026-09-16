// Crumbs/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.
//
// Read-only: the mirror and its reader. Writing an attachment is a use case
// (`markCrumbsEngineAttached`, `retractEveryCrumbsEngineAttachment`), because a
// foreign module mutates through this module's use cases rather than its store
// mutators.

export { crumbsEngineAttachmentStore, readAttachedCrumbsInstanceIds } from './crumbsEngineAttachmentStore';
