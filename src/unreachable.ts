export { assertUnreachable }

// TODO replace this with proper import from Todo-3.0
function assertUnreachable(x: never): never {
  throw new Error(`Getting here should be impossible: ${JSON.stringify(x)}`)
}
