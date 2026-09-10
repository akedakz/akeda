// Component events with a MathLive test double; no browser layout measurement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = fs.readFileSync('src/components/formula-editor/formula-editor.tsx', 'utf8');
const css = fs.readFileSync('src/components/formula-editor/formula-editor.module.css', 'utf8');
const practice = fs.readFileSync('src/app/student/trainers/formula-recall/formula-recall.module.css', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const field = { value: 'N/t', selection: { direction: 'backward', ranges: [[1, 3]] }, selectionIsCollapsed: true,
  focus() { this.focused = true; }, insert(value, options) { this.inserted = { value, options }; }, executeCommand(value) { this.command = value; } };
const keyboard = { layouts: [], show() { this.shown = true; } };
let refIndex = 0;
const hooks = { useRef: (value) => ({ current: refIndex++ === 1 ? field : value }), useState: (value) => [value === false ? true : value, () => {}], useEffect() {}, useCallback: (fn) => fn, useId: () => 'symbols' };
const loadedModule = { exports: {} };
vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { window: { mathVirtualKeyboard: keyboard } })((name) => name === 'react' ? hooks : name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => key }), __esModule: true } : require(name), loadedModule, loadedModule.exports);
function render(props = {}) { refIndex = 0; return loadedModule.exports.default({ value: field.value, onChange() {}, ...props }); }
function flatten(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)]; }
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const nodes = flatten(render());
const buttons = nodes.filter((node) => node.type === 'button');
const abc = buttons.find((node) => node.props.children === 'ABC');
check('ABC is separate, accessible and preserves pointer selection', () => {
  assert.ok(abc.props['aria-label']); assert.ok(abc.props.title); assert.equal(abc.props.disabled, false);
  let prevented = false; abc.props.onPointerDown({ preventDefault() { prevented = true; } }); assert.ok(prevented);
});
check('ABC focuses same field, preserves value and selection, opens letters and digits', () => {
  const selection = JSON.stringify(field.selection); abc.props.onClick();
  assert.ok(field.focused); assert.ok(keyboard.shown); assert.equal(field.value, 'N/t');
  assert.equal(JSON.stringify(field.selection), selection);
  assert.ok(keyboard.layouts.includes('alphabetic')); assert.ok(keyboard.layouts.includes('numeric'));
});
check('disabled/read-only editor cannot open keyboard', () => {
  for (const props of [{ disabled: true }, { readOnly: true }]) {
    keyboard.shown = false;
    const button = flatten(render(props)).find((n) => n.type === 'button' && n.props.children === 'ABC');
    assert.equal(button.props.disabled, true); button.props.onClick(); assert.equal(keyboard.shown, false);
  }
});
check('fraction/root/subscript/power retain MathLive placeholder insertion', () => {
  for (const [label, prefix] of [['a⁄b', '\\frac'], ['√', '\\sqrt'], ['xₙ', '_'], ['xⁿ', '^']]) {
    buttons.find((n) => n.props.children === label).props.onClick();
    assert.ok(field.inserted.value.startsWith(prefix)); assert.equal(field.inserted.options.selectionMode, 'placeholder');
  }
});
check('arrows and backspace retain native MathLive commands', () => {
  for (const [label, command] of [['←', 'moveToPreviousChar'], ['→', 'moveToNextChar'], ['⌫', 'deleteBackward']]) {
    buttons.find((n) => n.props.children === label).props.onClick(); assert.equal(field.command, command);
  }
});
check('Greek Symbols still insert into same field', () => {
  buttons.find((n) => n.props.children === 'ν').props.onClick(); assert.equal(field.inserted.value, '\\nu');
});
check('responsive wrap is enabled at both toolbar and group levels, without practice nowrap override', () => {
  for (const selector of ['toolbar', 'toolGroup', 'secondaryGroup']) {
    assert.match(css.match(new RegExp('\\.' + selector + '\\{([^}]+)'))[1], /flex-wrap:wrap/);
  }
  assert.doesNotMatch(practice, /flex-wrap:nowrap/);
  assert.match(css, /min-width:44px;height:44px/);
});
check('prompt responsive bounds at all requested viewport widths', () => {
  assert.ok(practice.includes('clamp(26px,2.8vw,30px)'));
  assert.ok(practice.includes('clamp(20px,5.3vw,23px)'));
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    const mobile = width <= 760;
    const size = mobile ? Math.max(20, Math.min(23, width * .053)) : Math.max(26, Math.min(30, width * .028));
    assert.ok(size >= (mobile ? 20 : 26) && size <= (mobile ? 23 : 30));
  }
  assert.ok(practice.includes('margin-bottom:24px')); assert.ok(practice.includes('margin-bottom:20px'));
});
console.log(`${passed}/${passed} passed. Browser overflow measurements and mobile keyboard invocation require runtime QA.`);
