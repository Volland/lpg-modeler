import type { ScalarType } from '../ir'

/** IRIs and shared naming rules for reading RDF back into a model. */

export const SH = 'http://www.w3.org/ns/shacl#'
export const OWL = 'http://www.w3.org/2002/07/owl#'
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'

export const sh = (t: string) => SH + t
export const owl = (t: string) => OWL + t
export const rdfs = (t: string) => RDFS + t

/** Prefixes that never name the model's own vocabulary. */
export const WELL_KNOWN: ReadonlySet<string> =
  new Set(['sh', 'owl', 'rdfs', 'rdf', 'xsd', 'skos', 'dc', 'dct', 'dcterms', 'foaf', 'linkml'])

/**
 * The canonical scalar for an XSD datatype. The forward map in `emit/reify` is not
 * injective -- `int` and `int128` both write `xsd:integer`, `datetime` and
 * `zoneddatetime` both write `xsd:dateTime`, and `string`, `uuid` and `json` all write
 * `xsd:string` -- so reading one back is a choice, not a recovery. This picks the
 * commonest member of each collision and the importer reports the ones that were
 * genuinely ambiguous. See lat.md/importers#Ambiguous Datatypes.
 */
const FROM_XSD: Record<string, ScalarType> = {
  string: 'string',
  byte: 'int8', short: 'int16', int: 'int32', integer: 'int', long: 'int',
  unsignedByte: 'uint8', unsignedShort: 'uint16',
  unsignedInt: 'uint32', unsignedLong: 'uint64',
  float: 'float32', double: 'float', decimal: 'decimal',
  boolean: 'boolean',
  date: 'date', dateTime: 'datetime', duration: 'duration',
  base64Binary: 'blob', hexBinary: 'blob',
  anyURI: 'string', normalizedString: 'string', token: 'string',
  nonNegativeInteger: 'uint64', positiveInteger: 'uint64',
}

/** Datatypes that more than one scalar writes, so reading one back loses which. */
export const AMBIGUOUS: ReadonlySet<string> = new Set(['string', 'integer', 'dateTime'])

export function scalarForDatatype(iri: string): ScalarType | undefined {
  return iri.startsWith(XSD) ? FROM_XSD[iri.slice(XSD.length)] : undefined
}

/** `https://ex.org/v#Person` -> `Person`; also handles a trailing-slash namespace. */
export function localName(iri: string): string {
  const hash = iri.lastIndexOf('#')
  const slash = iri.lastIndexOf('/')
  return iri.slice(Math.max(hash, slash) + 1)
}

/** The namespace an IRI sits in, i.e. everything before its local name. */
export function namespaceOf(iri: string): string {
  return iri.slice(0, iri.length - localName(iri).length)
}

/**
 * `knows` -> `KNOWS`, `livesAt` -> `LIVES_AT`. The inverse of `lowerCamel` in
 * `emit/reify`, used when no `rdfs:label` recorded the edge's original name.
 */
export function upperSnake(camel: string): string {
  return camel.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
}
