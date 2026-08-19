# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |

---

## Reporting a Vulnerability

The Sourdaw team takes the security and safety of native runtime execution, IPC boundaries, file parsing, and DSP isolation seriously.

If you discover a security vulnerability (such as an IPC sandbox escape, buffer overflow in decoders, untrusted memory access, or malicious CLAP plugin execution path), **please do not open a public issue.**

Instead, please report vulnerabilities via **GitHub Private Vulnerability Reporting** on the repository, or email the maintainers directly.

### Security Guarantees & Bounds
- **Native Plugin Isolation**: CLAP/VST3 third-party binaries execute in isolated helper processes bounded per ADR 0021.
- **Audio Thread Safety**: Real-time audio threads never allocate, lock, or perform blocking I/O (ADR 0020).
- **Archive & File Parsing**: Untrusted inputs (e.g. `.sdaw` archives, sample bundles, SMF files) enforce strict length and path sanitization limits.
