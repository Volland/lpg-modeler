---
tgs: "0.1"
prefixes:
  social: "https://example.org/vocab/social#"
schemas:
  Car:
    uri: social:Car
    properties:
      vin: {required: true}
      seats: number
    edges: {}
  Company:
    uri: social:Company
    properties:
      vat: text
      id: {required: true}
    edges:
      OWNS: Car
  Party:
    uri: social:Party
    properties:
      id: {required: true}
    edges:
      OWNS: Car
  Person:
    uri: social:Person
    properties:
      email: {required: true}
      born: date
      createdAt: {kind: datetime, required: true}
      id: {required: true}
    edges:
      KNOWS: Person
      LIKES: Company
      OWNS: Car
edgeTypes:
  KNOWS:
    uri: social:KNOWS
    from: Person
    to: Person
    properties:
      since: date
  LIKES:
    uri: social:LIKES
    from: Person
    to: Company
  OWNS:
    uri: social:OWNS
    from: [Company, Person]
    to: Car
    properties:
      since: date
lpg:
  namespace: {prefix: social, iri: "https://example.org/vocab/social#"}
  nodes:
    Car: {id: n_car, key: [vin], props: {vin: {id: p_vin}, seats: {id: p_seat, type: INT64}}}
    Company: {id: n_comp, extends: Party, props: {vat: {id: p_vat}}}
    Party: {id: n_party, abstract: true, key: [id], props: {id: {id: p_pid}}}
    Person: {id: n_person, extends: Party, mixins: [Timestamped], props: {email: {id: p_mail, unique: true}, born: {id: p_born}}}
  edges:
    KNOWS: {id: e_knows, from: Person, to: Person, props: {since: {id: p_ksince}}}
    LIKES: {id: e_likes, from: Person, to: Company}
    OWNS: {id: e_owns, from: Party, to: Car, props: {since: {id: p_since}}}
  mixins:
    Timestamped: {id: m_stamp, props: {createdAt: {id: p_creat}}}
---
# social

The node types and edge types of the `social` model (https://example.org/vocab/social#), written by lpg-modeler.

The `lpg` key keeps what TGS cannot say -- abstract types, inheritance, keys, uniqueness and exact types -- so `lpg import` reads this note back into the same model. TGS readers ignore it.
