import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('앱으로 설치 스크립트(/install.js)는 소개 사이트에서만 부른다 (로컬에선 404)', () => {
  assert.ok(!/<script[^>]*src="\/install\.js"/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), '그냥 부르는 태그가 없음');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('install.js'));
  assert.ok(inline, '조건부로 부르는 스크립트');
  const run = (hostname) => {
    const written = [];
    vm.runInNewContext(inline, { location: { hostname }, document: { write: (s) => written.push(s) } });
    return written.join('');
  };
  assert.match(run('yh-yeop.github.io'), /<script src="\/install\.js"><\/script>/);
  assert.equal(run('127.0.0.1'), '');
  assert.equal(run('localhost'), '');
});
