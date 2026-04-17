const jscodeshift = require('jscodeshift');
const j = jscodeshift.withParser('tsx');
const source = `vi.mock('../foo');`;
const root = j(source);
root.find(j.CallExpression, { callee: { type: 'MemberExpression' } }).forEach((p) => {
    console.log(p.node.callee.object.type);
    console.log(p.node.callee.object.name);
    console.log(p.node.callee.property.type);
    console.log(p.node.callee.property.name);
});
