# Third-Party Notices

Sourdaw uses two LGPL packages without source modifications. FaustWasm runtime files are copied
byte-for-byte from its package. Vite bundles lamejs into Sourdaw's application code.

| Component | Version | License           | Source                                                                                                                                                                                                              |
| --------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FaustWasm | 0.16.7  | LGPL-2.1-or-later | [wrapper](https://github.com/grame-cncm/faustwasm/archive/a1ae243d885d6494409a2a4a227cbdd2a6833edf.tar.gz), [compiler](https://github.com/grame-cncm/faust/archive/011423ab76674cd96009385af15cadcd281a3259.tar.gz) |
| lamejs    | 1.2.7   | LGPL-3.0-only     | [source](https://github.com/gideonstele/lamejs/archive/1fb0ef5fa177413107e2e107d054a9b994e3f79c.tar.gz)                                                                                                             |

FaustWasm's `COPYING.txt` grants LGPL-2.1-or-later despite the package metadata naming LGPL-3.0.
Its notice is preserved. lamejs declares LGPL-3.0. The upstream notices and complete license texts
are beside this file.

FaustWasm's package source is pinned by npm `gitHead`. The bundled compiler identifies itself as
2.86.2; the matching Faust version commit is pinned, but a reproducible rebuild has not yet proven
that exact compiler commit produced the binary.

See [SOURCES.json](./SOURCES.json) for exact package, source, and file identities. See
[RELINKING.md](./RELINKING.md) to replace either library and rebuild Sourdaw.
