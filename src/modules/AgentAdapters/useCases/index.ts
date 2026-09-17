// AgentAdapters/useCases — public contract surface for external-client admission.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.
//
// Nothing here executes, commits or confirms: the surface is approval, refusal
// and read-only routing, and the boundary spec pins that it stays that way.

export { externalClientManifestPort } from './externalClientManifestPort';
export { enableExternalClientTransport } from './enableExternalClientTransport';
export { disableExternalClientTransport } from './disableExternalClientTransport';
export { setExternalClientActiveProject } from './setExternalClientActiveProject';
export { issueExternalClientGrant } from './issueExternalClientGrant';
export { revokeExternalClientGrant } from './revokeExternalClientGrant';
export { normalizeExternalClientContract } from './normalizeExternalClientContract';
export { admitExternalClientRequest } from './admitExternalClientRequest';
export { runCliClientRequest } from './runCliClientRequest';
