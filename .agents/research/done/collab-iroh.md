# Sourdaw Collaboration Transport Amendment — Ship the Simple UX, Keep WebRTC, Hide the Networking

## 0. Executive Decision

Do **not** rip out the existing WebRTC work.

Do **not** do a full Iroh rewrite right now.

Given that:

- we already have substantial WebRTC work done,
- browser support matters,
- the only thing that truly matters is **low user workload**,
- and using **public STUN behind the scenes is acceptable**,

the correct implementation decision is:

> **Use WebRTC as the canonical realtime transport for both browser and desktop.**
> **Use public STUN servers by default, invisibly.**
> **Keep all networking complexity out of the default UI.**
> **Preserve manual copy/paste invite flows as the baseline no-infra signaling path.**
> **Optionally add desktop-native enhancements later, but do not block shipping on them.**

This is the shipping path.

---

## 1. Product Truth We Are Optimizing For

The product goal is **not** “strict zero-server purity.”

The product goal is:

> A normal user can click **Collaborate**, send an invite, and join a session without understanding or configuring networking.

Therefore the product is allowed to:

- use public STUN,
- use hidden ICE gathering,
- use hidden SDP,
- use hidden connection retries,
- use hidden diagnostics,
- and use different internal strategies on browser vs desktop if needed,

as long as the user does **not** have to do networking setup.

### Internal truth

Public STUN is a hidden helper service.
That is acceptable.

### User-facing truth

The app should say:

- “Direct connection”
- “Connecting…”
- “Couldn’t connect directly”
- “Try again”
- “Nearby”
- “Advanced”

The app should **not** dump:

- ICE candidates
- SDP blobs
- STUN server names
- TURN jargon
- NAT jargon
- relay jargon

into the normal flow.

---

## 2. What Changes From the Current Spec

### 2.1 What we are no longer optimizing for as the primary path

The current spec leans too hard on:

- strict zero-server mode as the default ideal,
- Iroh as the thing that makes everything seamless,
- removing WebRTC/ICE entirely.

That is **not** the implementation target now.

### 2.2 New primary position

The new primary position is:

1. **WebRTC remains the canonical live transport**
    - browser ↔ browser
    - browser ↔ desktop
    - desktop ↔ desktop

2. **Public STUN is enabled by default**
    - hidden from users
    - no setup required
    - not shown in the main UI

3. **Manual signaling remains the baseline**
    - copy invite
    - paste invite
    - optional answer copy-back where required
    - QR and URL fragment support

4. **Desktop-native discovery remains valuable**
    - mDNS / Nearby on Tauri
    - same-LAN sessions should feel closest to one-click
    - but this is an enhancement, not the only usable path

5. **Iroh is no longer the current refactor target**
    - it can remain a future desktop-native experiment
    - it is not the transport rewrite we do now

---

## 3. Core Product Promise

The collaboration feature must feel like:

> Click **Collaborate** → **Start Session** → **Copy Invite** → collaborator **Join Session** → **Paste Invite** → start working.

That is the visible product promise.

### Important implementation reality

Because we are **not** introducing hosted signaling infrastructure, some WebRTC sessions may still require a reply payload / answer exchange.

That is acceptable for v1.

The app must:

- keep this flow visually simple,
- compress payloads,
- auto-copy where possible,
- use QR where possible,
- and never expose raw networking details.

The user may occasionally do:

- one copy
- one paste
- one copy-back
- one final paste

But they should perceive this as “invite exchange,” not as “network setup.”

---

## 4. Implementation Decision for the Agent

## 4.1 DO NOT

- Do **not** delete the current WebRTC stack.
- Do **not** delete ICE gathering.
- Do **not** delete SDP handling.
- Do **not** remove public STUN support.
- Do **not** rewrite transport around Iroh right now.
- Do **not** build separate browser and desktop collaboration UX.
- Do **not** expose STUN/TURN/ICE in the normal interface.
- Do **not** force users to configure servers.

## 4.2 DO

- Keep the existing WebRTC path and finish it properly.
- Treat WebRTC as the shared cross-platform transport baseline.
- Add a **default hidden STUN config**.
- Refactor the current code so transport internals are abstracted from UI, but do not replace the transport.
- Focus on making the **invite UX** simple.
- Keep Nearby/mDNS for desktop enhancement.
- Keep the existing CRDT/data-channel architecture.

---

## 5. Networking Modes

## 5.1 Default mode — Easy Mode (ship this)

This is the only mode normal users should see first.

Characteristics:

- WebRTC
- hidden ICE
- hidden public STUN
- manual invite exchange as baseline
- QR support
- URL fragment support where helpful
- Nearby for LAN on desktop
- no networking settings shown up front

User sees:

- Start Session
- Copy Invite
- Show QR
- Nearby
- Join Session
- Paste Invite

Nothing more.

## 5.2 Advanced mode — Hidden behind disclosure

Only expose under **Advanced**:

- custom STUN server
- custom TURN server
- diagnostics
- ICE details
- transport logs
- VPN hints
- passphrase/DHT/rendezvous experiments
- future Iroh experimental desktop transport, if ever added

This is not v1 priority.

---

## 6. Canonical Live Transport

### Canonical transport for now

**WebRTC**

Why:

- already substantially implemented
- works in browser
- works in desktop
- supports data channels and media channels
- public STUN solves the “user shouldn’t configure networking” requirement well enough
- avoids a risky transport rewrite

### Canonical hidden helper

**Public STUN servers**

Why:

- no user setup
- practical default
- better connectivity than strict no-helper mode
- acceptable hidden dependency under current product priorities

### Optional later helper

**TURN**

- not required for v1
- may be added later for hard NAT cases
- should remain hidden or advanced
- should not shape the current UX

---

## 7. Signaling Strategy

## 7.1 No hosted signaling server in v1

We are not adding a vendor signaling backend right now.

Therefore the baseline signaling strategy remains:

- manual invite exchange
- QR exchange
- URL fragment where appropriate
- Nearby auto-discovery for same-LAN desktop when possible

## 7.2 Invite payloads

We must reduce friction by making invite payloads compact and friendly.

Requirements:

- use CBOR or compact binary
- compress with zstd or brotli
- encode as URL-safe base64 or base58
- include only what is needed
- use one payload format for:
    - copy/paste
    - QR
    - URL fragment

### Offer payload includes

- session ID
- host nickname
- session capability token
- host ephemeral session pubkey if used
- SDP offer
- ICE candidates gathered so far
- product metadata
- role baseline
- optional expiry
- optional project/session display summary

### Answer payload includes

- session ID
- joiner nickname
- SDP answer
- ICE candidates
- role request / approval state if needed

## 7.3 UX rule for signaling

The UI must present this as:

- “Invite”
- “Join”
- “Waiting for response”
- “Complete join”

It must not present this as:

- “offer”
- “answer”
- “SDP”
- “candidate exchange”

Those terms are implementation details only.

---

## 8. Browser vs Desktop Rules

## 8.1 Browser

Browser uses WebRTC as the standard path.
Do not special-case browser into a broken or downgraded transport architecture.

Must support:

- paste invite
- URL fragment
- QR scan/import where supported
- public STUN-assisted connectivity
- data channels for sync/presence/control
- media channels for voice/audio monitoring if enabled

## 8.2 Desktop / Tauri

Desktop also uses WebRTC as the standard path.

Desktop may additionally support:

- mDNS / Nearby discovery
- native file access for assets
- better local caching
- deeper diagnostics under Advanced

Desktop does **not** require a different primary transport right now.

## 8.3 Mixed browser ↔ desktop sessions

Must continue to work on the same transport model.

This is one of the main reasons we are **not** doing the Iroh rewrite now.

---

## 9. Data Channels and Media Channels

Keep the current WebRTC channel design.

### 9.1 Data channels

#### `crdt-sync`

- reliable
- ordered
- Automerge sync messages
- document heads
- doc requests / sync framing

#### `presence`

- unordered or low-retransmit
- transient awareness data
- cursors
- viewport
- selection
- action string
- connection quality hints

#### `transport-control`

- reliable
- ordered
- play / stop / seek / loop / leader changes

#### `asset-control`

- reliable
- ordered
- manifests
- availability
- chunk requests
- transfer negotiation

#### `asset-data`

- reliable
- chunk transfer
- resume capable

#### `chat`

- reliable
- ordered
- ephemeral text chat

#### `admin`

- reliable
- ordered
- approvals
- role grants
- session metadata
- error codes

### 9.2 Media channels

#### `voice-chat`

- media stream
- Opus
- independent of project content

#### `remote-monitor`

- media stream
- peer monitor/render audio

#### `live-input`

- optional media stream
- low-latency input monitoring

---

## 10. CRDT and Store Architecture

No major change.

Keep the current AutomergeStorage approach.

### Canonical rule

- collaborative project state lives in Automerge-backed stores
- ephemeral/UI/session state stays out of project CRDT

### Continue using AutomergeStorage for

- trackStore
- automationStore
- midiStore
- transportStore (minus ephemeral playback runtime fields)
- tempoMapStore
- timeSignatureMapStore
- markerStore
- projectStore

### Continue NOT using AutomergeStorage for

- workspaceStore
- collaborationStore
- clipboardStore
- undoStore
- presentation-only stores

### Remote sync flow remains

1. receive WebRTC data channel message
2. parse Automerge sync frame
3. merge into automergeRepository
4. call `projectCrdtToStores()`
5. hydrate stores
6. UI updates

Do not redesign this around a different document system.

---

## 11. Asset Transfer

Do **not** refactor asset transfer around `iroh-blobs`.

Keep the current content-addressed chunk-transfer design from the spec:

- asset identity by BLAKE3
- manifest in CRDT
- chunks over asset channels
- resume via missing bitmap
- dedupe via content hash

This is already compatible with the current architecture and does not require a transport rewrite.

### Asset rules remain

- assets are not CRDT payloads
- assets are not embedded into live sync messages
- structure sync is separate from asset transfer
- missing assets must not block project structure opening

---

## 12. Permission and Security Model

Keep the session capability model.

### Rules

- invite material is a capability token
- possession allows join attempt, not automatic edit authority
- host approval remains supported
- role grants remain signed/session-bound where implemented
- unauthorized mutating ops must still be rejected locally by compliant peers

### WebRTC security

- DTLS / SRTP remain the transport security base
- no additional server-side account system required

---

## 13. Presence Rules

Keep presence out of Automerge.

Presence remains:

- transient
- frequent
- self-owned
- expiring

### Presence fields

- display name
- color
- role
- current view
- viewport range
- cursor position
- selection IDs
- current action string
- play/record status
- connection quality summary
- monitor flags

### Suggested rates

- cursor / viewport around 10 Hz default
- higher on LAN if needed
- on-change for role/status/action

---

## 14. UX Spec — Simplified and Honest

## 14.1 Main entry point

Top bar button:
**Collaborate**

Opens modal:

- **Start Session**
- **Join Session**

Nothing else on first screen.

## 14.2 Start Session screen

Show:

- Session Name
- Who can edit
    - Anyone who joins can edit
    - Ask me before people join
- Voice chat toggle (optional)

Primary action:

- **Start Session**

No networking jargon.

## 14.3 After starting session

Show three big actions:

- **Copy Invite**
- **Show QR**
- **Nearby**

Helper text:

> Send this invite to someone you trust. They can paste it, scan the QR code, or join from Nearby if they’re on the same local network.

Also show:

- session name
- your display name
- short fingerprint

## 14.4 Join Session screen

Show:

- paste field
- **Paste from Clipboard**
- **Scan QR**
- **Nearby**

Primary action:

- **Join Session**

No jargon.

## 14.5 If a response payload is needed

Do not call it “answer.”

Show:

- **Share Response**
- **Paste Host Response**
- **Finish Joining**

The app can auto-copy the response to clipboard after generation.

User language should stay plain.

## 14.6 Error state

If connection fails, show:

**Couldn’t connect directly**

Actions:

- **Try Again**
- **Use Nearby**
- **Open Advanced Options**

Helper text:

> Some networks make direct collaboration harder. Try again, join on the same local network, or check Advanced Options.

Do not dump WebRTC internals into the default error UI.

---

## 15. Nearby / LAN Discovery

Desktop-only enhancement.

### Requirements

- use mDNS / DNS-SD on Tauri/native builds
- show nearby sessions in a simple list
- selecting a nearby session should reduce or eliminate manual payload exchange when possible
- discovery does not auto-join peers
- approval/capability still applies

### Nearby list row contents

- host/device name
- session/project name
- local-only badge
- join button

This should feel like AirDrop, not like network engineering.

---

## 16. Diagnostics and Advanced Options

All of this goes under **Advanced**:

- current ICE state
- gathered candidates
- connection type summary
- public STUN config
- optional TURN config if ever added
- transport stats
- packet loss
- RTT
- “copy diagnostics” button

### Important rule

Diagnostics are for:

- bug reports
- advanced users
- developer support

They are not part of the normal workflow.

---

## 17. Concrete Codebase Directive

## 17.1 Rust backend (`crates/daw-collab/` and Tauri commands)

Do not delete current WebRTC transport modules.

Refactor around clear interfaces instead.

### Target modules

- `identity`
- `session`
- `invite`
- `transport`
- `presence`
- `sync`
- `asset_store`
- `file_transfer`
- `permissions`
- `transport_clock`
- `project_bridge`
- `ui_protocol`

### Add / preserve traits

- `RealtimeTransport`
- `DiscoveryProvider`
- `PresenceBroadcaster`
- `ProjectCrdtAdapter`
- `AssetStore`

### RealtimeTransport should expose capabilities like

- create session
- consume invite payload
- create response payload if needed
- finalize join
- send reliable message(channel, bytes)
- send transient message(channel, bytes)
- open media stream(kind)
- peer events
- reconnect state
- stats snapshot

This abstraction is to clean up code, not to force a new transport rewrite.

## 17.2 Frontend / TypeScript

Frontend remains transport-agnostic.

It should call commands / use hooks like:

- start session
- generate invite
- consume invite
- consume response
- finalize join
- send CRDT sync payload
- send presence update
- request asset
- subscribe to peer connected / disconnected
- subscribe to CRDT sync received
- subscribe to presence update
- subscribe to asset progress
- subscribe to transport diagnostics

Do not let UI code manipulate WebRTC internals directly.

---

## 18. File-Level Agent Guidance

## 18.1 Keep and finish

- current WebRTC transport code
- ICE handling
- SDP serialization/parsing
- data channel setup
- media channel setup
- Automerge sync bridge
- asset transfer protocol
- collaboration UI primitives

## 18.2 Refactor

- invite format
- signaling UX
- transport abstraction boundaries
- hidden default STUN configuration
- error handling and retries
- desktop Nearby integration
- frontend state shape for session progress

## 18.3 Do not implement now

- Iroh rewrite
- iroh-blobs asset pipeline
- full dual-stack transport with Iroh + WebRTC
- hosted signaling backend
- TURN as mandatory
- strict zero-server mode as primary flow

---

## 19. Product Copy Changes

Replace internal/product framing like:

- “strict zero-server mode” as the primary headline
- “no servers ever”
- “no network helpers”
- “Iroh removes all WebRTC hassle”

With language like:

- “Direct collaboration”
- “No accounts”
- “No project cloud required”
- “Local-first collaboration”
- “Automatic direct connection”
- “Some networks may require retrying or a local network connection”

This is more honest and still sounds clean.

---

## 20. Acceptance Criteria

The implementation is successful when:

1. The normal user does **not** have to configure networking.
2. Public STUN is enabled by default and hidden.
3. Browser collaboration still works.
4. Desktop collaboration still works.
5. Mixed browser ↔ desktop collaboration still works.
6. Existing WebRTC code is preserved and cleaned up rather than discarded.
7. The main UI only emphasizes:
    - Start Session
    - Join Session
    - Copy Invite
    - Show QR
    - Nearby
8. CRDT sync runs over the current reliable WebRTC transport path.
9. Presence remains transient and out of the CRDT.
10. Asset transfer remains content-addressed and resumable.
11. Errors are shown in plain language.
12. ICE/STUN/TURN details are hidden behind Advanced.
13. No user is asked to paste server addresses, configure relays, or understand networking terminology.

---

## 21. Final Directive to the Agent

Ship the collaboration feature by **leaning into the WebRTC work we already have**, not by replacing it.

The strategy is:

- keep WebRTC as the shared transport,
- hide public STUN behind the scenes,
- preserve browser compatibility,
- simplify the invite UX,
- keep Nearby as a desktop enhancement,
- keep CRDT + asset architecture intact,
- and remove networking jargon from the product.

This is the shortest path to the actual goal:
**low-friction collaboration with minimal user workload.**
