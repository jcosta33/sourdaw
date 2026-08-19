# Plugin Hosting Security Policy

This document defines the current security posture for native plugin hosting.

Plugin hosting intentionally crosses native trust boundaries: Sourdaw loads third-party dynamic code,
opens vendor editor windows, and scans filesystem locations outside the project file. Those capabilities
must stay native-owned. The renderer may request a scan, but it does not grant itself filesystem authority
by sending raw path strings over IPC.

## 1. Scan roots

Built-in scan roots are owned by the native layer. `get_default_plugin_paths` returns the platform roots
that Sourdaw is willing to scan by default, and `scan_plugins` accepts only those roots or their
descendants.

Current defaults:

- macOS: `~/Library/Audio/Plug-Ins/{VST3,CLAP,Components}` and `/Library/Audio/Plug-Ins/{VST3,CLAP,Components}`
- Windows: `C:\Program Files\Common Files\{VST3,CLAP}`
- Linux: `~/.vst3`, `~/.clap`, `/usr/lib/vst3`, and `/usr/lib/clap`

Custom plugin folders require a future native grant or trusted preference flow before they can be scanned.
A renderer-provided absolute path is not enough authority.

The scanner also refuses symlinked plugin paths, including paths with symlinked ancestors. A symlink
under or at an allowed root must not become an implicit grant to scan or load a target outside the
native-owned root set.

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
VST3, or AU hosting.

## 4. Release rule

Each release channel must choose one of these profiles explicitly:

- Plugin-host-capable: broad macOS runtime entitlements are present, native scan policy is enforced, and
  third-party plugin code may be loaded.
- Reduced-capability: plugin-hosting commands are disabled or absent, broad plugin-hosting entitlements are
  removed, and scan/load UI paths are not exposed.

No release should accidentally ship plugin-hosting entitlements without also shipping the native policy
that constrains scan roots and keeps runtime handles behind the native boundary.
