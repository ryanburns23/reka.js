import { Schema, Type, TypeConstructor } from './schema';
import * as t from './types.docs';

/**
 * Match a callback to a Type
 */
export const match = (node: t.Any, visitor: Partial<t.Visitor>): void => {
  let currentType = node.type;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (visitor[currentType]) {
      return visitor[currentType](node);
    }

    const schema = Schema.get(currentType);

    if (schema.extends) {
      currentType = schema.extends;
      continue;
    }

    break;
  }
};

type TypeOpt<T extends t.Type = any> = Partial<{
  exclude: Array<keyof t.TypeProperties<T>>;
  diff: (a: T, b: T) => any;
}>;

type MergeTypeOpts = {
  function?: (a: Function, b: Function) => any;
  types?: Partial<{
    [K in keyof t.Visitor]: t.Visitor[K] extends (type: infer V) => any
      ? V extends t.Type
        ? TypeOpt<V>
        : never
      : never;
  }>;
};

const isObjectLiteral = (t: any) => {
  return !!t && 'object' === typeof t && t.constructor === Object;
};

/**
 * Compare 2 Types and merge differences
 */
export const merge = (a: any, b: any, opts?: MergeTypeOpts) => {
  const getOpt = (type: string): Required<TypeOpt> => {
    const schema = Schema.get(type);

    const cascadedOpt = schema.extends ? getOpt(schema.extends) : null;

    const exclude = opts?.types?.[type]?.exclude || [];
    const diff = opts?.types?.[type]?.diff;

    return {
      exclude: [...exclude, ...(cascadedOpt?.exclude ?? [])].filter(
        (value, index, self) => self.indexOf(value) === index
      ),
      diff: (a, b) => {
        let o;

        if (cascadedOpt?.diff) {
          o = cascadedOpt.diff(a, b);
        }

        if (o !== undefined) {
          return o;
        }

        if (diff) {
          o = diff(a, b);
        }

        if (o !== undefined) {
          return o;
        }
      },
    };
  };

  const mergeValue = (a: any, b: any) => {
    if (a === b) {
      return a;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length > b.length) {
        a.splice(b.length);
      }

      for (let i = 0; i < a.length; i++) {
        const mergedElement = mergeValue(a[i], b[i]);

        if (a[i] === mergedElement) {
          continue;
        }

        a[i] = mergedElement;
      }

      for (let i = a.length; i < b.length; i++) {
        a.push(b[i]);
      }

      return a;
    }

    if (a instanceof t.Type && b instanceof t.Type) {
      if (a.type !== b.type) {
        return b;
      }

      const options = getOpt(a.type);

      const diffed = options.diff(a, b);

      if (diffed !== undefined) {
        return diffed;
      }

      const fields = Schema.get(a.type).fields;

      for (const field of fields) {
        if (options.exclude.includes(field.name)) {
          continue;
        }

        const newValue = mergeValue(a[field.name], b[field.name]);
        if (a[field.name] !== newValue) {
          a[field.name] = newValue;
        }
      }

      return a;
    }

    if (isObjectLiteral(a) && isObjectLiteral(b)) {
      for (const key in b) {
        if (a[key]) {
          const t = mergeValue(a[key], b[key]);

          a[key] = t;
          continue;
        }

        a[key] = b[key];
      }

      for (const key in a) {
        if (b[key] !== undefined) {
          continue;
        }

        delete a[key];
      }

      return a;
    }

    if (typeof a === 'function' && typeof b === 'function' && opts?.function) {
      const diff = opts.function(a, b);

      if (diff !== undefined) {
        return diff;
      }
    }

    return b;
  };

  return mergeValue(a, b);
};

type FlatType = {
  type: string;
  [key: string]: any;
};

export type FlattenedType = {
  root: { $$typeId: string };
  types: Record<string, FlatType>;
};

/**
 * Flatten a Type and its children
 */
export const flatten = (root: t.Type) => {
  const types: Record<string, FlatType> = {};

  const convert = (value: any) => {
    if (!value) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((c) => convert(c));
    }

    if (typeof value === 'object') {
      const obj = Object.entries(value).reduce((accum, [k, v]) => {
        return {
          ...accum,
          [k]: convert(v),
        };
      }, {});

      if (value instanceof t.Type) {
        types[value.id] = obj;
        return {
          $$typeId: value.id,
        };
      }

      return obj;
    }

    return value;
  };

  const flattenRoot = convert(root);

  return {
    types,
    root: flattenRoot,
  };
};

/**
 * Restore a flattend Type
 */
export const unflatten = (flattenedType: FlattenedType) => {
  const { root, types } = flattenedType;

  const convert = (value) => {
    if (!value) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((child) => convert(child));
    }

    if (typeof value === 'object') {
      let obj = value;

      let isType = false;

      if (value['$$typeId']) {
        obj = types[value['$$typeId']];
        isType = true;
      }

      const transformedObj = Object.entries(obj).reduce(
        (accum, [key, child]) => {
          return {
            ...accum,
            [key]: convert(child),
          };
        },
        {}
      );

      if (isType) {
        return Schema.fromJSON(transformedObj);
      }

      return transformedObj;
    }

    return value;
  };

  return convert(root);
};

/**
 * Collect all child Types within a given Type
 */
export const collect = (type: t.Type) => {
  const types: t.Type[] = [];

  const collect = (value: any) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((c) => collect(c));
      return;
    }

    if (typeof value === 'object') {
      if (value instanceof t.Type) {
        types.push(value);
      }

      Object.keys(value).forEach((key) => {
        collect(value[key]);
      });

      return;
    }
  };

  collect(type);

  return types;
};

export const is = <T extends Type>(
  value: any,
  type: TypeConstructor<T>
): value is T => {
  return value instanceof type;
};

/**
 * Assert a value's Type
 */
export function assert<T extends Type>(
  value: any,
  assertedType: TypeConstructor<T>
): T;
export function assert<T extends Type, C extends (value: T) => any>(
  value: any,
  assertedType: TypeConstructor<T>,
  cb: C
): ReturnType<C>;
export function assert<T extends Type, C extends (value: T) => any>(
  value: any,
  assertedType: TypeConstructor<T>,
  cb?: C
) {
  if (!is(value, assertedType)) {
    throw new Error(`Invalid type. Expected type ${assertedType.name}`);
  }

  if (cb) {
    return cb(value);
  }

  return value;
}
