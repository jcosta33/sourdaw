import fs from 'fs';

let content = fs.readFileSync('.agents/tasks/refactor-faust-end-to-end-audit.md', 'utf8');

content = content.replace(
  'What this session must accomplish. One paragraph maximum. Be specific.',
  'Implement the structural changes outlined in the Faust end-to-end audit: extract DSP strings into `.dsp` files, fix TrackNode abstraction leak by routing Faust nodes through WAM host interfaces, and ensure Faust node WASM memory is properly destroyed during teardown.'
);

content = content.replace(
  'Describe the current structure being changed. What does it look like now?',
  'DSP code is embedded as TypeScript strings in `builtinDSP.ts` and `proSynthInstruments.ts`. `TrackNode.ts` breaks WAM abstractions to handle `faust-` specific parameter mapping and lifecycle, but fails to call `destroy()` on WASM nodes causing memory leaks.'
);

content = content.replace(
  'Describe the target structure. What will it look like when done?',
  'DSP code is stored in `*.dsp` files and imported via `?raw` (or loaded as strings). `TrackNode.ts` treats Faust devices as opaque WAM plugins, delegating teardown (`destroy()`) and parameter synchronization to the `FaustDeviceStrategy` and WAM host abstraction.'
);

content = content.replace('- [ ] Fill in before state', '- [x] Fill in before state');
content = content.replace('- [ ] Fill in after state', '- [x] Fill in after state');
content = content.replace('- [ ] Identify all affected files', '- [x] Identify all affected files');
content = content.replace('- [ ] Begin refactor', '- [x] Begin refactor');

fs.writeFileSync('.agents/tasks/refactor-faust-end-to-end-audit.md', content);
console.log('Task file updated.');
