import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, plural } from '../js/ui.js';

const text = tpl => tpl.__html;

test('html escapes interpolated values', () => {
  assert.equal(text(html`<p>${'<b>"Tom & Jerry\'s"</b>'}</p>`), '<p>&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;</p>');
});

test('html nests templates and arrays without double-escaping; skips null and false', () => {
  const items = ['a<', 'b'].map(x => html`<li>${x}</li>`);
  assert.equal(text(html`<ul>${items}</ul>${null}${false}${undefined}`), '<ul><li>a&lt;</li><li>b</li></ul>');
  assert.equal(text(html`${raw('<hr>')}`), '<hr>');
  assert.equal(text(html`${0}`), '0');
});

test('plural', () => {
  assert.equal(plural(1, 'item'), '1 item');
  assert.equal(plural(0, 'item'), '0 items');
  assert.equal(plural(3, 'dish', 'dishes'), '3 dishes');
});
