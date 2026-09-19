// Shared with the single-product admin form AND bulk import, so both paths
// apply exactly the same defaults - never two independently invented rules
// for what a "new product" looks like.
export function buildFullProductPayload({
  code,
  name_fa,
  category,
  description_fa,
  active,
  polymer_base,
  applications,
  packaging,
  availability,
  image_path,
  mini_specs,
}) {
  return {
    code,
    name_fa,
    category: category || null,
    description_fa: description_fa || null,
    active: active !== false,
    polymer_base: polymer_base || null,
    applications: applications || [],
    packaging: packaging || null,
    availability: availability || 'available',
    image_path: image_path || null,
    mini_specs: mini_specs || [],
  }
}
