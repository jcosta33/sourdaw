---
type: adr
id: 0014
title: Agent provider credentials and endpoint admission
status: accepted
date: 2026-07-26
owner: The Sourdaw team
sources:
  - DECISIONS-sourdaw-agentic-production-system D-027 and D-029
  - SPEC-sourdaw-agentic-production-system AC-025 through AC-031
---

# 0014 — Agent provider credentials and endpoint admission

## Context

Direct browser credentials and enrollment-time hostname checks cannot protect
long-lived secrets or prevent redirects, proxies, DNS changes, and rebinding from
turning a custom endpoint into generic network authority.

## Decision

Tauri remote providers use Rust HTTP and a native credential vault with
user-owned credentials. Browser-direct Anthropic is retired; its in-memory key is
not migrated, and users re-enter it into secure storage. Standalone-browser
remote profiles remain unavailable. A future trusted relay requires separate
governance and uses the normalized transport port.

User-enrolled endpoints fingerprint canonical HTTPS scheme, IDNA host, and port.
Redirects and implicit system proxies are disabled. Every connection and
re-resolution classifies all A/AAAA results and binds to an admitted address
while preserving TLS host validation. Mixed public/non-global results,
IPv4-mapped IPv6, metadata or reserved destinations, cross-origin credential or
body forwarding, and DNS rebinding fail closed. Loopback development is isolated
from remote credentials and production admission.

## Consequences

- BYOK providers require no new Sourdaw AI/provider server.
- Security takes precedence over standalone-browser cloud parity.
- A configured URL never grants unrestricted HTTP authority.
