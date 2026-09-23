// ---------------------------------------------------------------------------
// Centralized scoring configuration - the ONE place score weights live.
// Operational thresholds an admin might want to tune live in
// public.prospect_settings instead (see supabase/sql/
// phase23_autonomous_prospecting.sql) - this file holds the underlying
// WEIGHTS that turn evidence into a number, which changing without code
// review would silently change what "relevant" means.
// ---------------------------------------------------------------------------

export const SCORING_CONFIG = {
  // Every company starts here (legitimacy baseline for having a real name/
  // record at all) before evidence adjusts it up or down.
  baseRelevanceScore: 15,
  maxScore: 100,
  minScore: 0,
  // Caps how much repeated industry-keyword matches alone can contribute -
  // ten mentions of the same term should never outweigh genuinely diverse
  // evidence (address, website, multiple distinct industries).
  maxIndustryContribution: 60,

  contactQuality: {
    validMobile: 35,
    validPhone: 20,
    validEmail: 15,
    hasWebsite: 15,
    hasLocation: 15,
  },

  // overall_score blends relevance (is this an industrial polymer
  // consumer?) with contact quality (can we actually reach them?) - a
  // perfectly relevant company with no usable contact should never
  // auto-promote.
  overallWeights: { relevance: 0.7, contactQuality: 0.3 },

  confidence: {
    // Minimum overall_score + distinct matched industries for each band.
    highMinScore: 80,
    highMinIndustryMatches: 2,
    mediumMinScore: 55,
  },
}
