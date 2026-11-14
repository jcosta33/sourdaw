# Rust dependency ports

These sources keep their published package names and versions. They are locally modified copies, selected by the root Cargo patch table so consumers can use current stable child APIs. They are not unmodified crates.io packages and do not carry fabricated registry checksums.

`sources.json` records each original archive URL and SHA-256, upstream revision, license paths, reason for the port, compressed and decoded patch SHA-256, and before/after hashes of each changed file. `patches/` stores deterministic gzip-compressed exact unified diffs. Decode with `gzip -dc <patch.patch.gz> > <decoded.patch>`, verify its recorded content hash, then apply to the corresponding unpacked published archive with `patch -p1 --input <decoded.patch>`; upstream license and provenance files stay beside the source. Cargo obtains registry package checksums through ordinary resolution.

The root workspace explicitly excludes these upstream packages. Their development dependencies and complete upstream suites are not Sourdaw workspace contracts. `fixtures/` is an independent, bounded consumer fixture crate; its binding ABI fixture generates from the bundled Whisper headers, without an old generated binding fallback.

The Windows projection port covers the features used by the retained native device and MIDI routes. Native Windows compilation and ABI behavior require Windows CI. Source preparation or a macOS check does not prove Windows, Linux, Android, device hardware, model inference, or plugin UI behavior.

When changing a port, preserve the original archive identity, regenerate its patch and changed-file hashes, and check native patch application and final source bytes. Move to an upstream release containing the migration when available.

The Midir Android listener remains owned through the existing five-second receive timeout. Both the
original `JniProxy` and current `DynamicProxy` remove their Rust handler on drop; a later void
callback with no handler returns null in both helpers. The existing ignored channel-send failure
and device-close behavior are preserved. No forgotten proxy or additional lifetime registry extends
the listener. Android compilation and actual JVM/AMidi callback and device lifecycle checks are
separate from desktop acceptance.
