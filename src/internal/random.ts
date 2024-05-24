// Adapted from pure-rand (MIT License). Thank you @dubzzz!
// See: https://github.com/dubzzz/pure-rand
// XoroShiro128+ with a=24, b=16, c=37,
// - https://en.wikipedia.org/wiki/Xoroshiro128%2B
// - http://prng.di.unimi.it/xoroshiro128plus.c

/**
 * Mutable XoroShiro128+ generator.
 * Should not be exposed in public APIs
 */
export class XoroShiro128Plus {
  constructor(private s01: number, private s00: number, private s11: number, private s10: number) { }

  clone(): XoroShiro128Plus {
    return new XoroShiro128Plus(this.s01, this.s00, this.s11, this.s10)
  }

  unsafeNext(): number {
    const out = (this.s00 + this.s10) | 0
    // a = s0[n] ^ s1[n]
    const a0 = this.s10 ^ this.s00
    const a1 = this.s11 ^ this.s01
    const s00 = this.s00
    const s01 = this.s01
    // s0[n+1] = rotl(s0[n], 24) ^ a ^ (a << 16)
    this.s00 = (s00 << 24) ^ (s01 >>> 8) ^ a0 ^ (a0 << 16)
    this.s01 = (s01 << 24) ^ (s00 >>> 8) ^ a1 ^ ((a1 << 16) | (a0 >>> 16))
    // s1[n+1] = rotl(a, 37)
    this.s10 = (a1 << 5) ^ (a0 >>> 27)
    this.s11 = (a0 << 5) ^ (a1 >>> 27)
    return out
  }

  unsafeJump(): void {
    // equivalent to 2^64 calls to next()
    // can be used to generate 2^64 non-overlapping subsequences
    let ns01 = 0
    let ns00 = 0
    let ns11 = 0
    let ns10 = 0
    const jump = [0xd8f554a5, 0xdf900294, 0x4b3201fc, 0x170865df]
    for (let i = 0; i !== 4; ++i) {
      for (let mask = 1; mask; mask <<= 1) {
        // Because: (1 << 31) << 1 === 0
        if (jump[i] & mask) {
          ns01 ^= this.s01
          ns00 ^= this.s00
          ns11 ^= this.s11
          ns10 ^= this.s10
        }
        this.unsafeNext()
      }
    }
    this.s01 = ns01
    this.s00 = ns00
    this.s11 = ns11
    this.s10 = ns10
  }
}

export const fromSeed = (seed: number) => new XoroShiro128Plus(-1, ~seed, seed | 0, 0)
