export {
  intersperse,
  concat,
  accumulate,
}

/**
Intersperse a given element between every item in a list.
 */
function intersperse<T>(el: T, lst: T[]): T[] {
  if (lst.length === 0) return []
  const result: T[] = [lst[0]]
  for (const item of lst.slice(1)) {
    result.push(el, item)
  }
  return result
}

/**
Flattens a nested list one step.

@example
```
concat([[1, 2], [3, 4]])
⇒ [1, 2, 3, 4]
```
 */
function concat<T>(lst: T[][]): T[] {
  return lst.flatMap(x => x)
}

/**
Accumulate a list of differences, into a list of numbers
 */
function accumulate(l: number[]): number[] {
  let current = 0
  const result = []
  for (const offset of l) {
    current += offset
    result.push(current)
  }
  return result
}
