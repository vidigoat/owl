/**
 * The two readings GE's sitemap is trusted for: which token of a product URL is the model number,
 * and what kind of machine the URL says it is. Everything else in scripts/source-ge.js is fetching.
 *
 *   node scripts/source-ge.test.js
 */
const assert = require('node:assert');
const { modelOf, kindOf } = require('./source-ge');

let passed = 0;
const it = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; } };

console.log('GE sourcing');

it('the model number is the last token of a product URL, and only if it looks like one', () => {
  assert.equal(modelOf('https://www.geappliances.com/appliance/GE-ENERGY-STAR-Top-Control-Dishwasher-with-Sanitize-Cycle-GDT670SYVFS'), 'GDT670SYVFS');
  assert.equal(modelOf('https://www.geappliances.com/appliance/GE-Top-Load-Washer-GTW330ASKWW/'), 'GTW330ASKWW');
  // A page that ends in a word, a short token, or digits alone is not a machine.
  assert.equal(modelOf('https://www.geappliances.com/ge-appliances/kitchen/dishwashers'), null);
  assert.equal(modelOf('https://www.geappliances.com/appliance/Something-2024'), null);
  assert.equal(modelOf('https://www.geappliances.com/appliance/Water-Filter-XWF'), null);
});

it('the kind is read from the URL\'s own words, and a product that is none of them is left alone', () => {
  assert.equal(kindOf('GE-7-4-cu-ft-Capacity-Electric-Dryer-GTD42EASJWW')[0], 'dryers');
  assert.equal(kindOf('GE-Top-Load-Washer-GTW330ASKWW')[0], 'washers');
  assert.equal(kindOf('GE-Dishwasher-with-Front-Controls-GDF645SSNSS')[0], 'dishwashers');
  assert.equal(kindOf('GE-Side-By-Side-Refrigerator-GSHS3KGXSS')[0], 'refrigerators');
  assert.equal(kindOf('GE-Garbage-Disposer-GFC520N'), null);
});

console.log(`\n${passed} passed`);
