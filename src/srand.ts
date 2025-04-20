export {
  sfc32,
  randseed,
  type Seed,
}

/**
https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript

```
const getRand = sfc32(randseed());

for (let i = 0; i < 10; i++) console.log(getRand());
```

@module
 */

type Seed = [number, number, number, number]

function sfc32([a, b, c, d]: Seed): () => number {
  a >>>= 0
  b >>>= 0
  c >>>= 0
  d >>>= 0
  return function() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  }
}

function randseed(): Seed {
  const seedgen = () => Math.random() * 2 ** 32
  return [seedgen(), seedgen(), seedgen(), seedgen()]
}
