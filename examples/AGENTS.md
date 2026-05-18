# Example Notes

Examples should demonstrate how applications are built from effects plus handlers.

Good examples:
- define small domain effects,
- write business logic against those effects,
- prefer const arrow functions over function declarations,
- prefer expression-bodied arrow functions over block bodies with only a return
  statement when readability is unchanged,
- for the smallest examples, use an existing `Fx` value directly when no
  generator sequencing is needed, e.g. `const main = log('Hello, Fx!')`,
- do not wrap a single existing effect in `fx(function* () { yield* effect })`
  unless the wrapper adds sequencing, context parameters, local control flow, or
  a named domain operation,
- define Fx program constructors as constants, e.g.
  `const foo = (a, b, c) => fx(function* () { ... })`, rather than
  `function foo(a, b, c) { return fx(function* () { ... }) }`,
- define pipe transforms as constants, e.g.
  `const withFoo = (program) => program.pipe(...)`, rather than
  `function withFoo(program) { return program.pipe(...) }`,
- provide one or more handlers,
- compose handlers with `.pipe(...)`,
- use library effects for observable behavior, e.g. `Console.log` with
  `defaultConsole`, rather than direct `console.log` inside `Fx` programs,
- show effect constructors in their pipeable form when available, e.g. `work.pipe(timeout({ ms: 500 }))`,
- keep the focus on user-facing effects and explicit handler composition,
- recover or log failures without obscuring the handler composition,
- end with `run`, `runPromise`, or `runTask`.
- prefer `program.pipe(handler, run)` over `run(program.pipe(handler))` in
  examples when it makes the interpreter pipeline easier to scan.

Avoid:
- turning examples into framework code,
- hiding effect handling behind large helper layers,
- using direct platform side effects when an existing library effect demonstrates
  the same behavior,
- adding a `main` generator solely to yield one already-constructed `Fx`,
- depending on generated `dist/`.

Examples may import from local `src` paths while developing locally.
