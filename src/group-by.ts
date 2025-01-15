export { }

/**
File borrowed from Todo-3.0
See other repo for tests, ...

@module
 */

import { MultiMap } from './multi-map'

function group_by<T, K>(f: (x: T) => K, xs: T[]): Map<K, T[]> {
  const map = new MultiMap<K, T>

  for (const x of xs) {
    map.push(f(x), x)
  }

  return map.toMap()
}

declare global {
  interface Array<T> {
    groupBy<V>(f: (x: T) => V): Map<V, T[]>
  }
}

Array.prototype.groupBy = function <T, V>(f: (x: T) => V) {
  return group_by(f, this)
}
