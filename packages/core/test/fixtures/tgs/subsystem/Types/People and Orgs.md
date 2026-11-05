---
tgs: "0.1"
prefixes:
  ex: https://example.org/vocab/
schemas:
  Person:
    uri: schema:Person
    properties:
      name: text
      email: {kind: text, required: true, uri: schema:email}
    edges:
      worksAt: Company
      knows: {target: [Person, Bot], many: true}
      mentor: {target: Person, many: false, required: false}
  Company:
    uri: schema:Organization
    properties: {name: text, founded: date, site: {kind: link, uri: ex:site}}
    edges: []
  Bot: {}
edgeTypes:
  worksAt:
    uri: schema:worksFor
    from: Person
    to: Company
    properties:
      since: date
      role: {kind: text, values: [engineer, manager], required: true}
---

How people and organisations relate. This body is documentation, not a template.
