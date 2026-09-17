// AgentAdapters/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.
//
// Read-only for foreign modules: enabling a transport, issuing a grant and
// revoking one are use cases, because every one of them is an approval.

export { externalClientSessionStore, resetExternalClientSession } from './externalClientSessionStore';
export type { ExternalClientSessionState } from './externalClientSessionStore';
