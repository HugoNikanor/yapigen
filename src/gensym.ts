export { get_gensym }

function get_gensym(random: () => number): (hint?: string) => string {
  return (hint) => {
    const num = Math.floor(random() * 2 ** 48).toString()
    return `_${hint ? hint + '_' : ''}${num}`
  }
}

