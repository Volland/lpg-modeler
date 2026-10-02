import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  ABSTRACT_DASH, EDGE_WIDTH, NODE_WIDTH, connectors, isAbstractEdge, edgeHeightOf, faceSides, place, type Extent, type Positions,
} from '../src/webview/diagram'
import type { Projection, WireEdge, WireNode } from '../src/protocol'

const node = (name: string, props = 1): WireNode => ({
  id: `n-${name}`, name, abstract: false, open: false, ancestors: [], mixins: [],
  props: Array.from({ length: props }, (_, i) => ({
    id: `${name}-p${i}`, name: `p${i}`, type: 'string', required: false, unique: false,
    isKey: i === 0, list: false,
  })),
  constraints: [], hasRawShacl: false,
})

const edge = (name: string, from: string, to: string): WireEdge => ({
  id: `e-${name}`, name, from, to, props: [],
  cardinality: { from: '*', to: '*', label: 'many to many', constrained: false },
})

const projection = (nodes: WireNode[], edges: WireEdge[]): Projection => ({
  views: ['overview'], activeView: 'overview', nodes, edges, mixins: [], positions: {},
  diagnostics: [], targets: [], scalars: [],
})

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }, h: number) =>
  Math.abs(a.x - b.x) < EDGE_WIDTH && Math.abs(a.y - b.y) < h

// @lat: [[architecture#Rendering#Edge boxes]]
describe('edge types are boxes joined by directed connectors', () => {
  it('runs one connector into the edge box and one out of it, each with an arrowhead', () => {
    const p = projection([node('Person'), node('Company')], [edge('WORKS_AT', 'Person', 'Company')])

    const drawn = connectors(p)

    expect(drawn.map((c) => [c.source, c.target])).toEqual([
      ['n-Person', 'e-WORKS_AT'],
      ['e-WORKS_AT', 'n-Company'],
    ])
    for (const c of drawn) {
      expect(c.markerEnd).toMatchObject({ type: 'arrowclosed', color: 'var(--edge)' })
      // Either half selects the edge type, so both carry its id.
      expect(c.data).toEqual({ edgeId: 'e-WORKS_AT' })
    }
  })

  it('draws an edge type from a type to itself as a loop through its box', () => {
    const p = projection([node('Person')], [edge('KNOWS', 'Person', 'Person')])

    expect(connectors(p).map((c) => [c.source, c.target])).toEqual([
      ['n-Person', 'e-KNOWS'],
      ['e-KNOWS', 'n-Person'],
    ])
  })

  it('draws nothing for an edge type whose endpoint is off the diagram', () => {
    const p = projection([node('Person')], [edge('WORKS_AT', 'Person', 'Company')])

    expect(connectors(p)).toEqual([])
  })

  it('attaches each connector to the sides of its boxes that face each other', () => {
    // KNOWS joins Person to itself, so one of its connectors always runs back towards
    // the box it left. From fixed sides it would cross behind both boxes.
    const p = projection([node('Person')], [edge('KNOWS', 'Person', 'Person')])
    const boxes = new Map<string, Extent>([
      ['n-Person', { x: 0, width: NODE_WIDTH }],
      ['e-KNOWS', { x: 400, width: EDGE_WIDTH }],
    ])

    const faced = faceSides(connectors(p), boxes)

    expect(faced.map((c) => [c.source, c.sourceHandle, c.target, c.targetHandle])).toEqual([
      ['n-Person', 'r', 'e-KNOWS', 'l'],
      // The way back attaches lower, so the loop is two arrows rather than one line.
      ['e-KNOWS', 'l-lo', 'n-Person', 'r-lo'],
    ])
  })

  it('re-attaches a connector when a box is dragged past the other, and only then', () => {
    const p = projection([node('Person'), node('Company')], [edge('WORKS_AT', 'Person', 'Company')])
    const at = (company: number) => new Map<string, Extent>([
      ['n-Person', { x: 500, width: NODE_WIDTH }],
      ['e-WORKS_AT', { x: 800, width: EDGE_WIDTH }],
      ['n-Company', { x: company, width: NODE_WIDTH }],
    ])
    const before = faceSides(connectors(p), at(1100))

    expect(faceSides(before, at(1200))).toBe(before)
    const after = faceSides(before, at(0))
    expect(after[1]).toMatchObject({ sourceHandle: 'l', targetHandle: 'r' })
    expect(after[0]).toBe(before[0])
  })

  it('lays a fresh diagram out in the direction of its edges', async () => {
    const p = projection(
      [node('Person'), node('Company'), node('City')],
      [edge('WORKS_AT', 'Person', 'Company'), edge('LOCATED_IN', 'Company', 'City')],
    )

    const at = await place(p, {})

    expect(at['n-Person']!.x).toBeLessThan(at['e-WORKS_AT']!.x)
    expect(at['e-WORKS_AT']!.x).toBeLessThan(at['n-Company']!.x)
    expect(at['n-Company']!.x).toBeLessThan(at['e-LOCATED_IN']!.x)
    expect(at['e-LOCATED_IN']!.x).toBeLessThan(at['n-City']!.x)
  })

  it('places the edge boxes of a diagram arranged before they existed, moving no type', async () => {
    const p = projection([node('Person'), node('Company')], [edge('WORKS_AT', 'Person', 'Company')])
    const saved: Positions = { 'n-Person': { x: 0, y: 0 }, 'n-Company': { x: 800, y: 200 } }

    const at = await place(p, saved)

    expect(at['n-Person']).toEqual(saved['n-Person'])
    expect(at['n-Company']).toEqual(saved['n-Company'])
    const box = at['e-WORKS_AT']!
    expect(box.x).toBeGreaterThan(NODE_WIDTH / 2)
    expect(box.x + EDGE_WIDTH).toBeLessThan(800 + NODE_WIDTH / 2)
    expect(box.y).toBeGreaterThan(0)
    expect(box.y).toBeLessThan(200 + 100)
  })

  it('keeps edge boxes between the same pair from covering each other', async () => {
    const p = projection(
      [node('Person'), node('Company')],
      [edge('WORKS_AT', 'Person', 'Company'), edge('FOUNDED', 'Person', 'Company'),
        edge('EMPLOYS', 'Company', 'Person')],
    )
    const saved: Positions = { 'n-Person': { x: 0, y: 0 }, 'n-Company': { x: 800, y: 0 } }

    const at = await place(p, saved)

    const boxes = ['e-WORKS_AT', 'e-FOUNDED', 'e-EMPLOYS'].map((id) => at[id]!)
    const h = edgeHeightOf(0)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!, h)).toBe(false)
    }
  })

  it('leaves a box it already has a position for where it is', async () => {
    const p = projection([node('Person'), node('Company')], [edge('WORKS_AT', 'Person', 'Company')])
    const saved: Positions = {
      'n-Person': { x: 0, y: 0 }, 'n-Company': { x: 800, y: 0 }, 'e-WORKS_AT': { x: 30, y: 600 },
    }

    expect(await place(p, saved)).toEqual(saved)
  })
})

// @lat: [[architecture#Rendering#Edge boxes#Telling the kinds apart]]
describe('edge boxes and node type boxes are told apart without color', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'webview', 'styles.css'), 'utf8')
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('gives an edge box its own shape: rounded corners and a double border', () => {
    const edgeBox = rule('.erd-edge')
    expect(edgeBox).toMatch(/border: 3px double var\(--kind-edge\)/)
    expect(edgeBox).toMatch(/border-radius: 14px/)
    expect(rule('.erd')).toMatch(/border-radius: 4px/)
  })

  it('marks a node type box with the node kind color', () => {
    expect(rule('.erd-node')).toMatch(/border-top: 3px solid var\(--kind-node\)/)
  })

  it('pins the kind colors in the print-safe export', () => {
    const light = rule('.export-light')
    expect(light).toMatch(/--kind-node: #[0-9a-f]{6}/)
    expect(light).toMatch(/--kind-edge: #[0-9a-f]{6}/)
  })

  it('names the kind and the endpoints on the edge box itself', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'webview', 'nodes.tsx'), 'utf8')
    expect(source).toMatch(/className="erd-badge erd-kind-edge">edge</)
    expect(source).toMatch(/\{end\(d\.from, d\.fromAbstract\)\} → \{end\(d\.to, d\.toAbstract\)\}/)
  })
})

// @lat: [[architecture#Rendering#Abstract types]]
describe('abstract types are told apart without color', () => {
  const abstract = (name: string) => ({ ...node(name), abstract: true })

  it('draws an edge type as abstract when either end is an abstract node type', () => {
    const nodes = [abstract('Asset'), node('Depot'), node('Truck'), node('Trailer')]
    expect(isAbstractEdge(edge('STATIONED_AT', 'Asset', 'Depot'), nodes)).toBe(true)
    expect(isAbstractEdge(edge('HOUSES', 'Depot', 'Asset'), nodes)).toBe(true)
    expect(isAbstractEdge(edge('TOWS', 'Truck', 'Trailer'), nodes)).toBe(false)
  })

  it('dashes both connectors of an abstract edge type, and only those', () => {
    const p = projection([abstract('Asset'), node('Depot'), node('Truck'), node('Trailer')], [
      edge('STATIONED_AT', 'Asset', 'Depot'), edge('TOWS', 'Truck', 'Trailer'),
    ])
    const drawn = connectors(p)
    const dash = (edgeId: string) => drawn.filter((c) => c.data?.edgeId === edgeId)
      .map((c) => c.style?.strokeDasharray)
    expect(dash('e-STATIONED_AT')).toEqual([ABSTRACT_DASH, ABSTRACT_DASH])
    expect(dash('e-TOWS')).toEqual([undefined, undefined])
  })

  it('marks abstract boxes by border, italics and hatching, never by opacity', () => {
    // Opacity was the original mark, and it took the box's text below the contrast floor.
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'webview', 'styles.css'), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*erd-abstract[^{}]*\{[^}]*\}/g) ?? []
    expect(rules.join('\n')).not.toMatch(/opacity/)
    expect(css).toMatch(/\.erd-abstract \{[^}]*border-style: dashed/)
    expect(css).toMatch(/\.erd-abstract \.erd-name[^{]*\{[^}]*font-style: italic/)
    expect(css).toMatch(/\.erd-abstract > \.erd-title \{[^}]*repeating-linear-gradient/)
  })

  it('names the box abstract in text as well', () => {
    const tsx = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'webview', 'nodes.tsx'), 'utf8')
    expect(tsx.match(/«abstract»/g)?.length).toBe(2)
  })
})
