# Sourdaw Peer-to-Peer Collaboration — Ultimate Implementation Guide

## Purpose

This guide defines the full architecture for **real-time, peer-to-peer, serverless collaboration** in Sourdaw.

It is designed for:

- native desktop builds via **Tauri v2**
- browser builds
- mixed browser ↔ desktop sessions
- local-first, offline-capable workflows
- zero accounts
- zero telemetry
- no mandatory central servers
- end-to-end encrypted transport

This is not a cloud workspace or file-sharing layer. It is a **multiplayer editing system for DAW projects**.

---

# 1. Product Definition

Sourdaw collaboration must provide:

- simultaneous editing of the same project by multiple peers
- deterministic state convergence without merge dialogs
- visible collaborator presence
- real-time transport synchronization
- optional real-time audio monitoring streams
- local ownership of all project data
- full offline continuity
- async merge via project-file exchange
- no dependency on a vendor-hosted account or project database

The system should feel like:

- Figma / Google Docs for shared editing UX
- Signal / Syncthing for privacy and local-first trust model
- BitTorrent / libp2p for direct peer connectivity patterns

---

# 2. Core Architectural Position

## 2.1 Recommended Stack

### Canonical collaborative state

**Automerge** is the recommended primary CRDT layer.

Why:

- Rust-native
- local-first design
- sync protocol over arbitrary transport
- compact binary representation
- natural fit for offline merge and portable `.sdaw` project files

### Realtime transport

**WebRTC** is the primary live transport for:

- browser ↔ browser
- browser ↔ desktop
- desktop ↔ desktop when using unified code paths

### Native discovery overlay

**libp2p** is the recommended optional discovery substrate for desktop-native global discovery, especially for:

- Kademlia DHT
- rendezvous
- mDNS
- peer identity and private overlays

### Presence

Use a **transient awareness protocol** modeled after Yjs Awareness semantics:

- not persisted in the CRDT
- small
- frequent
- self-owned per peer
- automatically expires when peer disconnects

### Audio/media

Use WebRTC media channels for:

- voice chat
- remote monitor streams
- live-input monitoring streams

### Asset/file transfer

Use a **content-addressed chunk transfer protocol** over data channels, not CRDTs.

---

# 3. Non-Negotiable Product Constraints

1. **Every peer keeps a complete local copy of collaborative state**
2. **Project structure sync is separate from asset transfer**
3. **No mandatory server must be required to edit, sync, or recover projects**
4. **All collaboration must still degrade into offline-first operation**
5. **The browser build must support manual and URL-fragment signaling**
6. **The desktop build must support native LAN discovery**
7. **No project content should ever depend on a vendor relay being online**
8. **Unauthorized or malformed remote edits must be rejected locally**
9. **Realtime audio collaboration is best-effort, not sample-accurate ensemble performance**
10. **A disconnected peer must never lose their work**

---

# 4. Connectivity Modes

Sourdaw must support multiple connection methods. No single discovery path is sufficient across all network environments.

## 4.1 Supported Modes Matrix

### Manual exchange

- Browser: yes
- Desktop: yes
- Needs internet: no, if users have some out-of-band channel
- Zero-server: yes
- Reliability: highest baseline

### URL fragment

- Browser: yes
- Desktop: yes if webview path supports it
- Needs internet: not necessarily, if local static app exists
- Zero-server: yes
- Reliability: high for browser invite flows

### QR code

- Browser: yes
- Desktop: yes
- Zero-server: yes
- Best for in-person collaboration

### Local network discovery (mDNS)

- Browser: not portable as a generic web capability
- Desktop: yes
- Zero-server: yes
- Best for same-studio / same-LAN collaboration

### DHT / rendezvous

- Browser: not baseline
- Desktop: yes
- Zero-server: yes in the sense of decentralized network participation
- Best for power users and global discovery without a vendor server

### VPN direct (Tailscale / ZeroTier / WireGuard)

- Browser: limited / indirect
- Desktop: yes
- Zero-server from Sourdaw’s perspective: yes
- Best for hard NAT environments and trusted teams

### STUN-assisted WebRTC

- Browser: yes
- Desktop: yes
- Not strict zero-server if using third-party STUN
- Useful as optional practical networking profile

### TURN-assisted relay

- Browser: yes
- Desktop: yes
- Not zero-server
- Must remain optional and user-supplied, never required by product definition

---

# 5. Recommended Product Modes

To resolve the tension between strict privacy and practical connectivity, define two explicit networking modes.

## 5.1 Strict Zero-Server Mode

Default privacy-purist mode.

Allowed:

- manual offer/answer exchange
- QR exchange
- URL fragment invites
- native mDNS LAN discovery
- direct VPN / mesh-network connections
- libp2p DHT or private overlay if the user opts in

Disallowed by default:

- vendor STUN
- vendor TURN
- hosted signaling service

This mode satisfies the “zero servers” promise.

## 5.2 Optional Assisted-Networking Mode

Opt-in advanced profile.

Allowed:

- user-configured STUN servers
- self-hosted coturn TURN relay
- user-provided rendezvous bootstrap nodes
- self-operated libp2p bootstrap peers

This mode is documented as:

- optional
- user-supplied
- not part of Sourdaw’s core infrastructure

---

# 6. Peer Identity and Session Capability Model

## 6.1 Identity Types

Use three identity layers:

### Device Identity

Persistent local keypair generated on first launch.
Used for:

- optional fingerprint display
- trusted-peer memory
- device labeling
- long-term local identity

### Session Identity

Ephemeral keypair generated per collaboration session.
Used for:

- session authentication
- invite capability
- role grants
- session-level secrecy

### Actor Identity

CRDT actor ID bound to a peer’s local editing process for operation attribution.

## 6.2 Capability-Based Security

The invite material itself is a **capability token**.

Anyone holding the valid capability can attempt to join.

This matches the product’s no-account, trusted-collaborator model.

The token should encode or derive:

- session ID
- host ephemeral public key
- session secret or seed
- allowed role baseline
- document root ID
- optional expiry
- optional transport hints

---

# 7. Connection Establishment Flows

## 7.1 Manual Exchange

This is the baseline and must always work.

### Flow

1. Peer A chooses **Create Session**
2. App generates an offer bundle:
    - session metadata
    - ephemeral session pubkey
    - transport type
    - SDP offer or direct-address hint
    - ICE candidates if using WebRTC
    - optional role request
3. Bundle is serialized as:
    - CBOR or compact binary
    - compressed (zstd or brotli)
    - encoded as URL-safe base64 or base58
4. Peer A shares it via any out-of-band channel
5. Peer B pastes it into **Join Session**
6. Peer B verifies invite summary
7. Peer B generates answer bundle
8. Peer B returns answer out-of-band
9. Peer A pastes answer
10. Direct connection finalizes

### UX requirements

- one-click copy
- visible size indicator
- show invite fingerprint
- show session name and host nickname
- easy retry
- support QR representation of the same payload

## 7.2 URL Fragment

### Flow

1. Peer A generates URL:
   `sourdaw.app/#join=<compressed-capability>`
2. Fragment remains client-side and is not sent to the web server
3. Peer B opens URL
4. Browser app reads fragment and starts join flow

### Use

Best for browser sessions and low-friction invites.

## 7.3 QR Code

Use the exact same payload as manual or fragment mode.

### Flow

- Desktop or browser shows QR
- Other peer scans with phone, tablet, or camera-equipped desktop
- Payload is imported and join flow begins

Best for:

- same-room collaborations
- laptops + tablets
- no typing

## 7.4 Local Network Discovery (Desktop/Tauri)

### Mechanism

Use mDNS / DNS-SD on desktop-native builds.

Advertise:

- application service type
- device nickname
- ephemeral session ID
- project hash / session hash
- host transport port(s)
- whether session is open or approval-required

### Nearby panel UX

Show:

- name
- device
- project title
- host color
- role availability
- latency estimate
- local-only badge

### Security

mDNS only discovers peers; joining still requires:

- capability exchange
- host approval
- or a shared session secret

Do not auto-join discovered peers.

## 7.5 DHT / Rendezvous Discovery (Desktop-First)

### Mechanism

For native builds, support optional discovery through libp2p Kademlia and/or Rendezvous.

Use:

- session secret → session lookup key
- publish peer multiaddrs or WebRTC rendezvous hints under that key
- remote peer derives same key from passphrase and discovers candidate peers

### UX

Peer A:

- creates session
- gets short passphrase

Peer B:

- enters passphrase
- app derives discovery topic
- discovers Peer A
- performs secure handshake

### Important rule

This is native/desktop-first.
Do not depend on browser builds participating directly in public DHT as the baseline path.

## 7.6 VPN Direct

If both peers are already on:

- Tailscale
- ZeroTier
- WireGuard mesh
- private LAN / port-forwarded network

then Sourdaw should detect routable peer addresses and bypass WebRTC entirely if configured.

In this mode:

- use direct QUIC/TCP/WebSocket or libp2p transport
- still run the same encrypted session protocol on top
- still use the same CRDT and presence layers

---

# 8. STUN and TURN Policy

## 8.1 Product Stance

Sourdaw must not _require_ vendor-run STUN or TURN to function.

## 8.2 Practical Reality

Some NAT/firewall combinations prevent direct peer establishment.

Therefore:

### Default product mode

- strict zero-server
- no built-in dependency on public STUN/TURN

### Optional networking profiles

Users may configure:

- public STUN
- self-hosted coturn TURN
- trusted team relay
- VPN alternative

## 8.3 UI language

Use precise copy:

- “Direct peer connection”
- “Optional network helpers”
- “No Sourdaw server is used”
- “Your network may require a relay or VPN for connectivity”

---

# 9. Recommended Data Channels and Media Channels

A single multiplexed channel is not enough. Use separate logical channels.

## 9.1 Data Channels

### `crdt-sync`

- reliable
- ordered
- medium priority
- used for Automerge sync messages and document heads

### `presence`

- unordered
- lossy or low-retransmit
- high frequency
- used for cursors, viewport, active selection, editing status

### `transport-control`

- reliable
- ordered
- low bandwidth
- used for play/pause/seek/leader changes/tempo actions

### `asset-control`

- reliable
- ordered
- used for file manifests, availability bitmaps, chunk requests

### `asset-data`

- reliable
- optionally unordered
- chunked bulk transfer

### `chat`

- reliable
- ordered
- ephemeral text chat

### `admin`

- reliable
- ordered
- role grants, join approvals, session metadata, error codes

## 9.2 Media Channels

### `voice-chat`

- Opus
- independent from project audio
- push-to-talk or always-on

### `remote-monitor`

- one or more Opus stereo streams for hearing another peer’s render/output

### `live-input`

- optional low-latency input monitor stream from one peer to another

---

# 10. CRDT Architecture

## 10.1 Primary Recommendation

Use **Automerge** as the canonical project CRDT.

## 10.2 Why Not Raw Nested Arrays Everywhere

A DAW project contains many ordered collections:

- tracks
- devices in chains
- clips on tracks
- notes in clips
- automation points
- markers

Naively using deeply nested arrays for all of these makes:

- reordering costly
- merge semantics messy
- partial loading harder
- per-entity addressing fragile

## 10.3 Recommended Data Model Pattern

Use:

- **maps keyed by stable IDs** for entities
- **fractional order keys** for ordering
- **tombstone/archival behavior** for deletes
- **multiple linked Automerge documents** for large or independently loaded sections

This is more collaboration-friendly than raw positional arrays.

---

# 11. Project-as-Multiple-Documents Model

Instead of one giant CRDT blob, split the project into several linked Automerge docs.

## 11.1 Root Document

Contains:

- project metadata
- top-level order references
- track registry
- routing registry
- marker registry
- transport map
- asset manifest registry
- permissions registry
- linked child document URLs

## 11.2 Child Documents

Use separate docs for:

- each track
- large MIDI clips
- heavy automation lanes
- note editor state where needed
- asset transfer manifests
- optional chat history if persisted locally
- optional subprojects / stems

## 11.3 Benefits

- selective sync
- selective loading
- better performance on large sessions
- easier partial history compaction
- smaller merge envelopes
- easier browser memory budgeting

---

# 12. Canonical CRDT Schema

## 12.1 Root Document

```json
{
    "project": {
        "id": "proj_...",
        "name": "My Session",
        "sampleRate": 48000,
        "tempoMapRef": "doc://tempo_1",
        "masterTrackRef": "doc://master_1",
        "trackOrder": ["trk_a", "trk_b", "trk_c"],
        "tracks": {
            "trk_a": { "ref": "doc://track_a", "orderKey": "a0" },
            "trk_b": { "ref": "doc://track_b", "orderKey": "b0" }
        },
        "routing": {
            "connections": {
                "conn_1": { "from": "trk_a", "to": "bus_1", "gainDb": 0.0 }
            }
        },
        "markers": {
            "m_1": { "time": 32.0, "name": "Verse", "orderKey": "a0" }
        },
        "assets": {
            "blake3:...": {
                "size": 1234567,
                "mime": "audio/wav",
                "availablePeers": ["peer_a", "peer_b"]
            }
        }
    }
}
```

## 12.2 Track Document

```json
{
    "track": {
        "id": "trk_a",
        "name": "Lead Vox",
        "type": "audio",
        "volumeDb": -3.2,
        "pan": 0.1,
        "mute": false,
        "solo": false,
        "color": "#ff66aa",
        "clips": {
            "clip_1": { "orderKey": "a0", "ref": "doc://clip_1" }
        },
        "devices": {
            "dev_1": { "orderKey": "a0", "type": "Fermenter", "ref": "doc://dev_1" }
        },
        "automationLanes": {
            "auto_1": { "paramPath": "volumeDb", "ref": "doc://auto_1" }
        }
    }
}
```

## 12.3 Clip Document

```json
{
    "clip": {
        "id": "clip_1",
        "type": "midi",
        "start": 32.0,
        "length": 8.0,
        "offset": 0.0,
        "loop": true,
        "notes": {
            "note_1": {
                "pitch": 60,
                "start": 0.0,
                "length": 1.0,
                "velocity": 100,
                "channel": 1
            }
        }
    }
}
```

## 12.4 Automation Document

```json
{
    "automation": {
        "id": "auto_1",
        "paramPath": "volumeDb",
        "points": {
            "pt_1": { "time": 32.0, "value": -6.0, "curve": "linear", "orderKey": "a0" }
        }
    }
}
```

---

# 13. Merge Semantics by Operation Type

This is the most important part of the design.

## 13.1 Scalar Metadata

Examples:

- project name
- BPM scalar
- track volume
- pan
- mute
- solo
- device parameter values
- clip start
- clip length

### Merge rule

Use **last-writer-wins register semantics** as provided by the CRDT for that field.

### Why

For most DAW scalar fields, converging to one final value is acceptable.

---

## 13.2 Entity Creation

Examples:

- add track
- add clip
- add device
- add marker
- add note
- add automation point

### Merge rule

Concurrent adds are both preserved if IDs differ.

### Requirement

Every entity must have a globally unique stable ID:

- random 128-bit or 192-bit IDs
- actor-prefixed IDs
- content-derived IDs only where safe

---

## 13.3 Deletion

Examples:

- delete track
- delete clip
- delete note
- delete device
- delete automation lane

### Merge rule

Delete wins for visible state.

### Important implementation detail

Do not physically erase children immediately from storage.
Instead:

- mark parent or entity deleted/tombstoned
- hide it from live arrangement
- keep enough lineage for undo/recovery and CRDT convergence

This prevents destructive loss during concurrent edits.

---

## 13.4 Ordering

Examples:

- reorder tracks
- reorder devices
- reorder clips in UI listings
- reorder markers

### Recommended rule

Do **not** model order as array position alone.

Use:

- stable entity ID
- mutable `orderKey` field
- fractional indexing or order-string allocation

This avoids pathological concurrent array move behavior.

---

## 13.5 MIDI Notes

### Representation

Notes should be CRDT map entries keyed by stable note IDs, not positional list items.

### Merge rules

- concurrent note adds with different IDs: preserve both
- concurrent edits to different fields on same note: merge field-wise if CRDT permits; otherwise converge deterministically per field
- concurrent edit + delete: delete wins for visible state
- concurrent pitch changes to same note: LWW on `pitch`
- concurrent timing changes to same note: LWW on `start` / `length`

### Why this is acceptable

In music editing, a lost race on one note is acceptable and obvious to collaborators in a way that paragraph text corruption is not.

---

## 13.6 Automation Points

Automation lanes are large, frequently edited, and sensitive to ordering.

### Recommended representation

Use:

- point IDs
- `time`
- `value`
- `curve`
- `orderKey`

### Merge rules

- concurrent new points at different IDs: preserve both
- point move = change `time` and possibly `orderKey`
- point delete wins over point edit for visible state
- entire lane delete wins over contained point edits

### Performance note

For dense lanes, chunk them into windows or child documents so one lane does not dominate sync cost.

---

## 13.7 Device Chains

### Built-in devices

For Sourdaw-native devices, sync parameters individually as CRDT scalar fields.

### Third-party plugins

Do **not** attempt semantic CRDT merge on opaque plugin-state blobs.

Instead use hybrid policy:

- expose automatable parameters as field-level collaborative scalars
- treat opaque plugin state blob snapshots as coarse LWW artifacts
- optionally lock opaque plugin UI editing to one peer at a time
- mark remote-only or missing-plugin tracks clearly

This is critical for practical DAW collaboration.

---

## 13.8 Routing

Routing is graph state.

### Representation

Store edges as stable connection objects:

- `from`
- `to`
- `gain`
- `send/pre/post`
- enable flag

### Merge rules

- concurrent adds of different edges: preserve both
- concurrent delete/edit of same edge: delete wins for visible state
- invalid cycles are rejected by the local engine validator, even if CRDT state converges to them transiently

CRDT convergence is not sufficient; engine validation is still required.

---

# 14. Sync Protocol

## 14.1 Initial Sync

On connection:

1. exchange session metadata
2. exchange peer IDs and role tokens
3. exchange Automerge sync state / heads for root doc
4. pull linked child docs lazily or eagerly based on session mode
5. request missing document changes
6. request missing assets as needed

## 14.2 Incremental Sync

Every local edit:

- mutates local Automerge doc(s)
- produces sync messages or document deltas
- is sent over `crdt-sync`
- remote peers apply and converge

## 14.3 Lazy Sync

Do not immediately stream every child doc for giant sessions.

Use policies such as:

- sync root + visible track docs first
- lazy-fetch clips when selected/opened
- sync automation lanes on viewport demand
- sync large note docs only when edited or auditioned

---

# 15. Per-User Undo/Redo in Collaboration

## 15.1 Principle

Each peer keeps their own semantic undo stack.

Undo should reverse **that peer’s own recent intent**, not roll back the entire shared document globally.

## 15.2 Implementation Strategy

Store per-peer local history as:

- semantic action
- affected CRDT entities
- inverse mutation description
- base heads / causal context

Undo works by applying inverse edits as new CRDT changes, not by rewinding global document time.

## 15.3 Important UX Rule

Show:

- “Undo my last action”
  not:
- “Undo the session”

This matches user expectations in collaborative tools.

---

# 16. Presence and Awareness

## 16.1 Presence Is Not Project State

Presence must be **ephemeral** and separate from Automerge documents.

Do not store cursor positions or current selections permanently in the CRDT.

## 16.2 Presence Fields

Each peer broadcasts:

- display name
- color
- role
- current view:
    - arrangement
    - mixer
    - piano roll
    - device panel
- viewport:
    - visible time range
    - visible track range
- current cursor position
- current selection IDs
- current action string
- play/record/stopped status
- connection quality summary
- audio-monitor active flags

## 16.3 Update Rates

Recommended:

- cursor/viewport: 10 Hz default
- up to 20 Hz on LAN
- action string: on change
- role/status: on change
- inactive peers expire after timeout

## 16.4 UX Effects

Presence should drive:

- colored cursors in arrangement
- colored note-editor cursors
- selected clips highlighted with collaborator color
- track headers marked when another peer is focused there
- “Follow peer” navigation mode

---

# 17. Permission Model

## 17.1 Roles

Minimum roles:

- **Editor**
- **Viewer**
- **Transport Controller**
- **Host**

Optional later:

- Recorder
- Asset Uploader
- Reviewer / Comment-only

## 17.2 Enforcement

Roles must not rely purely on goodwill.

Use:

- session-signed role grants
- actor ID ↔ role binding
- update filtering on receipt

A peer without edit permission can still keep a full local copy, but their mutating ops should be ignored by compliant peers if not authorized.

## 17.3 Host Approval

For non-open sessions:

- new joiner requests access
- host sees fingerprint, nickname, requested role
- host approves or denies
- signed role token is issued

---

# 18. Presence of Missing Assets and Missing Plugins

## 18.1 Missing Audio Asset

If a peer lacks an asset:

- project structure still opens
- clip appears with placeholder
- playback disabled or muted for that region
- asset request begins automatically or on demand

## 18.2 Missing Plugin

If a peer lacks a plugin:

- device shown as unavailable
- remote-render monitor can substitute for monitoring
- track can show “remote render” badge
- editable automatable params that are known may still display read-only or limited state

This keeps the session usable.

---

# 19. Audio Streaming and Remote Monitoring

## 19.1 Three Audio Use Cases

### Voice chat

Separate conversation channel.
Never printed into the project.

### Remote render monitoring

Peer A streams what they hear from a track, bus, or solo source to Peer B.

### Live input monitoring

Peer B streams mic or instrument input to Peer A for remote supervision/recording.

## 19.2 Transport

Use WebRTC media tracks with:

- Opus
- low-latency settings
- mono or stereo depending on source
- optional per-track monitor stream selection

## 19.3 Product Honesty

This system is for:

- collaborative monitoring
- approval/review
- remote overdub support
- hearing plugin output another peer cannot render locally

It is **not** a substitute for true low-latency network jamming.

---

# 20. Transport Synchronization

## 20.1 Leader Model

At any moment one peer is the **transport leader**.

Leader is responsible for:

- play
- stop
- seek
- loop changes
- record-arm transport authority
- count-in start events

Leadership can transfer.

## 20.2 Time Sync Algorithm

Do not rely solely on wall-clock/NTP.

Use peer-to-peer monotonic time synchronization.

### Protocol

Each peer periodically exchanges:

- local monotonic send time
- echoed receive time
- response send time
- local receive time

From this, compute:

- RTT estimate
- one-way delay estimate
- clock offset estimate

Use a smoothed estimator.

## 20.3 Play Command

Leader sends:

```json
{
    "type": "transport.play",
    "timeline_position_beats": 64.0,
    "leader_time_target_ms": 123456789.0,
    "tempo_revision": 22
}
```

Followers:

- compute leader clock offset
- schedule local playback to start at the leader’s target future time
- adjust for known device/output latency if possible

## 20.4 Seek

Seek commands carry:

- target beats/bars
- whether playback continues immediately
- issue timestamp
- revision guard

## 20.5 BPM and Meter Changes

These belong to CRDT project state, but transport commands should reference relevant revisions so followers know which tempo map they are executing against.

---

# 21. Leader Election and Failure Handling

## 21.1 Initial Leader

Default:

- session creator

## 21.2 Transfer

Host may manually transfer transport authority.

## 21.3 On Disconnect

If leader disconnects:

- detect absence via presence timeout and control channel
- elect new leader deterministically:
    - host if present
    - else lowest lexicographic session peer ID
    - or explicit role priority

## 21.4 Split-Brain Guard

Transport packets must include:

- leader ID
- leader epoch
- monotonic sequence number

This prevents old leaders from regaining control silently after reconnect.

---

# 22. Asset and File Transfer Protocol

## 22.1 Rule

Do not send audio assets through the CRDT.

## 22.2 Asset Identity

Every asset is identified by:

- content hash (recommended: BLAKE3)
- size
- mime/container type
- optional duration/sample rate metadata
- chunk count
- optional per-chunk hashes or Merkle root

## 22.3 Manifest in Project State

The CRDT stores only metadata and asset references, such as:

```json
{
    "audioRef": {
        "hash": "blake3:...",
        "size": 23891234,
        "name": "vocal_take_03.wav"
    }
}
```

## 22.4 Transfer Flow

1. Peer receives asset reference
2. Peer checks local content store by hash
3. If absent, sends asset request on `asset-control`
4. Serving peer replies with manifest
5. Requester asks for missing chunks
6. Chunks stream on `asset-data`
7. Receiver verifies chunk and final hash
8. Asset becomes available and project clip resolves

## 22.5 Resume

Transfers are bitmap-driven:

- receiver tracks completed chunks
- reconnect resumes from missing chunk set

## 22.6 Chunk Size

Use fixed chunks such as:

- 256 KiB for responsive progress
- 1 MiB for large-file efficiency
- adaptively choose based on file size and channel conditions

## 22.7 Deduplication

Because everything is content-addressed:

- identical files are never re-downloaded
- multiple peers can serve the same missing asset
- assets can be cached across projects

---

# 23. Large Sample Libraries and Reference Policies

## 23.1 Three Asset Policies

### Embedded/Transferred

For session-specific recordings and small assets.

### Local Library Reference

For shared commercial sample libraries where each peer is expected to have their own local copy.

### Deferred Optional

For huge assets not immediately needed by a peer.

## 23.2 Library Roots

Allow users to map:

- missing asset hash
- original path hint
- local library root substitutions

This avoids unnecessary transfer of giant common libraries.

---

# 24. Offline and Async Collaboration

## 24.1 Local-First Rule

Every peer’s local copy is primary.

If the network disappears:

- work continues
- edits are stored locally
- sync resumes later

## 24.2 `.sdaw` File Format

A collaboration-capable `.sdaw` project should contain:

- root Automerge document
- child document store
- document heads/history
- asset manifest
- optional embedded transferred assets
- optional missing-asset placeholders

## 24.3 Async Merge Workflow

1. Peer A exports `.sdaw`
2. Peer B opens offline
3. Peer B edits locally
4. Peer B sends updated `.sdaw`
5. Peer A imports or opens side-by-side
6. Automerge merges document histories
7. Missing assets are requested or relinked

No “which version is newer?” dialog is needed.

---

# 25. Document Compaction and History Management

This is critical for real DAW-scale longevity.

## 25.1 Problem

CRDT history grows over time.

## 25.2 Required Strategy

Support:

- compacted snapshots
- retained recent change history
- optional “archive full history” mode
- export-with-history vs export-compacted modes

## 25.3 Rule

Do not compact away:

- current document semantics
- peer mergeability for active branches
- undo history required for current local session

Compaction should be explicit, safe, and versioned.

---

# 26. Security Model

## 26.1 Transport Security

WebRTC already provides transport encryption:

- DTLS
- SRTP for media

Native non-WebRTC direct transports should use:

- Noise
- TLS
- or equivalent authenticated encrypted sessions

## 26.2 Capability Security

Invite string / passphrase / QR payload is the capability.

Possession grants the right to attempt joining.

## 26.3 Fingerprint Verification

Display:

- short fingerprint
- safety number / emoji hash
- peer nickname
- device label

This allows trusted collaborators to verify they joined the intended session.

## 26.4 No Telemetry

The collaboration subsystem must:

- collect no analytics
- store no vendor logs
- emit no background “session health” telemetry
- not require vendor API keys

## 26.5 Open Verification

Because the code is open and local-first:

- users can inspect the traffic model
- users can audit whether any vendor server is required
- users can run fully offline/LAN-only sessions

---

# 27. UI Specification

## 27.1 Entry Points

Add **Collaborate** button in top bar and project menu.

## 27.2 Create Session Flow

User chooses:

- strict zero-server mode
- optional assisted-networking mode
- discovery method:
    - copy invite
    - URL
    - QR
    - nearby peers
    - passphrase / rendezvous
    - VPN direct

Then choose:

- role defaults
- open session vs approval required
- voice chat on/off
- remote monitor on/off

## 27.3 Join Session Flow

User can:

- paste invite
- open invite URL
- scan QR
- select nearby peer
- enter passphrase
- select detected VPN peer

## 27.4 In-Session UI

### Peer list

Show:

- name
- color
- role
- latency
- packet-loss / quality indicator
- online/offline
- voice-chat status
- monitor-stream status

### Arrangement presence

Show:

- colored cursor
- viewport ranges
- clip highlights
- track focus markers

### Piano roll presence

Show:

- note selection color overlays
- remote note cursor
- remote lane focus

### Follow mode

Click peer → follow their viewport

### Chat

Simple ephemeral text chat sidebar

### Voice

Push-to-talk and always-on options

---

# 28. Presence Rendering Rules

## 28.1 Arrangement

- show peer head at current playhead/hover if relevant
- lightly colored viewport strip on timeline ruler
- active track dot in track header

## 28.2 Mixer

- highlight fader/knob being adjusted by another peer
- show tiny peer color chip near touched control

## 28.3 Device UI

- if a collaborator is editing a device, show colored “editing” halo
- optionally gray out controls if host locks that device to one peer temporarily

---

# 29. Edge Case Handling

## 29.1 Peer Disconnects During Editing

- local work continues
- presence expires after timeout
- reconnect triggers CRDT resync
- no data loss

## 29.2 Leader Disconnects

- deterministic re-election
- visible banner
- transport resumes under new leader

## 29.3 Conflicting Edits to Same Fader

- converge via scalar LWW
- visible final value
- each peer can immediately adjust again

## 29.4 Conflicting Edits to Same MIDI Note

- per-field LWW or delete-wins visible state
- acceptable for musical editing
- local undo can reapply a user’s intended change

## 29.5 Delete Track While Other Peer Edits Child Clip

- track tombstone wins for visible arrangement
- child edits remain recoverable in history/recovery flows

## 29.6 Asset Transfer Interrupted

- resume from missing chunks
- verify hash on completion

## 29.7 Missing Plugin

- mark unavailable
- remote-render fallback if available
- no project corruption

## 29.8 Restrictive NAT / Firewall

Offer guidance:

1. same LAN
2. QR/manual invite
3. VPN direct
4. optional self-hosted coturn
5. optional user STUN/TURN profile

## 29.9 Browser Sleep / Background Tab Throttling

- presence may stutter
- CRDT state remains safe
- reconnect/resume on wake
- use keepalive/heartbeat but never trust browser tab liveness fully

---

# 30. Browser vs Desktop Implementation Split

## 30.1 Desktop (Rust/Tauri)

Recommended crates/components:

- `automerge`
- `automerge-repo-rs` or custom sync integration
- `webrtc-rs` for immediate production if Tokio coupling is acceptable
- or `rtc`-based future path for runtime-agnostic integration
- `rust-libp2p` for optional mDNS/Kademlia/Rendezvous discovery
- native file store for asset cache
- Tauri IPC for UI integration

## 30.2 Browser

Use:

- browser WebRTC APIs
- Automerge JS/WASM bindings
- browser file APIs for exported `.sdaw` bundles
- IndexedDB/OPFS for local persistent state and asset cache
- same protocol envelopes as native path

## 30.3 Shared Protocol Layer

Define one protocol schema shared by both:

- peer hello
- approval
- role token
- CRDT sync frame
- presence frame
- transport frame
- asset manifest
- chunk request/response
- chat frame
- error frame

---

# 31. Rust Module Architecture

Recommended new crate:

- `daw-collab`

Suggested modules:

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

Suggested bridge traits:

- `ProjectCrdtAdapter`
- `AssetStore`
- `RealtimeTransport`
- `DiscoveryProvider`
- `PresenceBroadcaster`

---

# 32. Project ↔ Engine Bridge

## 32.1 Rule

The collaborative document is not the live engine state.

Instead:

- CRDT changes update canonical project model
- canonical model is validated
- validated model emits engine commands or rebuilt snapshots

## 32.2 Command Mapping

Examples:

- add track → engine project mutation
- change fader → mixer parameter update
- move clip → arrangement mutation
- add note → MIDI clip mutation
- set plugin param → parameter automation/update if plugin exists locally
- transport command → engine transport action

This decouples collaboration correctness from the audio engine.

---

# 33. Recommended Protocol Envelope Examples

## 33.1 Presence Frame

```json
{
    "type": "presence",
    "peerId": "peer_a",
    "seq": 102,
    "view": "arrangement",
    "timeRange": [32.0, 96.0],
    "trackIds": ["trk_a", "trk_b"],
    "selection": ["clip_1"],
    "cursorBeat": 64.0,
    "action": "editing Lead Vox MIDI"
}
```

## 33.2 Asset Request

```json
{
    "type": "asset.request",
    "hash": "blake3:abc...",
    "missingChunks": [0, 1, 2, 7, 8]
}
```

## 33.3 Role Grant

```json
{
    "type": "role.grant",
    "peerId": "peer_b",
    "role": "editor",
    "sessionEpoch": 3,
    "signature": "..."
}
```

---

# 34. Recommended Implementation Phases

## Phase 1 — Offline-First Project CRDT

- Automerge-backed project documents
- root + track docs
- local persistence
- import/export `.sdaw`
- merge-on-open workflow

## Phase 2 — Manual Realtime P2P

- manual offer/answer
- QR and URL fragment invites
- WebRTC data channel sync
- presence channel
- simple peer list

## Phase 3 — Native LAN Discovery

- Tauri mDNS
- nearby panel
- host approval flow
- local network direct connect

## Phase 4 — Transport and Presence Polish

- transport leader
- clock sync
- follow mode
- richer cursors/selections
- chat and voice

## Phase 5 — Asset Transfer

- content-addressed store
- chunked transfer
- resume
- dedupe
- missing-asset UX

## Phase 6 — Optional Global Discovery

- libp2p Kademlia / Rendezvous for desktop
- passphrase-based session lookup
- VPN integration helpers

## Phase 7 — Advanced Security and Roles

- role grants
- actor authorization
- signed permissions
- plugin lock semantics
- session fingerprints

---

# 35. Minimal Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Use **Automerge** as the canonical local-first project CRDT, split into a root doc plus child docs for tracks/clips/automation where needed.
2. Use **WebRTC** as the primary realtime transport for data channels and media streams.
3. Support multiple zero-server discovery methods: manual copy/paste invites, QR, URL fragment, native mDNS LAN discovery, and optional desktop DHT/rendezvous or VPN direct modes.
4. Keep **presence** out of the CRDT; broadcast it as transient awareness data at a throttled rate.
5. Represent DAW entities with stable IDs and order keys, not raw nested arrays everywhere.
6. Use field-level CRDT semantics for built-in device parameters, but treat opaque third-party plugin state as coarse LWW snapshots or locked edit domains.
7. Sync only project structure through CRDT; move audio/sample assets through a separate content-addressed chunk-transfer protocol with resume and hash verification.
8. Elect a transport leader and synchronize play/seek using peer clock-offset estimation, not blind wall-clock assumptions.
9. Keep every peer’s copy authoritative locally; offline edits continue and merge automatically on reconnect or file exchange.
10. Enforce roles with session-signed capability tokens and reject unauthorized mutating updates locally.
11. Map collaborative project changes into validated engine commands or snapshots instead of letting remote state write directly into the audio engine.
12. Be honest about latency: collaborative editing and monitoring work well, but tight internet jamming does not.

---

# Supplement: Super-Simple Collaboration UX Spec

## Goal

Collaboration must feel obvious.

A normal user should be able to start or join a session without understanding:

- CRDTs
- WebRTC
- NAT
- signaling
- discovery
- relays
- peer-to-peer networking

The product should feel like:

> Click **Collaborate** → send invite → collaborator joins → start working.

---

# 1. Product Rule

The collaboration UI must be built around **one obvious default path**.

That default path is:

1. **Start Session**
2. **Copy Invite**
3. other person clicks **Join Session**
4. they **Paste Invite**
5. both are in

Everything else is secondary.

---

# 2. Visible UX in v1

Only show these three join methods in the main UI:

- **Copy Invite**
- **Show QR**
- **Nearby**

Everything else goes under **Advanced**.

Do **not** expose passphrases, DHT, STUN, TURN, relay profiles, or VPN details in the main flow.

---

# 3. Main Entry Point

Add a single top-bar button:

**Collaborate**

Clicking it opens a simple modal with only two primary actions:

- **Start Session**
- **Join Session**

That is the first screen. Nothing more.

---

# 4. Start Session Flow

## 4.1 Screen

Title: **Start Collaboration**

Visible controls:

- **Session Name**  
  Prefilled with current project name

- **Who can edit**
    - **Anyone who joins can edit**
    - **Ask me before people join**

- **Optional**
    - **Voice chat** toggle

Primary button:

- **Start Session**

Secondary button:

- **Cancel**

No networking jargon on this screen.

---

## 4.2 After Starting

Show a second screen with three large actions:

- **Copy Invite**
- **Show QR**
- **Nearby**

Small helper text:

> Send the invite to someone you trust.  
> They can join by pasting the invite, scanning the QR code, or choosing you from Nearby.

Also show:

- session name
- your display name
- a short session fingerprint

---

# 5. Join Session Flow

## 5.1 Screen

Title: **Join Collaboration**

Visible controls:

- large paste field with placeholder:
  **Paste invite here**
- button:
  **Paste from Clipboard**
- button:
  **Scan QR**
- button:
  **Nearby**

Primary button:

- **Join Session**

Secondary button:

- **Cancel**

That is all most users should need.

---

## 5.2 After Pasting or Scanning

Show a confirmation card:

- **Session:** Soul Session
- **Host:** Alex
- **Project:** Midnight Blues
- **Access:** Editor / Waiting for approval
- short fingerprint

Buttons:

- **Join**
- **Cancel**

If approval is needed, show:

> Waiting for host approval…

---

# 6. Nearby Flow

## 6.1 Nearby Tab / Panel

Show a simple list like:

- **Alex’s MacBook** — _Midnight Blues_
- **Maya’s Desktop** — _Mix Review_
- **Studio Laptop** — _New Session_

Each row shows:

- name
- project/session name
- local-only badge
- join button

Clicking a row opens the same confirmation card as a pasted invite.

## 6.2 Rule

Nearby should feel like AirDrop:

- see nearby sessions
- click one
- join

No setup language should mention mDNS, LAN broadcast, or discovery protocols.

---

# 7. In-Session UI

Once connected, the collaboration UI should stay minimal.

## 7.1 Top Bar Indicator

Show a compact pill in the top bar:

**Collaborating • 2 people**

Clicking it opens the session panel.

## 7.2 Session Panel

Show only:

- participant list
- roles
- connection status
- follow mode
- voice chat toggle
- leave session

Each participant row shows:

- name
- color
- role
- connected / reconnecting
- latency indicator

Optional row actions:

- **Follow**
- **Mute voice**
- **Change role** (host only)

---

# 8. Presence UX

Presence should be visible, but lightweight.

## 8.1 Arrangement View

Show:

- colored collaborator cursors
- colored highlights on selected clips
- small colored dot on focused tracks

## 8.2 Piano Roll

Show:

- collaborator note selection highlights
- collaborator edit cursor

## 8.3 Mixer / Devices

Show:

- small color chip on the control another person is touching
- optional “Alex is editing this” label for active device editing

Do not clutter the screen with avatars everywhere.

---

# 9. Host Approval UX

If approval mode is enabled, the host gets a simple prompt:

**Maya wants to join**

- Name: Maya
- Role requested: Editor
- Fingerprint: `blue-river-echo`

Buttons:

- **Allow as Editor**
- **Allow as Viewer**
- **Deny**

That is enough for v1.

---

# 10. Error UX

Errors must be simple and actionable.

## 10.1 If direct connection fails

Show:

**Couldn’t connect directly**

Then provide only three actions:

- **Try Again**
- **Use Nearby** (if applicable)
- **Open Advanced Options**

Under that, short helper text:

> Some networks block direct peer connections.  
> Try again on the same local network, or use a VPN if needed.

Do not dump WebRTC/STUN/TURN jargon into the default error state.

---

# 11. Advanced Options

Everything below should live behind an **Advanced** disclosure:

- join by passphrase
- VPN direct mode
- custom STUN server
- custom TURN server
- relay profile
- rendezvous / DHT options
- transport diagnostics
- ICE candidate details

Normal users should never need to open this.

---

# 12. Default Product Copy

## Start Session screen

- **Start Collaboration**
- **Who can edit**
- **Voice chat**
- **Start Session**

## Invite screen

- **Copy Invite**
- **Show QR**
- **Nearby**

## Join screen

- **Join Collaboration**
- **Paste Invite**
- **Scan QR**
- **Nearby**
- **Join Session**

## In session

- **Collaborating • N people**
- **Follow**
- **Leave Session**

Keep the language plain and human.

---

# 13. v1 Product Constraints

For v1, collaboration should be intentionally narrow and obvious.

## Must ship

- Start Session
- Join Session
- Copy Invite
- QR
- Nearby
- participant list
- cursor/selection presence
- leave session

## Can ship if ready

- approval mode
- voice chat
- follow mode

## Hide for later / advanced

- passphrase discovery
- DHT/rendezvous
- custom relay settings
- VPN/direct advanced networking UI

---

# 14. Final UX Rule

The entire collaboration feature should be understandable in under five seconds.

A user should see:

- **Collaborate**
- **Start Session**
- **Copy Invite**
- **Join Session**
- **Paste Invite**

and immediately know what to do.

If the UI makes users think about networking, it is too complicated.
