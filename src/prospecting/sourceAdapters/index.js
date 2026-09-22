import { uploadedDatasetAdapter } from './uploadedDataset.js'
import { genericHttpDirectoryAdapter } from './genericHttpDirectory.js'
import { osmOverpassAdapter } from './osmOverpass.js'
import { serperSearchAdapter } from './serperSearch.js'

// ---------------------------------------------------------------------------
// Adapter registry - the discovery pipeline only ever looks a source up by
// source_type here, never imports a specific adapter directly. Adding a new
// source type later (public_directory, industrial_directory, ...) means
// writing one module with this same { sourceType, discover, normalize,
// healthCheck } shape and adding one line here - never touching
// discoveryPipeline.js.
//
// Every unimplemented-but-declared source_type (see the CHECK constraint in
// supabase/sql/phase23_autonomous_prospecting.sql) falls back to
// genericHttpDirectoryAdapter's foundation, which honestly reports "not
// wired to a live provider yet" rather than silently doing nothing.
// ---------------------------------------------------------------------------

const ADAPTERS_BY_TYPE = {
  uploaded_dataset: uploadedDatasetAdapter,
  custom_api: genericHttpDirectoryAdapter,
  public_directory: osmOverpassAdapter,
  search_result: serperSearchAdapter,
}

export function getSourceAdapter(sourceType) {
  return ADAPTERS_BY_TYPE[sourceType] || genericHttpDirectoryAdapter
}
