// No use cases are exported across the module boundary: the param-bridge use
// cases (setGlutenParamWithAudio, loadGlutenPatchWithAudio) and the preset table
// (GLUTEN_PRESETS) are consumed only by this module's own GlutenPanel via
// relative imports, so nothing is re-exported through this contract barrel.
