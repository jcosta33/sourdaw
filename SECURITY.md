# Security Policy

## Supported source

There are no supported releases. Security reports against the current source on
`main` are accepted.

## Report a vulnerability

GitHub Private Vulnerability Reporting is enabled for
[`jcosta33/sourdaw`](https://github.com/jcosta33/sourdaw/security). Please use it
for vulnerabilities and do not open a public issue first.

## Current bounds

- CLAP discovery is split from hosting. The application may enumerate authorized
  candidates, but plugin code and descriptors are read by a bounded child scan
  process. Loaded CLAP plugins then run in the native application process. Scan
  isolation is not hosting isolation.
- VST3 is unsupported and is not a loadable plugin surface.
- Sourdaw-owned audio callbacks avoid heap allocation, locks, and blocking IPC.
  This discipline does not make claims about code inside a third-party plugin.
- Guarded ZIP input is capped at 2 GiB, 10,000 entries, 255-byte paths, 512 MiB
  per entry, 2 GiB total uncompressed data, and a 100:1 compression ratio. It
  rejects nested archives, symlinks, encrypted entries, and unsupported ZIP
  forms.
- `.sdaw` decoding checks its magic, format version, declared document and data
  lengths, and UTF-8 document IDs. The `.sdaw` format is not a general promise
  that every possible resource exhaustion case is eliminated.
- Desktop packaging uses ad-hoc signing. There is no distribution signing,
  notarization, updater, or publish pipeline. The macOS app sandbox is disabled
  for the current plugin-capable build.

These are implementation bounds, not a guarantee that the surrounding platform,
provider, operating system, or plugin is harmless. Report a bypass through the
private channel above.
