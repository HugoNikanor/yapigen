export {
  intersperse,
  concat,
}

function intersperse<T>(el: T, lst: T[]): T[] {
  if (lst.length === 0) return []
  const result: T[] = [lst[0]]
  for (const item of lst.slice(1)) {
    result.push(el, item)
  }
  return result
}

function concat<T>(lst: T[][]): T[] {
  return lst.flatMap(x => x)
}
