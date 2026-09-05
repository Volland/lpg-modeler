import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW, addToView, addView, parseLayout, parseViews, projectView, pruneLayout,
  removeFromView, removeFromViews, renameInViews, serializeLayout, serializeViews,
  setPosition, sidecarPaths, typesInNoView,
} from '../src/views'
import { validateModel } from '../src/validate'
import { applyEdits, renameType } from '../src/mutate'
import { resolveModel } from '../src/resolve'
import { fixture, readFile, loadFixture } from './helpers'

const model = () => loadFixture('social.lpg.yaml')

// @lat: [[architecture#Views]]
describe('views', () => {
  it('scopes a diagram to a subset of the model', () => {
    const p = projectView(model(), { name: 'identity', include: ['Person', 'Company'] })
    // Party comes along because a subtype's inherited properties are unreadable without it.
    expect(p.nodes.map((n) => n.name).sort()).toEqual(['Company', 'Party', 'Person'])
    expect(p.nodes.map((n) => n.name)).not.toContain('Car')
    expect(p.edges.map((e) => e.name)).toEqual(['KNOWS', 'LIKES'])
  })

  it('pulls in the declared endpoint when a view asks to expand', () => {
    const p = projectView(model(), { name: 'cars', include: ['Car'], expand: 1 })
    // OWNS is declared on the abstract Party, so one hop from Car reaches Party.
    // Concrete subtypes are not dragged in: the edge does not mention them.
    expect(p.nodes.map((n) => n.name).sort()).toEqual(['Car', 'Party'])
    expect(p.edges.map((e) => e.name)).toContain('OWNS')
  })

  it('shows everything under the default view', () => {
    expect(projectView(model(), DEFAULT_VIEW).nodes).toHaveLength(model().nodes.length)
  })

  it('reports a type that no view includes', () => {
    const views = [{ name: 'partial', include: ['Person'] }]
    expect(typesInNoView(model(), views).sort()).toEqual(['Car', 'Company'])
    const d = validateModel(model(), views).find((x) => x.code === 'type-in-no-view')
    expect(d?.severity).toBe('warning')
  })

  it('round-trips a views file', () => {
    const file = { views: [{ name: 'overview', include: ['*'] }, { name: 'cars', include: ['Car'], expand: 1 }] }
    expect(parseViews(serializeViews(file))).toEqual(file)
  })

  it('adds and removes types from a view', () => {
    let file = parseViews('views:\n  a:\n    include: [Person]\n')
    file = addView(file, 'b', ['Car'])
    file = addToView(file, 'a', 'Company')
    expect(file.views.find((v) => v.name === 'a')!.include).toEqual(['Person', 'Company'])
    file = removeFromView(file, 'a', 'Person')
    expect(file.views.find((v) => v.name === 'a')!.include).toEqual(['Company'])
    expect(file.views.map((v) => v.name)).toEqual(['a', 'b'])
  })
})

// @lat: [[metamodel#Stable Element IDs]]
// @lat: [[architecture#Views]]
describe('views follow the model', () => {
  const file = () => ({
    views: [
      { name: 'overview', include: ['*'] },
      { name: 'people', include: ['Person', 'Company'] },
    ],
  })

  it('carries a rename into every view that named the type', () => {
    // A view holds names rather than ids, so without this a rename drops the type out
    // of the diagram it was drawn on.
    const next = renameInViews(file(), 'Person', 'Individual')
    expect(next.views[1]!.include).toEqual(['Individual', 'Company'])
    expect(next.views[0]!.include).toEqual(['*'])
  })

  it('drops a deleted type from every view', () => {
    expect(removeFromViews(file(), 'Person').views[1]!.include).toEqual(['Company'])
  })

  it('leaves a wildcard view alone when a type is added to it', () => {
    // '*' already includes whatever the model gains; naming it as well would be a lie
    // the moment the type is renamed.
    expect(addToView(file(), 'overview', 'Address').views[0]!.include).toEqual(['*'])
    expect(addToView(file(), 'people', 'Address').views[1]!.include)
      .toEqual(['Person', 'Company', 'Address'])
  })
})

describe('layout', () => {
  it('keys positions by element id, so a rename does not move a box', () => {
    const src = readFile(fixture('social.lpg.yaml'))!
    const person = model().nodes.find((n) => n.name === 'Person')!
    const layout = setPosition({}, 'overview', person.id, { x: 120, y: 40 })

    const renamed = applyEdits(src, renameType(src, 'nodes', 'Person', 'Individual'))
    const { model: after } = resolveModel(fixture('social.lpg.yaml'), (p) =>
      p === fixture('social.lpg.yaml') ? renamed : readFile(p))
    const individual = after.nodes.find((n) => n.name === 'Individual')!

    expect(individual.id).toBe(person.id)
    expect(layout.overview?.[individual.id]).toEqual({ x: 120, y: 40 })
  })

  it('round-trips and orders keys so a move produces a minimal diff', () => {
    const layout = setPosition(setPosition({}, 'v', 'n_b', { x: 2, y: 2 }), 'v', 'n_a', { x: 1, y: 1 })
    const text = serializeLayout(layout)
    expect(text.indexOf('n_a')).toBeLessThan(text.indexOf('n_b'))
    expect(parseLayout(text)).toEqual(layout)
  })

  it('survives a malformed or absent layout file', () => {
    expect(parseLayout('not json at all')).toEqual({})
    expect(parseLayout('{"v": {"n_a": {"x": "nope"}}}')).toEqual({ v: {} })
  })

  it('prunes positions for elements the model no longer has', () => {
    const m = model()
    const layout = setPosition(setPosition({}, 'v', m.nodes[0]!.id, { x: 1, y: 1 }), 'v', 'n_gone', { x: 9, y: 9 })
    const pruned = pruneLayout(layout, m)
    expect(Object.keys(pruned.v ?? {})).toEqual([m.nodes[0]!.id])
  })

  it('derives sidecar paths from the model path', () => {
    expect(sidecarPaths('/w/social.lpg.yaml')).toEqual({
      views: '/w/social.views.yaml', layout: '/w/social.layout.json',
    })
  })
})
