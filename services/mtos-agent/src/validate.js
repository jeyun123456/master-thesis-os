export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function text(value, field, { max = 2000, required = true, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed && !allowEmpty) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`);
  return trimmed;
}

export function date(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return value;
}

export function oneOf(value, field, allowed, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`);
  return value;
}

export function id(value, field = 'id') {
  if (typeof value !== 'string' || !ID.test(value)) throw new ValidationError(`${field} is invalid`);
  return value;
}

export function projectId(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError('project_id is required');
    return null;
  }
  if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new ValidationError('project_id is invalid');
  return value;
}

export function url(value, field = 'source_url') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) throw new ValidationError(`${field} is invalid`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new ValidationError(`${field} must be a URL`); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'obsidian:') {
    throw new ValidationError(`${field} must be an http(s) or obsidian URL`);
  }
  return value;
}

/**
 * Checks a value against the JSON-schema subset used for AI output
 * (object/array/string/integer/number/boolean/null, enum, required,
 * additionalProperties:false, min/max lengths and items). Returns a list of
 * problems; an empty list means the value conforms.
 */
export function schemaErrors(schema, value, path = '$') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const typeOk = types.some((type) => type === actual || (type === 'number' && actual === 'integer'));
  if (!typeOk) return [`${path}: expected ${types.join('|')}, got ${actual}`];
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
  if (actual === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: too long`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: too short`);
  }
  if ((actual === 'number' || actual === 'integer')) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (actual === 'array') {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.items) value.forEach((item, index) => errors.push(...schemaErrors(schema.items, item, `${path}[${index}]`)));
  }
  if (actual === 'object') {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) errors.push(...schemaErrors(properties[key], item, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}
