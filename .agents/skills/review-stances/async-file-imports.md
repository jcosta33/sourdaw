# Lesson library: asynchronous file imports

Defects where a file request that reads, decodes or parses asynchronously publishes into an open project without the
authority that admitted it: an older request inside the same project, a replaced project, a missing local-work budget,
or a completed import that never reaches storage and autosave. A matching project alone does not authorize an older
request; distinguish the project's lifetime from the user's latest request within it. Each probe names the awaits to
hold, the observable to read (stored state and notices, never parser calls or promise completion) and the mutation
that must fail the case.

## Standing probes

1. **A file-preparation route skips the local-work budget (#1986, #2648, #4479).** Stem preparation refuses a
   missing work-budget callback before decode or staging, so a route that never passes the callback to
   `planPromptActions` (as `submitAdmittedPromptRequest` once did) admits unbudgeted work. Submit a two-file stem
   import through the real Prompt Bar planner with only picker, decode and storage ports replaced: an admitted
   budget produces one confirmable card and commits once; an exceeded storage limit keeps the exact refusal,
   reserves none of the stem categories and reaches neither decode nor staging. Keep cancelled and invalid
   selections at the same boundary. A mocked planner or prepared-scope result cannot prove the route carries the
   callback; dropping the callback from the route must fail the exceeded-budget case.
2. **Inverse completion inside one project (#5397, #5516).** Project-lifetime checks alone give two imports in the
   unchanged project equal authority, so A's delayed completion overwrites B's choice. Hold Scala import A at the
   picker, file read and parser independently, start import B in the same project, complete B first, then resolve
   or reject A: only B changes the tuning or reports success, and A's structured errors, rejected promises and
   console errors stay silent. Exercise browser selection and native selected-file reads through their real
   boundaries across the picker, read, parse, write and notice routes. Removing the request-identity conjunct must
   fail this case.
3. **A replaced project receives an outgoing import.** Repeat probe 2 with a prepared project replacement and with
   an activated replacement reusing the project ID: neither outgoing request writes or notifies in the successor.
   Pair those refusals with a current successful import, current failures and ordinary edits during the wait, which
   the accepted import must preserve. Removing the project-lifetime conjunct must fail the replacement case.
   Also run `importSclFile.spec.ts` case “keeps a pending import retired but admits a fresh import after a failed
   project preparation”: a settled failed prepare leaves the original project, permanently rejects the old import,
   and admits a newly requested import into that retained project. The public-load counterpart is
   `fermenterPatchAuditionUndo.integration.spec.tsx` case “admits fresh whole-patch edits after a public load fails
   before replacing the retained project”. Restoring the old load-ticket check must fail the fresh import; omitting
   capture-time admission or generation must fail the old import's non-effect. The Scala spec uses a mocked picker,
   parser and project store, so the public-load case owns real CRDT/history evidence. Also withdraw a successfully
   prepared public New replacement before activation: the maintained Fermenter integration case “admits a fresh
   preset after a public New project is withdrawn during successful preparation” requires the retained root to
   admit a fresh write and Undo/Redo while an old capture remains invalid. The real `replaceProjectData.spec.ts`
   case “settles a real prepared replacement withdrawn before activation” covers the Recent helper's terminal;
   owner tests keep held abandonment closed until I/O settles. Removing the caller's abandonment must fail these
   cases. The shared capture helper came from main PR #293 (`6c63c7a65d8869975ceebbfe79bbaee199d4f120`);
   its old-capture retirement remains required, and historical private reviewer stance is unknown.
4. **A completed import never reaches storage or autosave admission (#4883, #5397, #5761).** An import that writes
   project tuning without calling `markDirty` reaches the real store and CRDT while leaving `dirty: false`; the
   installed tracker watches tracks and tempo, so their positive controls do not prove import bookkeeping, and
   autosave admits only dirty projects. Run a successful import against the real normalized project store, CRDT
   adapter and installed dirty tracker; flush the actual write and require both the imported table and dirty
   state, proving the tracker active with its normal positive control; writing the tuning without `markDirty` must
   fail that dirty-state assertion. Cancellation, malformed input, supersession and project replacement leave a
   clean current project clean. Keep the loading guard and recheck request ownership before bookkeeping and after
   synchronous dirty subscribers, before publishing success. A mocked store or mocked tuning-write and notice
   assertions cannot prove autosave admission, and this evidence alone does not establish a live save/reopen loss.
5. **Every await after decode re-checks the accepted sample (Crumbs, #5041, #5780).** A guard on decode alone
   leaves telemetry and peaks as separate stale-publication windows. Hold each await independently against the
   real session store. Complete B before releasing A, and separately leave B decoding: require B's exact
   metadata/vector and pending flag. Replace the accepted sample without starting another load. Check
   project/device lifetime and the actual accepted leaf after each await and synchronous subscriber, while
   ordinary edits and the accepted sample's own persistence round trip remain valid. Removing either post-await
   check must redden its corresponding case; a decode-only inverse-completion test cannot.
6. **Analysis carries its accepted source through insertion.** A model result prepared before a source, tempo,
   arrangement or root replacement cannot acquire fresh authority merely by starting a later insertion. Capture
   the settled project revision before inference, carry that transient capture into the child batch, and hold
   both model evaluation and the real snapshot queue independently. Cancellation and same-ID, same-content root
   replacement refuse without output; ordinary save metadata remains admissible. Compare unchanged source PCM, raw
   CRDT, owner projections and history. Dropping the carried revision or capturing it at insertion must fail the
   stale-source case; a mocked revision predicate alone does not prove queued admission.
