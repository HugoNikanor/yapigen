export { is_authenticated }

import type { SecurityRequirement } from '../openapi'

function is_authenticated(security_options: SecurityRequirement[]): boolean {
  return !(
    (security_options.length === 0)
    || (security_options.find(o => Object.keys(o).length === 0))
  )

}
