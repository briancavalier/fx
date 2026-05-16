# Example Notes

Examples should demonstrate how applications are built from effects plus handlers.

Good examples:
- define small domain effects,
- write business logic against those effects,
- prefer const arrow functions over function declarations,
- prefer expression-bodied arrow functions over block bodies with only a return
  statement when readability is unchanged,
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

Avoid:
- turning examples into framework code,
- hiding effect handling behind large helper layers,
- using direct platform side effects when an existing library effect demonstrates
  the same behavior,
- depending on generated `dist/`.

Examples may import from `../src` or `../../src` while developing locally.
