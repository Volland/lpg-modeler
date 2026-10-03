import { describe, expect, it } from 'vitest'
import { handleMcpMessage, MCP_TOOL_NAMES, type ModelSource } from '../src/mcp'
import { loadFixture } from './helpers'

const source: ModelSource = () => ({ model: loadFixture('social.lpg.yaml') })
const call = (msg: object, src: ModelSource = source) =>
  handleMcpMessage(JSON.stringify(msg), src) as Record<string, any> | undefined
const tool = (name: string, args: object = {}, src: ModelSource = source) =>
  call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, src)!

// @lat: [[agent#Agent]]
describe('mcp protocol', () => {
  it('initializes, listing tools and no writing capability', () => {
    const r = call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })!
    expect(r.result.protocolVersion).toBe('2025-03-26')
    expect(Object.keys(r.result.capabilities)).toEqual(['tools'])
    const list = call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })!
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOL_NAMES)
    // Nothing here writes: no tool name suggests it, and none takes content to store.
    expect(MCP_TOOL_NAMES.every((n) => /^(schema_card|list_types|describe_)/.test(n))).toBe(true)
  })

  it('answers a notification with nothing, and an unknown request with an error', () => {
    expect(call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
    expect(call({ jsonrpc: '2.0', id: 3, method: 'nope' })!.error.code).toBe(-32601)
    expect(handleMcpMessage('{not json', source)).toMatchObject({ error: { code: -32700 } })
  })

  it('describes a type with inherited properties, key, mixins and edges both ways', () => {
    const r = tool('describe_type', { name: 'Person' })
    const person = JSON.parse(r.result.content[0].text)
    expect(person.extends).toBe('Party')
    expect(person.key).toEqual(['id'])
    expect(person.mixins).toEqual(['Timestamped'])
    const id = person.properties.find((p: { name: string }) => p.name === 'id')
    expect(id).toMatchObject({ required: true, inheritedFrom: 'Party' })
    // OWNS is declared on Party and reaches Person; KNOWS leaves and enters it.
    const out = person.outgoing.map((e: { name: string; declaredOn: string }) => `${e.name}@${e.declaredOn}`)
    expect(out).toContain('OWNS@Party')
    expect(out).toContain('KNOWS@Person')
    expect(person.incoming.map((e: { name: string }) => e.name)).toContain('KNOWS')
  })

  it('describes an edge and the schema card, and lists every type', () => {
    const edge = JSON.parse(tool('describe_edge', { name: 'OWNS' }).result.content[0].text)
    expect(edge).toMatchObject({ from: 'Party', to: 'Car', cardinality: 'many-to-many' })
    expect(tool('schema_card').result.content[0].text).toContain('**Person** < Party')
    const all = JSON.parse(tool('list_types').result.content[0].text)
    expect(all.nodeTypes.map((n: { name: string }) => n.name)).toContain('Car')
  })

  it('reports an unknown name as a failed call that names what exists', () => {
    const r = tool('describe_type', { name: 'Nope' })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('Known: ')
    expect(call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'delete_type' } })!.error.code).toBe(-32602)
  })

  it('reports a model that cannot be read as a failed call, not a broken session', () => {
    const r = tool('schema_card', {}, () => ({ error: 'The model has 1 error(s): missing-key' }))
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('missing-key')
  })
})
