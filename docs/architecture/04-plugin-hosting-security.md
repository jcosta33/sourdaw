# Plugin Hosting Security Policy

This document defines the current security posture for native plugin hosting.

Plugin hosting intentionally crosses native trust boundaries: Sourdaw loads third-party dynamic code,
opens vendor editor windows, and scans filesystem locations outside the project file. Those capabilities
must stay native-owned. The renderer may request a scan, but it does not grant itself filesystem authority
by sending raw path strings over IPC.

Every hosted format crosses the same boundary and is held to the same rules here: a format is either
implemented behind the shared host seam or refused by name with its reason, and a refused format is
never advertised and never loaded. VST is a registered trademark of Steinberg Media Technologies GmbH.

## 1. Scan roots

Built-in scan roots are owned by the native layer. `get_default_plugin_paths` returns the platform roots
that Sourdaw is willing to scan by default, and `scan_plugins` accepts only those roots, the folders the
user granted, or their descendants.

The default set is each format's own installation folders on the running platform, as those formats'
specifications define them. `crates/sourdaw-native/src/host/plugin_scan_policy.rs` is the list; this
document states the rules it has to satisfy rather than repeating it.

The order of that list is a contract, not presentation. It runs most specific first — per-user
folders, then machine-wide, then network — because the scan keeps the first copy of a plugin identity
it meets and drops the rest. That is the VST® 3 specification's own rule for its folders, and Sourdaw
applies it to every hosted format, so a plugin installed twice is hosted from the copy the user
installed most deliberately.

A default folder is located the way the platform names it, never by a spelling that usually matches.
On Windows both formats define their folders relative to `%COMMONPROGRAMFILES%` and `%LOCALAPPDATA%`,
and Sourdaw resolves them from the shell's own known folders (`FOLDERID_ProgramFilesCommon`,
`FOLDERID_LocalAppData`) — the same query the VST® 3 SDK's Windows host module makes — rather than from
a drive letter or from the process environment. A folder the shell cannot name is left out, not guessed.

### Custom plugin folders are granted by a native folder pick

A plugin folder outside the defaults is scanned only once the user has granted it
([ADR 0061](../../.agents/decisions/0061-plugin-folders-are-granted-by-a-native-folder-pick.md)). A
renderer-provided absolute path is not enough authority, and no other route adds one.

- **Origin.** A grant is minted only inside the main-process handler that owns a native folder
  dialog's result: the handler passes the path the dialog returned straight to the addon's
  grant command. The renderer never sends a path to be granted, and the grant command is denied
  to the renderer's command surface.
- **Storage.** Grants persist in the private native state directory, which no file command resolves
  into and no project or collaborator writes. The file is not authority by itself; it is bounded in
  size and count and read whole or not at all.
- **Re-validation.** Every use — each scan, registry hydration and plugin load builds its policy
  afresh — re-runs the pick's checks on each stored grant and requires it to resolve to exactly the
  path that was granted. A granted folder that is missing (a drive not connected), has become a
  symbolic link or now resolves elsewhere grants nothing and is listed unavailable with its reason;
  a folder swapped for a symbolic link is refused, never followed. An unavailable grant stays
  recorded so a reconnected drive works again.
- **Overlap refusals.** A pick is refused when it is a filesystem root, the user's home folder or an
  ancestor of it — any of which would hand the scan every file the user owns — when it is inside or
  contains a default plugin folder, which keeps the defaults' priority order the only one that
  applies to them, and when it is inside or contains storage the renderer may write without a user
  pick, because a plugin folder there would let a page plant native code that the scan and the
  loader then execute. For the same reason a pick is refused when it is inside or contains a path
  the user granted read-write file access to, and a stored grant becomes unavailable once such a
  file grant appears. A pick inside an existing grant is refused; one containing existing grants
  replaces them, so grants never overlap.
- **Ranking.** Granted folders rank after every default folder, in grant order, so a copy of a
  plugin in a default folder always wins.
- **Revocation.** Revoking removes the stored grant; the next policy built refuses the folder and
  every plugin under it. Revoking only narrows authority, so the renderer may ask for it.

Exactly one production constructor widens the scan policy past the platform defaults, and it reads
only this grant store. `get_default_plugin_paths` still reports the defaults alone.

### `CLAP_PATH` is not a scan root

CLAP's discovery rule asks a host to read the `CLAP_PATH` environment variable as a list of extra
directories to search. Sourdaw does not, on any platform.

The variable is outside the renderer's reach, but that is not what makes a root trustworthy here. A
scan root is an authority the native layer grants, and every path it adds is third-party code the scan
worker loads. `CLAP_PATH` is a custom root set by whatever launched the process — a shell profile, a
launcher, an installer's leftover — with no grant, no record, and no way for the person running
Sourdaw to see or revoke it. A user who keeps plugins in a `CLAP_PATH` folder picks that folder in the
plugin-folder dialog like any other, and from then on it is a grant they can see and revoke.

The scanner also refuses symlinked plugin paths, including paths with symlinked ancestors. A symlink
under or at an allowed root must not become an implicit grant to scan or load a target outside the
native-owned root set. What a scan walks is the path the policy resolved, never the caller's spelling
of it: a check made against one path and a walk made against another is not a check.

### Network scan roots are an accepted risk

The macOS default set includes the network-mounted plug-in folder that the VST® 3 specification
defines, and that folder is administered by whoever controls the mount rather than by the person
running Sourdaw. A plugin found there is third-party dynamic code from a source this machine does not
own, and scanning it means loading it in the bounded worker.

This is deliberate, and the reason is that a shared studio installs its plugins there — refusing the
folder would not make the code untrusted, it would make the plugins invisible while the same binaries
stay loadable through every other host on the machine. The risk is bounded the same way every other
root is: last in the priority order, so a local copy of the same plugin always wins; symlinks refused;
descriptors read in the bounded child-process worker. It is named here so that a reader of this policy
does not mistake the mount for machine-owned.

## 2. IPC boundary

Native command bodies expose DTOs and delegate policy decisions to native/plugin-host services. Bodies must
not leak live plugin handles, runtime owners, library handles, or editor-window handles across IPC.

`scan_plugins(paths, state)` accepts string DTOs because IPC payloads are serialized, but the command must
validate each path against the native scan policy before touching the filesystem or mutating the plugin
registry.

## 3. macOS entitlements

`build/entitlements.mac.plist` currently contains broad plugin-hosting entitlements:

- disabled library validation
- JIT-mapped executable memory
- App Sandbox disabled

These are allowed only for plugin-host-capable desktop builds. They are not the default policy for a
future non-plugin-hosting release channel, helper process, or reduced-capability build.

Do not remove these entitlements from the current plugin-host-capable build until the replacement plugin
scan, load, and editor-window model is implemented and verified. Removing them early can break real CLAP,
VST® 3, or AU hosting.

## 4. Release rule

Each release channel must choose one of these profiles explicitly:

- Plugin-host-capable: broad macOS runtime entitlements are present, native scan policy is enforced, and
  third-party plugin code may be loaded.
- Reduced-capability: plugin-hosting commands are disabled or absent, broad plugin-hosting entitlements are
  removed, and scan/load UI paths are not exposed.

No release should accidentally ship plugin-hosting entitlements without also shipping the native policy
that constrains scan roots and keeps runtime handles behind the native boundary.
