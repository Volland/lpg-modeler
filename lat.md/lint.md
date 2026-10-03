# Query Lint

`lpg lint-queries` checks the labels, relationship types and property names in query files against the model they assume, so a rename surfaces at lint time rather than in production. Linted by [[packages/core/src/querylint.ts#lintQuery]].

Queries are claims about a schema, and nothing else checks them. The findings are an unknown label, an unknown relationship type, a property no resolved type carries, an edge traversed against its declared direction or between types it cannot connect, a literal that cannot be compared with its property, and an enum value the model does not have. Each is positioned at the offending token, so the editor can underline it; an unreadable break in the text is a warning, and anything else is an error that makes the command exit non-zero.

There is no grammar. A lexer reads strings, comments (`//` and block, but not `--`, which in a pattern is an undirected edge), quoted names and numbers correctly, and pattern chains — `(a:L)-[r:T]->(b)` — are extracted from the token stream. Everything else is passed over, which is why Memgraph's and FalkorDB's dialect differences do not matter: only patterns and `variable.property` are read.

Only query text is linted. A source file with a query inside it is not lexed, because finding the query is a parser's job for each host language and a wrong guess is worse than none.

## What it will not guess

A linter that cries wolf is worse than none, so whatever cannot be resolved is skipped, never reported.

An unlabelled variable has no type to check. A name a statement rebinds — `WITH p.born AS p`, `[p IN xs]`, `UNWIND … AS p` — no longer means what a pattern said it did. A label expression (`:A|B`, `:!A`) is not resolved, and a `(` after a word that is not a pattern keyword is a call, not a pattern. A subtype's property read off a supertype-labelled node is a question of which instances are meant, and an open type may carry any property, so neither is a finding; an open type still has its *declared* properties checked, because its type and enum are known. Variables are scoped to one statement. When a relationship has several types it is reported only if none of them fits.

The false-positive suite is the specification of this section: labels in strings and comments, map keys, variable-length paths, multi-label nodes, function calls, rebinding, and parenthesised expressions each have a case that must stay quiet.
