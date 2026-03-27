# Every viable free sample source for DAW integration in 2026

**Freesound.org and a handful of CC0 GitHub-hosted libraries emerge as the strongest integration candidates for a commercial DAW, but no single source solves every need.** The landscape splits cleanly into two tiers: sources with open APIs and permissive licenses (Freesound, Internet Archive, ccMixter, Zenodo) versus sources with excellent content but legal or technical barriers (Looperman, Cymatics, Splice, BBC). This guide documents every viable source with the technical detail needed to build production integrations. The critical finding across all research: **most "royalty-free" platforms prohibit redistribution**, meaning bundling their samples inside a commercial DAW product violates their terms — only CC0 content and a few explicitly permissive sources are safe for shipping.

---

## Freesound.org: the richest API but commercially complex

Freesound hosts **714,671 sounds** (as of late 2025) totaling over 536 days of audio, making it the single largest CC-licensed sound library with a proper REST API.

**API architecture.** The v2 API at `https://freesound.org/apiv2/` offers comprehensive search, metadata retrieval, and download endpoints. Authentication uses two modes: **token-based** (API key as query parameter, sufficient for search and preview downloads) and **OAuth2** (required for original-quality downloads). OAuth2 follows the standard authorization code flow with 24-hour access tokens and refresh tokens. Rate limits cap at **60 requests/minute** and **2,000/day** for search operations, with original-quality downloads limited to **500/day**.

**Search is exceptionally powerful.** The primary endpoint (`/apiv2/search/text/`) supports Solr-syntax filtering across dozens of fields: `tag`, `duration`, `samplerate`, `bitdepth`, `channels`, `license`, `created`, `avg_rating`, `num_downloads`, and the new `bst_category` (Broad Sound Taxonomy, introduced April 2025). The `descriptors_filter` parameter enables filtering by auto-extracted audio features like `rhythm.bpm:[119 TO 121]` or `tonal.key_key:C`. Pagination uses standard `page`/`page_size` parameters with `next`/`previous` URLs.

**Metadata is the deepest of any source studied.** Every sound exposes user-provided fields (name, tags, description, license, duration, channels, sample rate, bit depth, file size) plus auto-extracted Essentia analysis: **BPM** (`rhythm.bpm`), **musical key** (`tonal.key_key` + `tonal.key_scale` with confidence scores), pitch, spectral features, loudness, and AudioCommons descriptors (`ac_tempo`, `ac_tonality`, `ac_brightness`, `ac_warmth`, etc.). Waveform and spectrogram PNGs are generated for every sound. The BST taxonomy provides structured categorization across five top-level categories (Sound Effects, Music, Instrument Samples, Soundscapes, Speech/Voices).

**License breakdown across the database**: approximately **55–65% CC0**, **20–30% CC-BY**, and **10–15% CC-BY-NC** (with a trace of legacy Sampling+ on very old uploads). The API supports license filtering via `filter=license:"Creative Commons 0"`. CC0 content is safe for unrestricted commercial use. CC-BY content is commercially usable if the DAW provides an attribution mechanism.

**Critical commercial caveat**: Freesound's API terms state that **commercial use of the API requires a negotiated license with UPF** (contact: mtg@upf.edu). The terms also require that users have valid Freesound credentials for downloads, and prohibit replicating Freesound in another service. Preview downloads (128kbps MP3, 192kbps OGG) work with simple token auth; original-quality downloads require OAuth2. Downloading the full CC0 catalog at 500 files/day would take over two years without elevated limits. **Estimated storage for all CC0 content: 2–5 TB.**

| Attribute         | Detail                                          |
| ----------------- | ----------------------------------------------- |
| Total sounds      | ~714,671                                        |
| CC0 sounds (est.) | ~393,000–430,000                                |
| API auth          | Token (search/preview) + OAuth2 (downloads)     |
| Rate limits       | 60 req/min, 2,000/day search; 500 downloads/day |
| Formats           | WAV, FLAC, AIF, OGG, MP3 (as uploaded)          |
| BPM/Key metadata  | Yes (auto-extracted, with confidence scores)    |
| Client libraries  | Python, JUCE/C++, JavaScript, Rust              |

---

## BBC Sound Effects: professional quality behind a restrictive license

The BBC Sound Effects Library offers **~16,000 sounds freely** (via the Rewind site at `sound-effects.bbcrewind.co.uk`) and approximately **29,420 sounds commercially** through Pro Sound Effects. These are professionally recorded by BBC engineers dating back to the 1920s.

**Access is static, not API-driven.** A CSV catalog at `sound-effects.bbcrewind.co.uk/assets/BBCSoundEffects.csv` contains six columns: `location` (filename), `description`, `secs` (duration), `category`, `CDNumber`, and `CDName`. Audio files are downloadable as WAV at `http://bbcsfx.acropolis.org.uk/assets/{filename}`. A complete archive torrent exists on Internet Archive. **No REST API, no authentication for file access, but no search capabilities beyond parsing the CSV.**

**The RemArc license blocks commercial use.** The free version permits personal and educational use only — **no commercial use, no selling music made with these sounds, no redistribution**. Commercial licensing through Pro Sound Effects runs **$1,999 for the complete 29,420-sound library** with lifetime royalty-free rights. Audio quality is excellent: WAV, predominantly 16-bit/44.1kHz. Total storage for the free subset is **~284–305 GB**. Categories number 200+ (birds, transport, warfare, household, atmospheres, etc.) but there is no BPM, key, or tag metadata — only free-text descriptions and a single category field.

---

## Internet Archive: the largest open audio repository with a free API

The Internet Archive's audio collections span millions of items across subcollections including Netlabels (CC-licensed music), Community Audio, Old Time Radio, Live Music Archive, and 78RPM recordings. Its API requires **no authentication for searching, browsing metadata, or downloading**.

**Three API access methods exist.** The Advanced Search API (`archive.org/advancedsearch.php`) supports Lucene queries with JSON/XML/CSV output but caps at 10,000 sorted results. The Scraping API (`archive.org/services/search/v1/scrape`) enables cursor-based deep pagination through unlimited results. The Metadata API (`archive.org/metadata/{identifier}`) returns complete JSON including all files, sizes, formats, and per-file checksums. Downloads use direct HTTP: `archive.org/download/{identifier}/{filename}`. The `internetarchive` Python library provides a CLI (`ia download`) for bulk operations.

**License filtering works via the `licenseurl` metadata field**: `licenseurl:*publicdomain*` for CC0, `licenseurl:*creativecommons.org/licenses/by/*` for CC-BY. The Netlabels collection contains thousands of CC-licensed albums. However, **metadata quality is highly inconsistent** — community uploads frequently have missing or incorrect license tags, and some copyrighted material is mis-tagged as CC. Audio quality ranges from professional FLAC to amateur MP3. There is no controlled vocabulary for categorization, only freeform `subject` tags and collection hierarchy. Rate limiting is undocumented but automated access requires proper User-Agent headers. The archive experienced a major breach in 2024 and periodic availability issues.

---

## ccMixter: open API, no auth required, remix-focused content

ccMixter at `ccmixter.org` provides a **fully open Query API** (`ccmixter.org/api/query`) that returns JSON, XML, CSV, RSS, or M3U — **no API key required**. The API supports filtering by license (`lic=by` for CC-BY), tags, username, date range, and full-text search, with pagination via `limit` and `offset` parameters.

The library contains **~30,000+ tracks** with an estimated 10,000+ individual samples. The dig.ccMixter subset curates **~4,200+ tracks specifically cleared for commercial use** under CC-BY. Content focuses on remixes, stems, and a cappellas rather than production-ready one-shots and loops. A significant limitation: **files are capped at 10 MB per upload**, resulting in predominantly compressed MP3/OGG rather than lossless WAV. There is **no structured BPM or key metadata** in the API — only freeform genre, instrument, and mood tags. License filtering is well-supported, and the remix genealogy tracking (sample lineage) is a unique feature. Estimated storage for CC-BY content: **~20–50 GB**.

---

## OpenGameArt.org: CC0 game audio without an API

OpenGameArt enforces a policy that **all content must be under free licenses** — no NC or ND clauses permitted. This means every audio asset is commercially usable. The CC0 subset includes approximately **3,490 music files and 811 sound effects**. Additional assets use CC-BY, CC-BY-SA, or OGA-BY (a CC-BY variant removing the DRM restriction clause).

**There is no API.** The site runs on Drupal with no exposed endpoints. Advanced search is available via URL parameters, and a third-party HuggingFace mirror (by nyuuzyou) provides scraped/archived content organized by license. Content is game-oriented: chiptune, retro SFX, jingles, and background music. There is no BPM or key metadata. Audio formats include WAV, OGG, and MP3 at variable quality. Scraping risks IP blocking, and the site operates on a modest budget (~$6,000/year). Estimated CC0 audio storage: **~20–40 GB**.

---

## GitHub-hosted libraries are the safest bet for bundling

Three GitHub-hosted sources stand out for commercial DAW integration because of their **CC0 licensing, structured metadata, and SFZ instrument mappings**.

**VCSL (Versilian Community Sample Library)** at `github.com/sgossner/VCSL` is explicitly designed for software integration. Licensed **CC0**, it contains **~4+ GB** of 16/24-bit WAV samples organized by the Hornbostel-Sachs classification system (aerophones, chordophones, electrophones, idiophones, membranophones). Filenames encode instrument, articulation, microphone, velocity layer, and round-robin number. An SFZ branch provides ready-to-use sampler mappings, and a Python utility auto-generates SFZ files from raw samples. The project is in slow-growth maintenance mode with an active Discord community.

**The sfzinstruments GitHub organization** (`github.com/sfzinstruments`) hosts 20+ repositories of open-source SFZ instruments. Key CC0 repos include the Splendid Grand Piano (Steinway), Black & Blue Basses, Ergo EUB, Gogodze Phu percussion, and the **Discord-SFZ-GM-Bank** (a full General MIDI bank restricted to CC0/CC-BY content). Quality ranges from good to excellent, with professional multi-velocity, multi-round-robin sampling.

**LMMS Assets** (`github.com/LMMS/assets`) enforces **strict CC0-only submissions** through a community review process. Content is FLAC at 44.1kHz, peak-normalized to -3 dBFS. The collection includes drum kits, melodic one-shots, basslines, and sound effects. It is actively maintained with a structured folder taxonomy.

| Repository                 | License   | Size                | Format        | SFZ Mappings     |
| -------------------------- | --------- | ------------------- | ------------- | ---------------- |
| VCSL                       | CC0       | ~4 GB               | 16/24-bit WAV | Yes (sfz branch) |
| sfzinstruments (CC0 repos) | CC0/CC-BY | Varies (MB–GB each) | WAV + SFZ     | Yes              |
| LMMS Assets                | CC0       | Growing             | FLAC 44.1kHz  | No               |
| Discord-SFZ-GM-Bank        | CC0/CC-BY | Multi-GB            | WAV + SFZ     | Yes (full GM)    |

---

## Academic sources deliver exceptional quality for orchestral instruments

Two academic instrument sample collections rival commercial libraries in recording quality and carry the most permissive licensing found in this survey.

**The University of Iowa Musical Instrument Samples** (MIS) at `theremin.music.uiowa.edu/MIS.html` provides note-by-note recordings of **23+ orchestral instruments** at three dynamic levels, recorded in an anechoic chamber since 1997. The license is effectively **unrestricted** — "may be downloaded and used for any projects, without restrictions." Post-2012 string recordings are available at **24-bit/96kHz stereo** (Decca Tree setup with Earthworks QTC-40 microphones). Coverage spans complete woodwind, brass, string, and percussion sections. There is no bulk download ZIP, but community scripts exist. Estimated total: **~5–10 GB**. This is the single highest-quality freely licensed orchestral sample source identified.

**Philharmonia Orchestra Sound Samples** at `philharmonia.co.uk/resources/sound-samples/` offers thousands of individual note samples recorded by Philharmonia players covering all standard orchestral instruments plus guitar, mandolin, and banjo. Licensed **CC-BY-SA 3.0** with the restriction that samples cannot be sold "as-is" as sample packs. The limitation: files are distributed as **MP3 only**, not lossless. These samples underpin projects like Virtual Playing Orchestra and are already organized by instrument, note, dynamics, and articulation. Estimated storage: **~2–3 GB**.

---

## SampleSwap, Looperman, and OLPC: useful content with significant barriers

**SampleSwap.org** offers **~19,000 samples** (9.4 GB as a single ZIP) in 16-bit/44.1kHz WAV, organized into hand-curated categories: drum loops, drum hits, drum kits, sound effects, instruments, vocals, and melodic loops. Contributors are asked to release sounds into the public domain, but the site explicitly states it **cannot guarantee all content is copyright-clear**. No API exists. Registration is required for downloads, and the full ZIP requires a paid "SuperStar" membership (~$39). The site is maintained by a single curator and was last updated in February 2021.

**Looperman.com** has the **richest structured metadata of any source studied** — every loop includes user-specified BPM, musical key, genre, instrument category, and time signature — across an estimated **200,000–300,000+ loops**. However, it has **no API**, and its Terms of Service **explicitly prohibit all scraping and automated access**. The custom royalty-free license permits use only in derivative works (new compositions), not redistribution of raw loops. Integration would require a formal business partnership with Looperman Ltd (UK company #12575092).

**The OLPC Sample Library** contains **6,500+ samples** (×3 sample rates = ~19,500 files) curated by Dr. Richard Boulanger from Berklee College of Music contributors. Licensed **CC-BY**, the collection covers ethnic instruments, synthesizers, percussion, sound effects, and a Yamaha Disklavier piano (1,212 samples). Quality is 16-bit mono WAV, normalized to -3dB, but a percentage of samples exhibit audible hum, hiss, or rough edits. The project is dormant — the OLPC wiki returns errors, but mirrors exist on Internet Archive and ccMixter. Total size: **~8.5 GB** (all sample rates) or **~2.5–3 GB** (44.1kHz only).

---

## Commercial free tiers universally prohibit redistribution

**Every commercial sample platform studied — Cymatics, Splice, Loopmasters, and MusicRadar — explicitly prohibits redistribution, repackaging, or bundling of samples in third-party products.** Their royalty-free licenses cover end-user music production only.

- **Cymatics** offers ~1,000+ free samples across 60+ packs (24-bit WAV), but requires email signup and the license states: "No re-distribution of the sounds...as another product."
- **Splice** has no free sample tier — it operates a credit-based subscription ($12.99+/month). Terms prohibit use "in a manner competitive to Splice" and any redistribution.
- **Loopmasters** provides label samplers for £1 each. License forbids use "within any competitive products that are sold, relicensed, or redistributed."
- **MusicRadar/SampleRadar** offers ~70,000 free samples via direct CDN links with no signup, but terms explicitly state: "don't re-distribute them."

**Legowelt's free sample packs** (~4,400 samples, ~1.5 GB of vintage synth captures) occupy a legal gray area. Danny Wolfers distributes them via WeTransfer with informal terms: "free to use in your productions" but "don't sell the samples themselves." No formal license file exists. DAW bundling would require direct written permission. Content includes Prophet 600, Jupiter 8, Minimoog, Juno 106, DX7, and many more — **unique vintage character unavailable elsewhere**.

**99Sounds and Bedroom Producers Blog** (same owner, Tomislav Zlatić) offer 40+ libraries and 25+ packs respectively in 24-bit WAV. Royalty-free for production use, but redistribution rights are not explicitly addressed. A single licensing negotiation could potentially cover both properties.

---

## Zenodo and Hugging Face host niche but valuable datasets

**Zenodo** provides a REST API (`zenodo.org/api/`) with anonymous search and download for open-access records. Rate limits are **30 requests/minute** with a 10,000-record query cap. Notable music-production-relevant datasets include a **Drum and Percussion Kits** collection (1.2 GB, CC-BY 4.0), **FSD50K** (51,197 Freesound clips across 200 sound classes; ~38% CC0, ~46% CC-BY), and **StemGMD** (1.13 TB of isolated drum stems, CC-BY 4.0). The `zenodo_get` Python package handles batch downloads with MD5 verification.

**Hugging Face** hosts mirrors and derivatives of several audio datasets accessible via the `datasets` Python library with optional streaming (`streaming=True` avoids full download). **NSynth** (305,979 musical notes from 1,006 instruments, CC-BY 4.0) has exceptionally rich metadata but a **16 kHz sample rate** that renders it inadequate for professional production without upsampling. **GigaMIDI** (1.4 million MIDI files) is valuable for MIDI-based workflows. Most HF audio datasets store audio in Parquet/Arrow format requiring the `datasets` library to decode — they are not directly loadable into DAWs.

---

## "Awesome lists" and community curations worth bookmarking

Several GitHub repositories aggregate free sample sources:

- **IsaakCode/freeaudio** (`best_free_samples.md`) — the highest-quality curated list found, linking to sfzinstruments repos, Salamander Grand Piano, Splendid Grand, and dozens of free SFZ instruments
- **bratpeki/sample-packs** — organized links to royalty-free packs by type (drums, breaks, hip-hop, DnB)
- **ad-si/awesome-music-production** — broad coverage of DAWs, plugins, and sample sources
- **nodiscc/awesome-linuxaudio** — comprehensive Linux audio tools with a Samples/Presets section
- **prodfreebies.github.io** — DAW-focused curation of free tools and samples

---

## Ranked recommendations: the 7 best sources to ship in a commercial DAW

The ranking below balances **license permissiveness** (can you legally ship it?), **API quality** (can you build a reliable integration?), **content quality** (will users value it?), and **metadata richness** (can users find what they need?).

**Rank 1: Freesound.org (CC0 subset via API)**
The only source combining a mature REST API, 400,000+ CC0 sounds, auto-extracted BPM/key metadata, structured taxonomy (BST), and official client libraries for Python and JUCE. The tradeoff: commercial API use requires licensing negotiation with UPF, OAuth2 adds user friction for full-quality downloads, and quality is variable (user-contributed). Ship as a **search-and-download integration** where users authenticate with their own Freesound accounts. CC0 content is fully safe for commercial music release with no attribution required.

**Rank 2: VCSL + sfzinstruments (CC0 GitHub libraries)**
The strongest option for **bundled content that ships with the DAW**. VCSL's CC0 license with structured SFZ mappings, Hornbostel-Sachs taxonomy, and consistent recording quality makes it ideal as a built-in orchestral/acoustic starter library. Supplement with CC0 sfzinstruments repos (Splendid Grand Piano, Black & Blue Basses, Discord-SFZ-GM-Bank). Combined size ~5–8 GB uncompressed. Zero legal risk, no API dependency, updatable via GitHub releases.

**Rank 3: University of Iowa Musical Instrument Samples**
The highest recording quality of any free source — anechoic chamber, multi-dynamic, up to 24-bit/96kHz. Unrestricted license means zero legal risk. Coverage of the complete orchestral palette plus piano and guitar. The limitation is no API and no bulk download mechanism, but the dataset is finite and can be mirrored. Ideal as a **premium bundled orchestral sample set** alongside VCSL.

**Rank 4: Internet Archive (CC0/CC-BY audio via Scraping API)**
The only source offering truly massive scale with no authentication required and cursor-based pagination for complete catalog traversal. Best used for curating specific subcollections (Netlabels, sound effects) after filtering by `licenseurl`. The tradeoff: heavy curation overhead due to inconsistent metadata and unreliable license tags, variable quality, and periodic availability concerns. Ship as an **advanced/power-user integration** for discovering niche content.

**Rank 5: ccMixter (CC-BY via open API)**
The simplest API integration path — no authentication, JSON output, license filtering, pagination. The dig.ccMixter subset provides ~4,200+ commercially-cleared tracks. Best for stems, vocals, and remix material rather than one-shots. The tradeoff: MP3-quality files (10 MB upload limit), no structured BPM/key metadata, and the content skews toward full tracks rather than production building blocks. CC-BY is safe for commercial release with attribution.

**Rank 6: LMMS Assets + Zenodo drum datasets**
LMMS Assets provides a growing CC0 collection with strict quality control, while Zenodo's Drum and Percussion Kits dataset (1.2 GB, CC-BY) fills the drum one-shot gap. Both are downloadable without authentication. The tradeoff: smaller libraries that work best as supplementary content rather than primary sources. LMMS content uses FLAC (smaller footprint); Zenodo's API enables automated monitoring for new datasets.

**Rank 7: Philharmonia Orchestra Samples (CC-BY-SA)**
World-class orchestral recordings from one of the world's great orchestras. Already battle-tested in projects like Virtual Playing Orchestra. The tradeoffs are meaningful: **CC-BY-SA requires derivative works carry the same license** (complex implications for a commercial DAW), and the MP3-only distribution reduces fidelity. Best positioned as an optional downloadable expansion with clear license disclosure. End-users releasing music made with these samples can do so commercially, but must license the resulting work CC-BY-SA — making this suitable only for users comfortable with that requirement.

**License safety summary for end-users of a commercial DAW:**

| License                               | Safe for released music? | Attribution needed?         | Complications                         |
| ------------------------------------- | ------------------------ | --------------------------- | ------------------------------------- |
| CC0                                   | **Yes, fully safe**      | No                          | None                                  |
| CC-BY 4.0                             | **Yes, safe**            | Yes (author + license link) | DAW should provide attribution export |
| CC-BY-SA 4.0                          | **Conditionally safe**   | Yes                         | Released music inherits SA license    |
| US Gov Public Domain                  | **Yes, safe**            | Courtesy credit requested   | Cannot imply NASA endorsement         |
| Custom royalty-free (Looperman-style) | **Yes for derivatives**  | Varies                      | Cannot redistribute raw samples       |
| CC-BY-NC                              | **No**                   | —                           | Prohibits commercial use entirely     |

For a commercial DAW shipping in 2026, the optimal strategy combines **VCSL/sfzinstruments as bundled content** (zero legal risk, ships offline), **Freesound as the primary online integration** (requires UPF licensing negotiation), and **University of Iowa MIS as a premium orchestral bundle**. This trio covers CC0 instruments, CC0 sound effects, and unrestricted orchestral samples — the three pillars users need — while keeping the legal surface area minimal.

# Technical reference for a Tauri v2 sample library browser

**This report provides exact endpoints, real IDs, verified URLs, copy-pasteable code, and precise configuration for building a sample library browser in a Tauri v2 desktop DAW.** Each of the seven technical unknowns has been researched against primary sources — official docs, crates.io, GitHub APIs, and Freesound's live pages. Where the research revealed that the original premise was slightly off (notably: notify is at v8.2, not v7; the rodio main-thread issue is less severe than assumed), corrected information is provided.

---

## 1. Freesound OAuth2: the complete flow

### Authorization (Step 1)

```
GET https://freesound.org/apiv2/oauth2/authorize/?client_id=YOUR_CLIENT_ID&response_type=code&state=xyz
```

Only `response_type=code` is supported — Freesound implements the authorization code grant exclusively, not the implicit grant. An alternative endpoint `https://freesound.org/apiv2/oauth2/logout_and_authorize/` forces re-login even if the user has an active session.

### Token exchange (Step 2)

```
POST https://freesound.org/apiv2/oauth2/access_token/
Content-Type: application/x-www-form-urlencoded

client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&grant_type=authorization_code&code=THE_AUTH_CODE
```

Response:

```json
{
    "access_token": "64c64660ceed813476b314f52136d9698e075622",
    "scope": "read write read+write",
    "expires_in": 86399,
    "refresh_token": "0354489231f6a874331aer4927569297c7fea4d5"
}
```

Authorization codes expire in **10 minutes** and are single-use.

### Token refresh (Step 3)

Same endpoint, different `grant_type`:

```
POST https://freesound.org/apiv2/oauth2/access_token/
Content-Type: application/x-www-form-urlencoded

client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&grant_type=refresh_token&refresh_token=YOUR_REFRESH_TOKEN
```

Returns a new access token **and** a new refresh token. The old refresh token is invalidated. Only one access token exists per app/user pair at a time.

### Token lifetime and auth headers

**Access tokens last 24 hours** (86,399 seconds). Authenticated requests use `Authorization: Bearer ACCESS_TOKEN`. For non-OAuth API-key-only requests, use `Authorization: Token YOUR_API_KEY`. After expiry, the API returns **401** with `"Expired token"`.

### Search endpoint and DAW-relevant filters

```
GET https://freesound.org/apiv2/search/text/?query=kick+drum&filter=license:"Creative Commons 0" duration:[0.1 TO 5.0] type:wav samplerate:44100&sort=rating_desc&fields=id,name,license,duration,samplerate,channels,type,previews,download&page=1&page_size=150
```

All filterable fields relevant to a DAW:

| Filter       | Type              | Example                          |
| ------------ | ----------------- | -------------------------------- |
| `duration`   | numeric (seconds) | `duration:[0.1 TO 10.0]`         |
| `license`    | string            | `license:"Creative Commons 0"`   |
| `tag`        | string            | `tag:loop`                       |
| `type`       | string            | `type:wav`, `type:(wav OR aiff)` |
| `samplerate` | numeric           | `samplerate:44100`               |
| `channels`   | integer           | `channels:2`                     |
| `bitdepth`   | integer           | `bitdepth:16`                    |
| `bitrate`    | integer           | `bitrate:1408`                   |
| `filesize`   | integer (bytes)   | `filesize:[0 TO 1000000]`        |
| `bpm`        | numeric           | `bpm:[119 TO 121]`               |
| `key_key`    | string            | `key_key:A`                      |
| `avg_rating` | numeric           | `avg_rating:[3 TO *]`            |

License values are `"Creative Commons 0"`, `"Attribution"`, and `"Attribution Noncommercial"`. Pagination uses `page` (1-indexed) and `page_size` (max **150**). Sort options: `score`, `duration_desc`, `duration_asc`, `created_desc`, `created_asc`, `downloads_desc`, `rating_desc`.

### Download endpoint

```
GET https://freesound.org/apiv2/sounds/{sound_id}/download/
Authorization: Bearer ACCESS_TOKEN
```

**OAuth2 is required** for original-quality downloads. API-key-only auth cannot download originals. Lower-quality previews (128kbps MP3, 192kbps OGG) are available without OAuth via the `previews` field URLs.

### Rate limits

| Resource                    | Per minute | Per day      |
| --------------------------- | ---------- | ------------ |
| Standard (search, metadata) | **60**     | **2,000**    |
| Write (upload, comment)     | **30**     | **500**      |
| Downloads                   | —          | **~500/day** |

Throttled responses return **HTTP 429**. **No rate-limit headers are sent** (no `X-RateLimit-Remaining`). The freesound-python library uses client-side rate limiting (`LimiterSession(per_minute=59)`), confirming server headers are absent.

### Desktop app OAuth2 strategy

Freesound supports **two approaches** for desktop apps:

1. **Localhost redirect** — Register `http://localhost:{port}/callback` as your redirect URI. Spin up a temporary HTTP server, open the browser, capture the code, and shut down the server. Use `http://`, not `https://`, and include the port.

2. **Freesound code display page** (simpler) — Set Freesound itself as the redirect target when registering API credentials. The user sees a page displaying the authorization code, copies it, and pastes it into your app. This is explicitly designed for desktop apps.

After initial auth, **persist the refresh token**. On subsequent launches, silently refresh without user interaction. Freesound auto-grants permissions for returning users if a previous token (even expired) exists.

---

## 2. Real download URLs for free sample packs

### VCSL (sgossner/VCSL)

- **Latest release**: `v1.2.2-RC` (tag: `v1.2.2-RC`, titled "SFZ Build v1.2.2")
- **GitHub source ZIP**: `https://github.com/sgossner/VCSL/archive/refs/tags/v1.2.2-RC.zip`
- **Dropbox mirror**: `https://www.dropbox.com/s/t9i75ur4i0x0n1j/VCSL-1.2.2-RC.zip?dl=0`
- **Distribution**: Single ZIP containing the SFZ build (from the `sfz` branch). The `master` branch has raw WAV samples.
- **Size**: Multi-GB (dozens of orchestral, world, and experimental instruments at 20–75 MB each)
- **License**: CC0

### Splendid Grand Piano (sfzinstruments/SplendidGrandPiano)

- **No releases published** — download the repo directly
- **ZIP URL**: `https://github.com/sfzinstruments/SplendidGrandPiano/archive/refs/heads/master.zip`
- **Size**: ~256 MB (Steinway samples in FLAC + SFZ mappings with ARIA extensions)
- **Structure**: `Data/`, `Samples/`, `Splendid Grand Piano.sfz`
- **Requires**: Plogue sforzando or ARIA-based SFZ sampler for full feature support
- **License**: Public domain

### LMMS Assets (LMMS/assets)

- **No releases published** — repo clone only
- **Default branch**: `master`
- **ZIP URL**: `https://github.com/LMMS/assets/archive/refs/heads/master.zip`
- **Contents**: `Samples/` (FLAC, 44100 Hz, mono, peak-normalized to −3 dBFS), `Presets/`
- **License**: CC0-1.0

### University of Iowa Musical Instrument Samples

- **Base URL**: `https://theremin.music.uiowa.edu/` (confirmed working)
- **Main page**: `https://theremin.music.uiowa.edu/MIS.html`
- **Distribution**: **Individual AIFF files** per note/articulation — no bulk ZIP
- **URL pattern (pre-2012)**: `https://theremin.music.uiowa.edu/MIS{instrument}.html` (e.g., `MISpiano.html`, `MISflute.html`, `MISviolin.html`)
- **URL pattern (post-2012)**: `https://theremin.music.uiowa.edu/MIS-Pitches-2012/MIS{Instrument}2012.html`
- **Specs**: Pre-2012 is 16-bit/44.1kHz AIFF mono; post-2012 also available as 24-bit/96kHz stereo ZIPs
- **Bulk download**: Use wget: `wget -r -l1 --no-parent -A.aiff https://theremin.music.uiowa.edu/MISpiano.html`
- **License**: Free to use without restriction (since 1997)

### OLPC Berklee Sample Pool

- **Archive.org identifier**: `olpc-sound-samples-v2.7z`
- **Item page**: `https://archive.org/details/olpc-sound-samples-v2.7z`
- **Direct download**: `https://archive.org/download/olpc-sound-samples-v2.7z/olpc-sound-samples-v2.7z`
- **Size**: **4.3 GB** compressed (7z), ~8 GB uncompressed, **8,000+ samples**
- **Specs**: 16-bit WAV, mono, normalized to −3 dB, provided at 44.1k, 22.5k, and 16k sample rates
- **License**: CC-BY 3.0
- **Individual volumes** also on Archive.org: `Berklee44v1` (75.3 MB), `Berklee44v6` (44.4 MB), `Berklee44v13` (86.2 MB), etc.
- **OLPC wiki still accessible**: `https://wiki.laptop.org/go/Free_sound_samples`

---

## 3. Verified CC0 drum one-shots on Freesound

All IDs below are verified to exist on Freesound with **Creative Commons 0** licensing. The xIceCoffeex "Savannah" pack (pack 9368) is a particularly good CC0 acoustic kit covering all standard drum types. The deadrobotmusic user has **1,400+ CC0 sounds** including extensive electronic drums.

| #   | ID         | Name                      | User             | Type      | Duration | API URL                                      |
| --- | ---------- | ------------------------- | ---------------- | --------- | -------- | -------------------------------------------- |
| 1   | **371192** | acoustic kick.wav         | karolist         | Kick      | ~0.30s   | `https://freesound.org/apiv2/sounds/371192/` |
| 2   | **264285** | Deep House Kick Drum 1    | Mattc90          | Kick      | ~1.50s   | `https://freesound.org/apiv2/sounds/264285/` |
| 3   | **647618** | Lo fi kick drum 00.wav    | johnnypanic      | Kick      | ~0.29s   | `https://freesound.org/apiv2/sounds/647618/` |
| 4   | **648890** | Kick 001.wav              | AudioPapkin      | Kick      | ~1.46s   | `https://freesound.org/apiv2/sounds/648890/` |
| 5   | **171484** | Savannah Kick.wav         | xIceCoffeex      | Kick      | short    | `https://freesound.org/apiv2/sounds/171484/` |
| 6   | **577123** | DR Snare 123              | deadrobotmusic   | Snare     | ~0.26s   | `https://freesound.org/apiv2/sounds/577123/` |
| 7   | **651991** | Serum Snare 11            | deadrobotmusic   | Snare     | ~0.36s   | `https://freesound.org/apiv2/sounds/651991/` |
| 8   | **737294** | Lil Lofi Snare 3          | deadrobotmusic   | Snare     | short    | `https://freesound.org/apiv2/sounds/737294/` |
| 9   | **171491** | Savannah Snare.wav        | xIceCoffeex      | Snare     | short    | `https://freesound.org/apiv2/sounds/171491/` |
| 10  | **566899** | Acoustic Hi-Hat Shank     | lennartgreen     | Hi-hat    | short    | `https://freesound.org/apiv2/sounds/566899/` |
| 11  | **171488** | Savannah Open HH.wav      | xIceCoffeex      | Open HH   | short    | `https://freesound.org/apiv2/sounds/171488/` |
| 12  | **271208** | Baddum Tish - Rimshot     | rodincoil        | Rim       | short    | `https://freesound.org/apiv2/sounds/271208/` |
| 13  | **171485** | Savannah Floor Tom.wav    | xIceCoffeex      | Floor Tom | short    | `https://freesound.org/apiv2/sounds/171485/` |
| 14  | **171487** | Savannah Rack Tom 1.wav   | xIceCoffeex      | Rack Tom  | short    | `https://freesound.org/apiv2/sounds/171487/` |
| 15  | **171490** | Savannah Rack Tom 2.wav   | xIceCoffeex      | Rack Tom  | short    | `https://freesound.org/apiv2/sounds/171490/` |
| 16  | **171486** | Savannah Crash Right.wav  | xIceCoffeex      | Crash     | short    | `https://freesound.org/apiv2/sounds/171486/` |
| 17  | **171483** | Savannah Middle Crash.wav | xIceCoffeex      | Crash     | short    | `https://freesound.org/apiv2/sounds/171483/` |
| 18  | **171489** | Savannah Ride.wav         | xIceCoffeex      | Ride      | short    | `https://freesound.org/apiv2/sounds/171489/` |
| 19  | **171482** | Savannah Bell.wav         | xIceCoffeex      | Ride Bell | short    | `https://freesound.org/apiv2/sounds/171482/` |
| 20  | **695695** | drumhit_Hat9              | DigitalUnderglow | Hi-hat    | short    | `https://freesound.org/apiv2/sounds/695695/` |

For further CC0 drum exploration, **deadrobotmusic** offers entire packs: Snares (pack 32405, 30 sounds), Hi Hats (pack 33078, 226 sounds), Kicks (71 sounds), Cymbals (24 sounds), Percussion (29 sounds) — all CC0.

---

## 4. Nucleo crate: fuzzy search done right

### Current versions

- **nucleo**: `0.5.0` (high-level parallel matcher)
- **nucleo-matcher**: `0.3.1` (low-level matcher — this is what you want for a simple use case)

### The simplest possible usage

```toml
# Cargo.toml
[dependencies]
nucleo-matcher = "0.3.1"
```

```rust
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher};

fn main() {
    let items = ["src/main.rs", "Cargo.toml", "README.md", "src/lib.rs"];
    let mut matcher = Matcher::new(Config::DEFAULT);

    let matches = Pattern::parse("src rs", CaseMatching::Ignore, Normalization::Smart)
        .match_list(items, &mut matcher);

    for (item, score) in &matches {
        println!("{item} (score: {score})");
    }
}
```

The `match_list` method returns `Vec<(&str, u32)>` already sorted by score descending. This is the easiest entry point and handles all the UTF-32 conversion internally.

### Full example: indices sorted by score

```rust
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher};

/// Fuzzy match `needle` against each string in `haystack`.
/// Returns original indices sorted by match score (best first).
fn fuzzy_match_sorted(haystack: &[String], needle: &str) -> Vec<usize> {
    let mut matcher = Matcher::new(Config::DEFAULT);
    let pattern = Pattern::parse(needle, CaseMatching::Ignore, Normalization::Smart);

    let mut scored: Vec<(usize, u32)> = haystack
        .iter()
        .enumerate()
        .filter_map(|(idx, item)| {
            pattern
                .score(item.chars(), &mut matcher)
                .map(|score| (idx, score))
        })
        .collect();

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.into_iter().map(|(idx, _)| idx).collect()
}
```

### Key API details and gotchas

**`Pattern::parse`** splits on spaces and supports fzf syntax: `^foo` (prefix), `foo$` (postfix), `'foo` (substring), `!foo` (negation). **`Pattern::new`** treats everything literally (no special syntax). **`Atom::new`** is a single matching unit including spaces.

**Critical gotchas**:

- `Matcher::new()` allocates **~135 KB** of heap scratch memory. Create once, reuse — never create inside a loop.
- Matcher methods (`fuzzy_match`, etc.) require `Utf32Str` arguments, not `&str`. **Always use the Pattern/Atom API** which handles conversion internally.
- The `_indices` methods **append** to the indices vector — they don't clear it first.
- `Config::DEFAULT.match_paths()` treats `/` as a word boundary — use this for file path matching.
- Multi-word queries: `Pattern::parse` splits on spaces automatically. If you want the space to be part of the match, use `Atom::new`.

### When nucleo-matcher is overkill

For lists under 10k items where you want minimal API surface, **fuzzy-matcher** (the skim library) is simplest:

```rust
// fuzzy-matcher = "0.3.7"
use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;

let matcher = SkimMatcherV2::default();
let score = matcher.fuzzy_match("axbycz", "abc"); // Option<i64>
```

But for **50k–100k items, nucleo-matcher is the clear winner** — benchmarked at ~6× faster than skim's matcher, with aggressive prefiltering and ASCII fast paths. For interactive UIs with live-updating results, the high-level `nucleo` crate (0.5.0) adds parallel matching via rayon and streaming injection via a lock-free `Injector`.

---

## 5. Tauri v2 filesystem capabilities for a sample library

### The capability JSON for a sample library app

```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "sample-library",
    "description": "Sample library browser capabilities",
    "windows": ["main"],
    "permissions": [
        "core:default",
        "dialog:default",
        "store:default",
        "fs:default",
        "fs:allow-read-file",
        "fs:allow-read-text-file",
        "fs:allow-write-file",
        "fs:allow-write-text-file",
        "fs:allow-exists",
        "fs:allow-mkdir",
        "fs:allow-read-dir",
        "fs:allow-remove",
        "fs:allow-rename",
        "fs:allow-copy-file",
        "fs:allow-stat",
        {
            "identifier": "fs:allow-read-file",
            "allow": [
                { "path": "$AUDIO" },
                { "path": "$AUDIO/**/*" },
                { "path": "$HOME/Music" },
                { "path": "$HOME/Music/**/*" }
            ]
        },
        {
            "identifier": "fs:allow-read-dir",
            "allow": [
                { "path": "$AUDIO" },
                { "path": "$AUDIO/**/*" },
                { "path": "$HOME/Music" },
                { "path": "$HOME/Music/**/*" }
            ]
        },
        {
            "identifier": "fs:allow-write-file",
            "allow": [
                { "path": "$AUDIO" },
                { "path": "$AUDIO/**/*" },
                { "path": "$HOME/Music" },
                { "path": "$HOME/Music/**/*" }
            ]
        },
        {
            "identifier": "fs:allow-mkdir",
            "allow": [{ "path": "$HOME/Music" }, { "path": "$HOME/Music/**/*" }]
        }
    ]
}
```

Scope path variables available: `$APPCONFIG`, `$APPDATA`, `$APPLOCALDATA`, `$APPCACHE`, `$APPLOG`, `$AUDIO`, `$HOME`, `$DESKTOP`, `$DOCUMENT`, `$DOWNLOAD`, `$TEMP`, `$RESOURCE`, and more. Pre-built shorthand permissions exist: `fs:allow-home-read-recursive`, `fs:allow-audio-read-recursive`, `fs:allow-audio-write-recursive`, etc.

### Runtime scope modification for user-chosen directories

The scope system **can be modified at runtime** via Rust, which is critical for a user-configurable sample library folder:

```rust
use tauri_plugin_fs::FsExt;

#[tauri::command]
fn set_sample_library_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.fs_scope();
    scope.allow_directory(&path, true); // true = recursive
    Ok(())
}
```

The **dialog plugin** automatically extends fs scope when a user selects a folder via the picker. Combined with **tauri-plugin-persisted-scope**, dialog-granted scopes survive app restarts.

### Rust backend: just use std::fs

The official Tauri docs explicitly state: **"If you want to manipulate files/directories through Rust, use traditional Rust's libs (std::fs, tokio::fs, etc)."** The fs plugin's scope system only restricts **frontend JavaScript APIs**. Rust backend code is unrestricted:

```rust
#[tauri::command]
fn read_sample_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| e.to_string())
}
```

### macOS sandbox and ~/Music access

**Tauri v2 does NOT enable macOS App Sandbox by default.** Without the sandbox, `std::fs` access to `~/Music` works normally with no special configuration. The sandbox is only required for Mac App Store distribution. If you enable it, you need `com.apple.security.files.user-selected.read-write` entitlement plus file dialog selection, or the music-specific `com.apple.security.assets.music.read-write` entitlement.

### tauri-plugin-store v2

The store plugin **manages its own storage independently** — it does **not** require any `fs:` permissions. Configuration:

```json
{ "permissions": ["store:default"] }
```

```toml
# Cargo.toml
tauri-plugin-store = "2"
```

```rust
// lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())

// Usage:
use tauri_plugin_store::StoreExt;
let store = app.store("settings.json")?;
store.set("sample_library_path", serde_json::json!("/Users/me/Music/Samples"));
let path = store.get("sample_library_path");
```

Data is stored in the app data directory: `~/Library/Application Support/{bundleIdentifier}/` on macOS.

---

## 6. Notify crate: filesystem watching with debounce

### Important version correction

The question asks about notify **7.x**, but **notify 7.0.0 (October 2024) is outdated**. Current stable as of early 2026:

| Crate                     | Version    | Date       |
| ------------------------- | ---------- | ---------- |
| **notify**                | **8.2.0**  | 2025-08-03 |
| **notify-debouncer-full** | **0.7.0**  | 2026-01-23 |
| **notify-debouncer-mini** | **0.7.0**  | recent     |
| notify (pre-release)      | 9.0.0-rc.2 | 2026-02-14 |

Use **notify-debouncer-full** for production. It handles rename event stitching (matching From/To pairs), deduplication of Create events, file system ID tracking on macOS/Windows, and suppression of redundant Modify events after Create.

### Complete Tauri integration with debounced JSON file watching

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = [] }
notify-debouncer-full = "0.7.0"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
log = "0.4"
```

```rust
use notify_debouncer_full::{
    new_debouncer,
    notify::{EventKind, RecursiveMode},
    DebounceEventResult,
};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
struct FileChangePayload {
    paths: Vec<String>,
    kind: String,
}

fn start_file_watcher(app_handle: AppHandle, watch_dir: PathBuf) {
    std::thread::spawn(move || {
        let handle = app_handle.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(500), // debounce timeout
            None,                        // tick_rate (None = default)
            move |result: DebounceEventResult| {
                match result {
                    Ok(debounced_events) => {
                        let json_paths: Vec<String> = debounced_events
                            .iter()
                            .flat_map(|event| {
                                event.event.paths.iter().filter_map(|path| {
                                    if path.extension().map_or(false, |ext| ext == "json") {
                                        Some(path.to_string_lossy().to_string())
                                    } else {
                                        None
                                    }
                                })
                            })
                            .collect();

                        if json_paths.is_empty() {
                            return;
                        }

                        let kind = debounced_events
                            .first()
                            .map(|e| match e.event.kind {
                                EventKind::Create(_) => "created",
                                EventKind::Modify(_) => "modified",
                                EventKind::Remove(_) => "removed",
                                _ => "changed",
                            })
                            .unwrap_or("changed")
                            .to_string();

                        let _ = handle.emit("file-changed", &FileChangePayload {
                            paths: json_paths,
                            kind,
                        });
                    }
                    Err(errors) => {
                        for error in errors {
                            log::error!("File watch error: {:?}", error);
                        }
                    }
                }
            },
        )
        .expect("Failed to create file watcher");

        debouncer
            .watch(&watch_dir, RecursiveMode::Recursive)
            .expect("Failed to watch directory");

        // CRITICAL: The debouncer must not be dropped. Park this thread forever.
        loop {
            std::thread::park();
        }
    });
}

#[tauri::command]
fn watch_directory(app_handle: AppHandle, path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&path);
    if !watch_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    start_file_watcher(app_handle, watch_path);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let watch_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&watch_dir).ok();
            start_file_watcher(app_handle, watch_dir);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![watch_directory])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Frontend listener:

```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<{ paths: string[]; kind: string }>('file-changed', (event) => {
    console.log(`Files ${event.payload.kind}:`, event.payload.paths);
});
```

### Platform-specific known issues

**macOS FSEvents**: Events arrive batched with potential delays. Files not owned by the current user may not trigger events (FSEvents security model). Docker on macOS Apple Silicon throws `Function not implemented (os error 38)` — use `PollWatcher` as fallback. Empty paths could crash pre-9.0 versions.

**Windows ReadDirectoryChangesW**: Renames arrive as separate From/To events. `notify-debouncer-full` with `RecommendedCache` automatically stitches these using file system IDs.

**Linux inotify**: Default watch limit is low (8,192–65,536). Each directory counts. Increase with `sysctl fs.inotify.max_user_watches=524288`. Pseudo filesystems (`/proc`, `/sys`) don't emit events. Network/NFS mounts may not emit events at all — use `PollWatcher`.

**All platforms**: The watcher **must be kept alive** (not dropped). Dropping the debouncer stops all watching. Different editors save files differently (truncate vs. create-and-replace), producing unexpected event sequences.

---

## 7. Rodio on macOS: the thread issue is less severe than assumed

### The real situation

After thorough investigation of rodio and CPAL GitHub issue trackers, **a strict "must call on main thread" requirement for `OutputStream` on macOS is not well-documented or clearly evidenced.** CoreAudio's Hardware Abstraction Layer is generally thread-safe for basic audio output stream creation. The functions CPAL uses (`AudioObjectGetPropertyData`, `AudioComponentFindNext`, `AudioComponentInstanceNew`, `AudioUnitInitialize`) do not have documented main-thread requirements.

The premise of the question likely originates from one of these sources:

- **iOS behavior** being conflated with macOS (AVAudioSession on iOS does have stricter thread requirements)
- General best practices for macOS audio development being reported as hard requirements
- The extremely common bug of **dropping the `OutputStream` prematurely**, which silently kills all audio output and is easily misdiagnosed as a thread issue

### Current versions

- **rodio**: `0.21.1` (uses `cpal ^0.16`)
- **cpal**: `0.16.x`
- rodio 0.21 introduced `OutputStreamBuilder` replacing the old `OutputStream::try_default()` pattern

### Apple Silicon vs Intel

**No specific Apple Silicon vs Intel thread-safety differences** were found. CPAL's CoreAudio backend code is architecture-agnostic. The only Apple Silicon–specific consideration is that CoreAudio workgroup threads may run on efficiency cores when buffer sizes ≥512 at 48kHz — a performance concern, not a correctness one.

### Correct Tauri integration pattern

```toml
# Cargo.toml
[dependencies]
rodio = { version = "0.21", features = ["symphonia-all"] }
tauri = { version = "2", features = [] }
```

```rust
use std::sync::Mutex;
use tauri::State;
use rodio::{OutputStream, OutputStreamBuilder, Sink, Decoder};

struct AudioManager {
    stream: OutputStream,
    active_sinks: Mutex<Vec<Sink>>,
}

impl AudioManager {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let stream = OutputStreamBuilder::open_default_stream()?;
        Ok(Self {
            stream,
            active_sinks: Mutex::new(Vec::new()),
        })
    }

    fn play_file(&self, path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let sink = Sink::connect_new(&self.stream.mixer());
        let file = std::fs::File::open(path)?;
        let source = Decoder::try_from(file)?;
        sink.append(source);
        self.active_sinks.lock().unwrap().push(sink);
        Ok(())
    }

    fn cleanup_finished(&self) {
        self.active_sinks.lock().unwrap().retain(|sink| !sink.empty());
    }
}

#[tauri::command]
fn play_sound(audio: State<AudioManager>, path: String) -> Result<(), String> {
    audio.cleanup_finished();
    audio.play_file(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let audio = AudioManager::new()
                .expect("Failed to initialize audio");
            app.manage(audio);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![play_sound])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
```

**Three critical rules**: Initialize `OutputStream` in the `setup` hook (runs on the main thread before the event loop) and store it in Tauri managed state. **Never drop the OutputStream** — if it's dropped, all audio stops silently. Use `Sink::connect_new(&stream.mixer())` (the new 0.21 API), not the old `Sink::try_new(&handle)` pattern. Tauri commands run on a thread pool, which is fine — you only need the `mixer()` reference to add sources.

For iOS builds, you must manually add `AudioToolbox.framework` and `CoreAudio.framework` in the Xcode project's "Link Binary With Libraries" build phase.

---

## Conclusion

The seven research areas reveal several counterintuitive findings worth highlighting. **Freesound's OAuth2 has a desktop-friendly escape hatch** — setting Freesound itself as the redirect target to display the auth code — that eliminates the need for a localhost HTTP server. **Notify is at v8.2, not v7**, and `notify-debouncer-full` 0.7.0 handles the gnarliest cross-platform edge cases (rename stitching, file ID tracking) automatically. **The rodio macOS thread issue is largely a myth** for basic output — the real danger is accidentally dropping the `OutputStream`, which silently kills all audio. For fuzzy search, `nucleo-matcher`'s `Pattern::parse(...).match_list(items, &mut matcher)` is a one-liner that benchmarks at 6× faster than alternatives at the 50k–100k item scale. And for Tauri v2 filesystem access, the scope system only restricts the JavaScript frontend — **Rust backend code can use `std::fs` freely**, with runtime scope expansion via `app.fs_scope().allow_directory()` for the frontend when needed.

# Sample library browser — implementation spec

## What we're building

A Logic Pro–style sample browser panel inside the DAW. Users browse, preview, and drag samples onto the timeline. Packs download on demand. No database — everything lives on the filesystem and in memory.

---

## Storage model

Follow Logic Pro's convention exactly:

| Platform | Default path                               |
| -------- | ------------------------------------------ |
| macOS    | `~/Music/[AppName]/Samples/`               |
| Windows  | `C:\Users\[user]\Music\[AppName]\Samples\` |
| Linux    | `~/[AppName]/Samples/`                     |

Use the `dirs` crate to resolve these. The path is user-configurable — persist the override in `tauri-plugin-store` under the key `"library_root"`.

Each downloaded pack gets its own subdirectory, e.g. `Samples/vcsl/`. User data (favorites, ratings, play counts) lives in a single `user_data.json` file managed by `tauri-plugin-store` — no SQLite anywhere.

---

## The index.json contract

Every pack directory contains one `index.json`. This file is written once by the downloader and read on startup by the engine. It is the only source of truth for sample metadata.

```json
{
    "pack": {
        "id": "vcsl",
        "name": "Versilian Community Sample Library",
        "description": "Free CC0 orchestral samples",
        "version": "1.2.2",
        "source": "vcsl",
        "license": "cc0",
        "author": "Sam Gossner",
        "homepage_url": "https://versilian-studios.com/vcsl/",
        "thumbnail_filename": "thumb.png",
        "total_file_count": 4218,
        "total_size_bytes": 4831838208,
        "created_at": "2026-03-15T00:00:00Z",
        "schema_version": 1
    },
    "samples": [
        {
            "id": "<blake3 hex — see ID section>",
            "relative_path": "Chordophones/Solo Violin/arco/Violin_C4.wav",
            "filename": "Violin_C4.wav",
            "format": "wav",
            "size_bytes": 245760,
            "duration_secs": 2.8,
            "sample_rate": 44100,
            "bit_depth": 24,
            "channels": 2,
            "sample_type": "one_shot",
            "category": "Strings",
            "subcategory": "Solo Violin",
            "tags": ["violin", "arco", "orchestral"],
            "description": "Solo violin sustain, C4",
            "bpm": null,
            "key": null,
            "attribution": null
        }
    ]
}
```

All optional fields (`bpm`, `key`, `subcategory`, `description`, `attribution`) use `null` when absent — do not omit the key. The `attribution` object, when present, contains `{ "author", "author_url", "license_type", "license_url", "source_id" }`.

---

## Sample ID generation

Every sample gets a stable, deterministic ID that survives reinstalls:

```rust
// Input: "{source}:{pack_id}:{relative_path}" with forward slashes
// Output: 64-char lowercase hex string
pub fn generate_sample_id(source: &str, pack_id: &str, relative_path: &str) -> String {
    let input = format!("{}:{}:{}", source, pack_id, relative_path);
    blake3::hash(input.as_bytes()).to_hex().to_string()
}
```

This ID is used as the key in `user_data.json` to associate favorites/ratings with samples even if the file moves within the pack.

---

## Rust data model

Define these types in `src-tauri/src/library/model.rs`. They map 1:1 to the JSON schema above.

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackIndex {
    pub pack: PackMeta,
    pub samples: Vec<SampleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackMeta {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub source: String,
    pub license: String,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub thumbnail_filename: Option<String>,
    pub total_file_count: u32,
    pub total_size_bytes: u64,
    pub created_at: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleEntry {
    pub id: String,
    pub relative_path: String,
    pub filename: String,
    pub format: String,          // "wav" | "aiff" | "flac" | "mp3"
    pub size_bytes: u64,
    pub duration_secs: f32,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub bpm: Option<f32>,
    pub key: Option<String>,
    pub sample_type: String,     // "one_shot" | "loop" | "unknown"
    pub category: String,
    pub subcategory: Option<String>,
    pub tags: Vec<String>,
    pub description: Option<String>,
    pub attribution: Option<Attribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attribution {
    pub author: String,
    pub author_url: Option<String>,
    pub license_type: String,
    pub license_url: String,
    pub source_id: Option<String>,
}
```

The runtime `Sample` struct (in `engine.rs`) flattens pack metadata into each sample and adds `absolute_path: PathBuf`. Keep the JSON model and runtime model separate.

---

## In-memory engine

All logic lives in `src-tauri/src/library/engine.rs`. On startup:

1. Walk the library root with `walkdir`, `max_depth(3)`, find every `index.json`
2. `std::fs::read_to_string` + `serde_json::from_str` each file
3. Flatten into `Vec<Arc<Sample>>` — derive `absolute_path` by joining the pack dir with `relative_path` (normalize `/` to OS separator)
4. Build a parallel `Vec<String>` of search texts (one per sample): `"{filename_stem} {pack_name} {category} {subcategory} {tags joined} {description}"`
5. Store in `parking_lot::Mutex<SampleLibrary>` as Tauri managed state

**Do not use async for the load** — it runs once at startup before the event loop and completes in ~200ms for 50k samples.

### Search

Use `nucleo-matcher = "0.3"` for fuzzy matching. Keep one `Matcher` instance alive inside `SampleLibrary` (it holds ~135KB of scratch memory — never create it inside a loop).

```rust
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

// Inside SampleLibrary::search():
let pattern = Pattern::parse(query_text, CaseMatching::Smart, Normalization::Smart);

let mut results: Vec<(usize, u32)> = self.samples
    .iter()
    .enumerate()
    .filter(|(_, s)| passes_structured_filters(s, &query))
    .filter_map(|(idx, _)| {
        let text = &self.search_texts[idx];
        let haystack = if text.is_ascii() {
            Utf32Str::Ascii(text.as_bytes())
        } else {
            // reuse a Vec<char> buf, clear before each use
            Utf32Str::Unicode(&char_buf)
        };
        pattern.score(haystack, &mut self.matcher).map(|score| (idx, score))
    })
    .collect();

results.sort_unstable_by(|a, b| b.1.cmp(&a.1));
```

Structured filters (applied before fuzzy scoring, cheap iterator chain):

- `bpm_range: Option<(f32, f32)>` — skip samples with no BPM if filter is active
- `key: Option<String>` — case-insensitive exact match
- `sample_type: Option<String>` — "one_shot" | "loop"
- `categories: Vec<String>` — OR logic
- `pack_ids: Vec<String>` — OR logic
- `duration_range: Option<(f32, f32)>`
- `channels: Option<u16>` — 1 = mono, 2 = stereo

### Category tree

Derive from the data — don't hardcode. Walk the samples vec and group by `category → subcategory` to build a `BTreeMap<String, BTreeSet<String>>`. Return this as a serializable struct for the frontend sidebar.

---

## Tauri commands to expose

```rust
search_samples(query: SearchQuery) -> Vec<SearchResult>
get_sample(id: String) -> Option<Sample>
list_packs() -> Vec<PackSummary>
list_categories() -> Vec<CategoryNode>
get_library_stats() -> LibraryStats   // { total_samples, total_packs, library_root }
get_library_root() -> String
set_library_root(path: String)        // writes to store, reloads index
reload_library()                      // re-runs the walk + load
play_preview(path: String)
stop_preview()
set_preview_volume(volume: f32)
get_waveform_peaks(path: String, num_points: usize) -> Vec<f32>
```

---

## Audio preview

Use `rodio = "0.21"` with the `symphonia-all` feature (handles WAV, FLAC, MP3, AIFF). Initialize `OutputStream` in the Tauri `setup` hook and store it in managed state — **never drop it**, dropping it silently kills all audio.

```rust
// In setup:
let stream = OutputStreamBuilder::open_default_stream()?;
app.manage(AudioState { stream, current_sink: Mutex::new(None) });

// In play_preview command:
let sink = Sink::connect_new(&state.stream.mixer());
let file = std::fs::File::open(&path)?;
let source = Decoder::try_from(file)?;
sink.append(source);
*state.current_sink.lock() = Some(sink); // drops previous, stopping it
```

For `get_waveform_peaks`: decode the file with symphonia, collect all samples as f32, chunk into `num_points` windows, take the max absolute value of each window, normalize to 0.0–1.0. Return the resulting `Vec<f32>`. Cache results keyed by file path in a `HashMap<String, Vec<f32>>` inside `AudioState` to avoid re-decoding on repeated opens.

---

## User data (no DB)

Use `tauri-plugin-store` with a single file `user_data.json`. Schema:

```json
{
    "favorites": ["<sample_id>", "<sample_id>"],
    "ratings": { "<sample_id>": 4 },
    "play_counts": { "<sample_id>": 12 },
    "last_played": { "<sample_id>": "2026-03-20T14:30:00Z" },
    "custom_tags": { "<sample_id>": ["my-tag", "another"] }
}
```

Read the whole store on command invocation, mutate, write back. At typical usage (hundreds of favorites, thousands of plays) this file stays under 100KB. No migrations, no schema, no locking issues.

---

## Filesystem watching (hot reload)

Use `notify-debouncer-full = "0.7"` to watch the library root. When any `index.json` changes (created, modified, removed), call `reload_library()` and emit a `"library-reloaded"` Tauri event to the frontend.

```rust
let mut debouncer = new_debouncer(Duration::from_millis(500), None, move |result| {
    if let Ok(events) = result {
        let has_index_change = events.iter().any(|e| {
            e.event.paths.iter().any(|p| p.file_name() == Some("index.json".as_ref()))
        });
        if has_index_change {
            // reload + emit "library-reloaded"
        }
    }
})?;
debouncer.watch(&library_root, RecursiveMode::Recursive)?;
// Keep debouncer alive — store it in managed state or park the thread
```

---

## Downloader (future work — stubs only for now)

The downloader is a separate concern. For now, expose one command stub:

```rust
download_pack(pack_id: String, source_id: String) -> Result<(), String>
```

When implemented, the downloader must:

1. Fetch the ZIP (GitHub release or manifest URL)
2. Extract to `Samples/{pack_id}/`
3. Walk extracted files, parse filename metadata (BPM from `120bpm`, key from `Cmaj`/`C_minor`, type from `loop`/`oneshot`/`kick`/`snare`)
4. Write `index.json` using the schema above
5. Emit `"pack-download-progress"` events during download
6. On completion, the filesystem watcher triggers a library reload automatically

---

## Cargo.toml additions

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
blake3 = "1"
nucleo-matcher = "0.3"
walkdir = "2"
parking_lot = "0.12"
dirs = "5"
anyhow = "1"
rodio = { version = "0.21", features = ["symphonia-all"] }
notify-debouncer-full = "0.7"
```

---

## Frontend (TypeScript / React)

Use TanStack Query for all data fetching. Three key hooks:

```ts
// All backed by invoke() calls to the Tauri commands above
useSearchSamples(query); // debounced, fires on every filter change
useListPacks();
useListCategories();
```

State to manage with Zustand (or plain useState):

- `filterState` — current query object (text, bpm_range, key, sample_type, etc.)
- `selectedSampleId` — drives the preview panel
- `previewVolume`

Virtualize the sample list with TanStack Virtual — render only visible rows. Target 60fps with 50k items in the list.

Waveform: draw on a `<canvas>` from the `Vec<f32>` peaks returned by `get_waveform_peaks`. Use `requestAnimationFrame` to avoid blocking the UI thread.

Drag to timeline: use the HTML5 `draggable` attribute on list rows. On `dragstart`, set `event.dataTransfer.setData("sample-id", id)`. The timeline canvas handles `dragover` + `drop` and calls back into Rust with the sample ID and timeline position.

---

## What to build in order

1. **Model + ID** — `model.rs`, `id.rs`, tests
2. **Engine load** — walk filesystem, parse indexes, build `Vec<Sample>`
3. **Search** — structured filters + nucleo fuzzy
4. **Tauri commands** — wire up managed state, expose all commands
5. **Preview player** — rodio initialization, play/stop/volume
6. **Waveform peaks** — symphonia decode, downsample, cache
7. **Filesystem watcher** — hot reload on index.json changes
8. **Frontend** — category tree, virtualized list, preview panel, filters
9. **Downloader** — pack catalog, download queue, ZIP extraction, index writing
