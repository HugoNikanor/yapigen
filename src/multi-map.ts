export { MultiMap, SetMap }

/**
A mapping between keys, and lists of values.

Works similarly to the built-in Map, but all values are lists.
 */
class MultiMap<K, V> {

  #map: Map<K, V[]> = new Map

  get(k: K) { return this.#map.get(k) }

  push(k: K, ...vs: V[]) {
    let lst = this.#map.get(k)
    if (!lst) {
      lst = []
      this.#map.set(k, lst)
    }

    for (const v of vs) {
      lst.push(v)
    }
  }

  /** Returns a new Map, matching the contentsn of this MultiMap. */
  toMap(): Map<K, V[]> {
    return new Map(this.#map)
  }
}

class SetMap<K, V> {

  #map: Map<K, Set<V>> = new Map

  get(k: K) { return this.#map.get(k) }
  delete(k: K) { return this.#map.delete(k) }
  get size() { return this.#map.size }

  push(k: K, ...vs: V[]) {
    let set = this.#map.get(k)
    if (!set) {
      set = new Set
      this.#map.set(k, set)
    }

    for (const v of vs) {
      set.add(v)
    }
  }

  *[Symbol.iterator]() {
    for (const e of this.#map) {
      yield e
    }
  }
}
