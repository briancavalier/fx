import { Sink, Stream, flatMap, fx, ok, run } from '../../src'

// From Effect-TS discord
// https://discord.com/channels/795981131316985866/1125094089281511474/1245070996621365318
// Original text:
// "
// I have a fun challenge for you all related to using Streams in
// Effect for data manipulation. Consider the following array:
//
// Array: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
// 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
// 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
// 49, 50]
//
// The goal is to group this array based on the condition that a
// new group is formed every time a number is divisible by 7.
// Here’s the expected result:
//
// Expected Grouping:
// - Group 1: [1, 2, 3, 4, 5, 6, 7]
// - Group 2: [8, 9, 10, 11, 12, 13, 14]
// - Group 3: [15, 16, 17, 18, 19, 20, 21]
// - Group 4: [22, 23, 24, 25, 26, 27, 28]
// - Group 5: [29, 30, 31, 32, 33, 34, 35]
// - Group 6: [36, 37, 38, 39, 40, 41, 42]
// - Group 7: [43, 44, 45, 46, 47, 48, 49]
// - Group 8: [50]
// "

// groupDivBy7: Fx<Sink.Sink<number> | Stream.Stream<number[]>, number[]>
// Consumes numbers and emits number[] by grouping them
// when a number is divisible by 7. Note that this is not the
// same as splitting into groups of size 7
const groupDivBy7 = fx(function* () {
  let group: number[] = []
  try {
    while (true) {
      const n = yield* Sink.next<number>()
      group.push(n)
      if ((n % 7) === 0) {
        yield* Stream.emit(group)
        group = []
      }
    }
  } finally {
    return group // return trailing numbers
  }
})

// [1, 2, 3, ... 50]
const numbers = Array.from({ length: 50 }, (_, i) => i + 1)

Stream.fromIterable(numbers).pipe(
  _ => Stream.to(_, groupDivBy7),
  flatMap(Stream.emit), // emit trailing numbers
  _ => Stream.forEach(_, numbers => ok(console.log(numbers))),
  run
)
