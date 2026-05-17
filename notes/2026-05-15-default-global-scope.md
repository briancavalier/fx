# Default Global Scope

## Context

Scoped effects currently require an explicit scope name. A default global scope
could let scoped effects be used with less ceremony while still keeping effect
requirements visible in types.

The central idea is to provide a concrete scope value, for example:

```ts
export const GlobalScope = 'fx/Scope/Global' as const
```

Then selected scoped APIs could offer overloads that use `GlobalScope` when no
scope is supplied:

```ts
abort()
abort(scope)

orReturn(value)
orReturn(scope, value)
```

The default should still appear in effect types, such as
`Fx<Abort<typeof GlobalScope>, A>`, so it is not an ambient capability.

## Potential Benefits

- Reduces ceremony for common one-region application code.
- Makes scoped effects feel less split from ordinary effects.
- Keeps the effect requirement explicit because the default scope is a real
  typed value.
- Allows handler-style APIs such as `orReturn(value)` or
  `restartOnAbort(GlobalScope, options)` to remain type-directed.
- Could provide a smoother path from local code to explicitly named scopes when
  code becomes reusable or library-facing.

## Risks

- A shared global scope can become a junk drawer where unrelated effects
  accidentally interact.
- Control effects such as `Abort`, `ReturnFrom`, and scoped restart are the most
  sensitive because a handler for the global scope may catch an exit it did not
  intend to own.
- Public libraries that default to the global scope could become harder to
  compose safely with application handlers.
- Default-scope overloads may obscure intent at call sites if used broadly.
- Extending the default to every scoped effect too quickly risks coupling the
  model to the hardest type cases, especially bidirectional `YieldFrom`.

## Design Hints

- Start conservatively with `Abort`, and possibly `ReturnFrom`, before applying
  the idea to all scoped effects.
- Treat the global scope as an ergonomic default for application/local code.
  Prefer explicit named scopes in library and public API surfaces.
- Keep the default scope exported as a named constant rather than hiding it in
  implementation details.
- Add tests that verify handlers narrow only the default scope they intend to
  handle, and that explicit scopes remain independent.
- Avoid adding new runtime machinery for the default scope. It should be a
  normal scope value with normal scoped-effect behavior.

## YieldFrom Notes

`YieldFrom` is trickier because the scope carries the yield protocol type:

```ts
Scope extends string & Yielding<Out, In>
```

A global scope can still work if multiple brands on the same runtime scope
coalesce predictably:

```ts
S & Yielding<Out1, In1> & Yielding<Out2, In2>
```

The proposed composition rule is:

- output types coalesce by union: `Out1 | Out2`
- input types coalesce by intersection: `In1 & In2`

This encourages input types to use nested record fields so intersections remain
useful:

```ts
type AskUser = Yielding<
  { type: 'askUser'; id: string },
  { askUser: User }
>

type AskConfig = Yielding<
  { type: 'askConfig'; key: string },
  { askConfig: Config }
>
```

The resulting input type becomes:

```ts
{ askUser: User } & { askConfig: Config }
```

This model treats global-yield input as accumulated contextual data made
available by the handler, not as a response correlated only to one specific
output. If request/response correlation is needed, use an explicit scope or a
more specialized protocol shape.

The main technical risk is TypeScript extraction from multiple `Yielding`
brands on an intersection. Prototype the type-level extraction first before
changing runtime code.
