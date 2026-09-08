import test from 'node:test';
import assert from 'node:assert/strict';
import { disableRocketLoader } from '../scripts/disable-rocket-loader.mjs';

test('export opts framework and inline scripts out of Rocket Loader without changing their contents', () => {
  const html = '<script src="/chunk.js" async=""></script><script>self.__next_f.push([0])</script><script data-cfasync="false">keep()</script>';
  const result = disableRocketLoader(html);
  assert.equal(result, '<script data-cfasync="false" src="/chunk.js" async=""></script><script data-cfasync="false">self.__next_f.push([0])</script><script data-cfasync="false">keep()</script>');
  assert.equal(disableRocketLoader(result), result);
});
