/**
 * The subset of JSON Schema the operations use, and a validator for it.
 *
 * JSON Schema is the schema language because MCP describes tools in it, so an
 * operation's input schema is its tool definition verbatim. The validator
 * covers what the registry writes (type, enum, const, properties, required,
 * additionalProperties, items, length and range limits, pattern, a few
 * formats, anyOf) and fills in defaults, which keeps every handler free of
 * "is this field here" checks. Anything else in a schema is ignored, the way
 * JSON Schema treats unknown keywords.
 */

const FORMATS = {
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
  'date-time': (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)),
  // A wall-clock time read in the timezone that travels with it (or an instant, when it carries an offset).
  'local-date-time': (v) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(v),
  uri: (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol); } catch { return false; } },
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  timezone: (v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } },
};

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matches = (want, v) => {
  const got = typeOf(v);
  return want === got || (want === 'number' && got === 'integer');
};

/**
 * Validate `value` against `schema`. Returns { ok, errors, value }, where
 * `value` is a copy with defaults applied. Errors name the path: `role: required`.
 */
export function validate(schema, value, path = '') {
  const errors = [];
  const out = walk(schema, value, path || '(input)', errors);
  return { ok: errors.length === 0, errors, value: out };
}

function walk(schema, value, path, errors) {
  if (!schema || schema === true) return value;
  if (value === undefined && 'default' in schema) value = structuredClone(schema.default);
  if (schema.anyOf) {
    for (const alt of schema.anyOf) {
      const sub = [];
      const v = walk(alt, value, path, sub);
      if (!sub.length) return v;
    }
    errors.push(`${path}: doesn't match any allowed form`);
    return value;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matches(t, value))) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return value;
    }
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'string') {
    const n = [...value].length;
    if (schema.minLength != null && n < schema.minLength) errors.push(schema.minLength === 1 ? `${path}: is empty` : `${path}: shorter than ${schema.minLength} characters`);
    if (schema.maxLength != null && n > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: doesn't match ${schema.pattern}`);
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) errors.push(`${path}: isn't a valid ${schema.format}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: at most ${schema.maxItems} items`);
    if (schema.items) value = value.map((v, i) => walk(schema.items, v, `${path}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties || {};
    const out = {};
    for (const k of schema.required || []) {
      if (value[k] === undefined && !(props[k] && 'default' in props[k])) errors.push(`${path === '(input)' ? k : `${path}.${k}`}: required`);
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = path === '(input)' ? k : `${path}.${k}`;
      if (props[k]) out[k] = walk(props[k], v, sub, errors);
      else if (schema.additionalProperties === false) errors.push(`${sub}: not a known field`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') out[k] = walk(schema.additionalProperties, v, sub, errors);
      else out[k] = v;
    }
    for (const [k, p] of Object.entries(props)) {
      if (out[k] === undefined && 'default' in p) out[k] = structuredClone(p.default);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- builders

/**
 * Short builders, so an operation's schema reads like a signature. Each
 * returns plain JSON Schema; `d` is the description an agent reads.
 */
export const S = {
  str: (d, extra = {}) => ({ type: 'string', ...(d ? { description: d } : {}), ...extra }),
  text: (d, max = 20000, extra = {}) => ({ type: 'string', maxLength: max, ...(d ? { description: d } : {}), ...extra }),
  int: (d, extra = {}) => ({ type: 'integer', ...(d ? { description: d } : {}), ...extra }),
  num: (d, extra = {}) => ({ type: 'number', ...(d ? { description: d } : {}), ...extra }),
  bool: (d, extra = {}) => ({ type: 'boolean', ...(d ? { description: d } : {}), ...extra }),
  enum: (values, d, extra = {}) => ({ type: 'string', enum: values, ...(d ? { description: d } : {}), ...extra }),
  date: (d, extra = {}) => ({ type: 'string', format: 'date', ...(d ? { description: d } : {}), ...extra }),
  url: (d, extra = {}) => ({ type: 'string', format: 'uri', maxLength: 2000, ...(d ? { description: d } : {}), ...extra }),
  arr: (items, d, extra = {}) => ({ type: 'array', items, ...(d ? { description: d } : {}), ...extra }),
  nullable: (schema) => ({ ...schema, type: [...(Array.isArray(schema.type) ? schema.type : [schema.type]), 'null'] }),
  /** An object; `required` lists the keys that must be present. Unknown keys are refused. */
  obj: (properties = {}, required = [], extra = {}) => ({ type: 'object', properties, required, additionalProperties: false, ...extra }),
  /** An object whose shape isn't pinned (handler output with nested engine data). */
  any: (d) => ({ ...(d ? { description: d } : {}) }),
  tracker: (d = 'The tracker row number (the # column).') => ({ type: 'integer', minimum: 1, description: d }),
};
