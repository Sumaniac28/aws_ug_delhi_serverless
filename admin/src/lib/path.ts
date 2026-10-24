/** Immutable get/set by dotted path ("agenda.2.title"), so one generic form can edit any document. */

export function parsePath(path: string): (string | number)[] {
  return path === '' ? [] : path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

export function getIn(obj: unknown, path: string): any {
  let cur: any = obj;
  for (const key of parsePath(path)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key as keyof typeof cur];
  }
  return cur;
}

/**
 * Returns a copy of obj with the value at path replaced. Missing containers are created (an array when
 * the next key is a number). Setting undefined removes the key, which is how an emptied optional field
 * disappears from the saved JSON instead of being saved as "".
 */
export function setIn<T>(obj: T, path: string, value: unknown): T {
  const keys = parsePath(path);
  if (keys.length === 0) return value as T;
  const [head, ...rest] = keys as [string | number, ...(string | number)[]];
  const restPath = rest.join('.');

  const container: any = Array.isArray(obj) ? [...obj] : { ...((obj as object | undefined) ?? {}) };
  const child = container[head];
  const next = rest.length === 0 ? value : setIn(child ?? (typeof rest[0] === 'number' ? [] : {}), restPath, value);

  if (next === undefined && rest.length === 0) {
    if (Array.isArray(container)) container.splice(head as number, 1);
    else delete container[head];
  } else {
    container[head] = next;
  }
  return container;
}

/** Removes index from the array at path. */
export function removeAt<T>(obj: T, path: string, index: number): T {
  const list = [...((getIn(obj, path) as unknown[] | undefined) ?? [])];
  list.splice(index, 1);
  return setIn(obj, path, list);
}

/** Appends an item to the array at path (creating it). */
export function append<T>(obj: T, path: string, item: unknown): T {
  return setIn(obj, path, [...((getIn(obj, path) as unknown[] | undefined) ?? []), item]);
}

/** Moves an item within the array at path. */
export function move<T>(obj: T, path: string, from: number, to: number): T {
  const list = [...((getIn(obj, path) as unknown[] | undefined) ?? [])];
  if (to < 0 || to >= list.length) return obj;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return setIn(obj, path, list);
}
