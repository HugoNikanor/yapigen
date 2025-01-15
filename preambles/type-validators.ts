import { Validator as JSONSchemaValidator } from 'jsonschema'
import type { Schema as JSONSchemaDeclaration } from 'jsonschema'

/**
@throws InvalidData
 */
export function validate_type(
  body: unknown,
  schema: JSONSchemaDeclaration,
): true {
  const result = validator.validate(body, schema)
  if (!result.valid) {
    throw new InvalidData('body',
      result.errors.map((err) => {
        const path = err.path.map(s => `/${s}`).join('')
        return `Object at "#${path}" ${err.message}.\nGot ${JSON.stringify(err.instance)}.`
      }).join('\n\n'))
  }

  return true
}


const validator = new JSONSchemaValidator
