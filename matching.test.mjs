import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES,checkCompatibility,normalizedTags } from '../src/matching.js';
const mk=(category,tags=['sample'],extra={})=>({category,product_tags:tags,space_units:1,...extra});
test('all 13 categories block their own category',()=>{
  assert.equal(CATEGORIES.length,13);
  for(const [id] of CATEGORIES)assert.equal(checkCompatibility(mk(id),mk(id)).state,'blocked');
});
test('product overlap blocks otherwise complementary pairs',()=>{
  assert.equal(checkCompatibility(mk('beverage',['iced latte']),mk('food',['cookies','iced latte'])).state,'blocked');
});
test('coffee and pastries are complementary, subject to admin review',()=>{
  assert.equal(checkCompatibility(mk('beverage',['coffee']),mk('food',['croissant'])).state,'compatible');
});
test('different categories outside allowlist require manual review',()=>{
  assert.equal(checkCompatibility(mk('tech',['cases']),mk('pets',['treats'])).state,'review');
});
test('two oversized setups cannot share',()=>{
  assert.equal(checkCompatibility(mk('fashion',['clothing'],{space_units:2}),mk('jewelry',['earrings'])).state,'blocked');
});
test('users cannot match with own account',()=>{
  assert.equal(checkCompatibility(mk('beverage',['coffee'],{user_id:'A'}),mk('food',['bread'],{user_id:'A'})).state,'blocked');
});
test('tags are normalized and duplicate tags eliminated',()=>{
  assert.deepEqual(normalizedTags([' Coffee ','coffee','COLD BREW']),['coffee','cold brew']);
});
