// The reference plugin: one target that lists type names, one source that reads them back.
// It is the compatibility test for the plugin surface — if registration changes shape,
// this stops loading.
const CAPABILITIES = {
  target: 'hello', multiLabel: true, inheritance: 'subclass',
  requiredConstraint: 'unsupported', uniqueConstraint: 'unsupported', compositeKey: 'unsupported',
  edgeProps: 'native', nestedEdges: false, listProps: 'native', compositeTypes: 'unsupported',
  enums: 'unsupported', openTypes: 'unsupported', valueConstraints: 'unsupported',
  namedConstraints: 'unsupported', rawPassthrough: false, cardinality: 'unsupported',
}

module.exports = function (api) {
  api.registerTarget('hello', {
    capabilities: CAPABILITIES,
    emit(model) {
      return {
        target: 'hello', extension: 'txt',
        content: model.nodes.map((n) => n.name).join('\n') + '\n',
        diagnostics: model.enums.map((e) => ({
          severity: 'warning', code: 'downgrade-enum', target: 'hello',
          message: `Enum '${e.name}' has no place in a list of names.`,
        })),
      }
    },
  })
  api.registerImporter('names', {
    extensions: ['.names'],
    importer(inputs) {
      const nodes = inputs.flatMap((i) => i.text.split('\n').map((l) => l.trim()).filter(Boolean))
        .map((name) => ({
          id: `n_${name}`, name, qname: name, iri: name, prefix: '', abstract: false, open: false,
          ancestors: [], mixins: [], key: ['id'], constraints: [],
          props: [{ id: `p_${name}`, name: 'id', type: 'string', list: false, required: true, unique: false }],
        }))
      return {
        model: { file: '', namespace: { prefix: 'names', iri: 'https://example.org/names#' }, prefixes: {}, nodes, edges: [], mixins: [], enums: [] },
        diagnostics: [],
      }
    },
  })
}
