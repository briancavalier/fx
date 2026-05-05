# Example Notes

Examples should demonstrate how applications are built from effects plus handlers.

Good examples:
- define small domain effects,
- write business logic against those effects,
- provide one or more handlers,
- compose handlers with `.pipe(...)`,
- show effect constructors in their pipeable form when available, e.g. `work.pipe(timeout({ ms: 500 }))`,
- keep the focus on user-facing effects and explicit handler composition,
- recover or log failures without obscuring the handler composition,
- end with `run`, `runPromise`, or `runTask`.

Avoid:
- turning examples into framework code,
- hiding effect handling behind large helper layers,
- depending on generated `dist/`.

Examples may import from `../src` or `../../src` while developing locally.
