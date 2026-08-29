# 0001 — Fastify over NestJS or Express

**Status:** Accepted · **Date:** 2026-08-27

## Context

The API needs runtime validation, an OpenAPI document, and types shared with a
TypeScript frontend. The three realistic choices were Express, NestJS and
Fastify.

## Decision

Fastify 5, with `fastify-type-provider-zod`.

## Why

The deciding property is that **the validation schema and the OpenAPI document
are the same object**. A route declares a Zod schema; Fastify validates against
it at runtime and `@fastify/swagger` derives the specification from it. There is
no second place where the shape is written down, so there is nothing for the
documentation to drift from.

Express with hand-maintained JSDoc annotations is the arrangement that always
rots: the annotation is a comment, comments do not fail builds, and within a
quarter the docs describe an endpoint that no longer exists.

NestJS would have worked. It was rejected because its dependency-injection
ceremony obscures the design rather than expressing it — for a service with four
layers and one dependency graph, the module system is overhead that makes the
architecture harder to read, not easier. The layering here is enforced by
`eslint-plugin-boundaries` instead, which fails the build with a message naming
the offending import.

## Consequences

- The contract chain (Zod → OpenAPI → generated client types) is what makes a
  breaking API change fail the *frontend's* typecheck in CI.
- Fastify's encapsulation means a type provider does not inherit into a
  registered plugin; each route module re-applies it. Noted where it happens.
- Less prescriptive than Nest, so conventions had to be chosen deliberately —
  which is the reason this file and the boundaries lint rules exist.
