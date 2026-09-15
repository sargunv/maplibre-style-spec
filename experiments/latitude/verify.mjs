import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const rendererRoot = process.argv[2];
if (!rendererRoot) throw new Error('Usage: node demos/latitude/verify.mjs /path/to/maplibre-gl-js [demo-url]');
const require = createRequire(resolve(rendererRoot, 'package.json'));
const puppeteer = require('puppeteer');
const {PNG} = require('pngjs');
const url = process.argv[3] || 'http://127.0.0.1:8765/demos/latitude/';
const output = resolve('demos/latitude/test-results');
await mkdir(output, {recursive: true});
const browser = await puppeteer.launch({headless: true, executablePath: process.env.CHROME_BIN || undefined});
const results = {url, browser: await browser.version(), checks: [], pixelWidths: []};
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1440, height: 1000, deviceScaleFactor: 1});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.latitudeDemo?.standard.loaded() && window.latitudeDemo?.enhanced.loaded(), {timeout: 60000});
  assert.deepEqual(await page.evaluate(() => latitudeDemo.errors), []);
  await page.screenshot({path: `${output}/desktop.png`, fullPage: true});
  await page.select('#mode', 'scale');
  const before = await page.evaluate(() => ({scale: latitudeDemo.groundScale(latitudeDemo.standard.getZoom(), latitudeDemo.standard.getCenter().lat), width: document.querySelector('#enhanced-width').textContent}));
  await page.select('#place', 'singapore');
  await page.waitForFunction(() => latitudeDemo.enhanced.loaded(), {timeout: 60000});
  assert(await page.evaluate(() => {
    const {standard:a, enhanced:b} = latitudeDemo;
    return a.getZoom() > 16 && a.getCenter().lat === b.getCenter().lat && a.getCenter().lng === b.getCenter().lng;
  }));
  const after = await page.evaluate(() => ({scale: latitudeDemo.groundScale(latitudeDemo.standard.getZoom(), latitudeDemo.standard.getCenter().lat), width: document.querySelector('#enhanced-width').textContent}));
  assert(Math.abs(before.scale - after.scale) < 1e-10);
  assert.equal(before.width, after.width);
  results.checks.push('City changes preserve meters per pixel and Bright scale-based street widths while adjusting zoom.');
  await page.evaluate(() => latitudeDemo.enhanced.jumpTo({center: [2.349, 48.858], zoom: 16.5, bearing: 20, pitch: 30}));
  assert(await page.evaluate(() => {
    const {standard:a, enhanced:b} = latitudeDemo;
    return a.getZoom() === b.getZoom() && a.getPitch() === b.getPitch() && a.getBearing() === b.getBearing() && a.getCenter().lat === b.getCenter().lat;
  }));
  results.checks.push('Camera sync works in both directions, including zoom, bearing and pitch.');
  await page.select('#mode', 'all');
  await page.waitForFunction(() => latitudeDemo.enhanced.loaded(), {timeout: 60000});
  const conversion = await page.evaluate(() => {
    const {baseStyle, enhancedStyle} = latitudeDemo;
    let converted = 0;
    for (let i = 0; i < baseStyle.layers.length; i++) {
      const original = baseStyle.layers[i], changed = enhancedStyle.layers[i];
      for (const field of ['minzoom', 'maxzoom', 'filter']) {
        if (JSON.stringify(original[field]) !== JSON.stringify(changed[field])) throw new Error(`Changed ${field}: ${original.id}`);
      }
      for (const section of ['paint', 'layout']) {
        for (const [property, value] of Object.entries(original[section] || {})) {
          const input = JSON.stringify(value), output = JSON.stringify(changed[section][property]);
          if (input.includes('["zoom"]')) {
            if (output.includes('["zoom"]') || !output.includes('["scale"]')) throw new Error(`Unconverted ${original.id}.${property}`);
            converted++;
          } else if (input !== output) throw new Error(`Changed constant ${original.id}.${property}`);
        }
      }
    }
    return converted;
  });
  assert(conversion > 100, `Expected broad paint/layout conversion, got ${conversion}`);
  await page.select('#place', 'tromso');
  await page.waitForFunction(() => latitudeDemo.enhanced.loaded(), {timeout: 60000});
  assert.deepEqual(await page.evaluate(() => latitudeDemo.errors), []);
  await page.screenshot({path: `${output}/all-expressions.png`, fullPage: true});
  results.checks.push(`All-expressions mode loads after city changes; ${conversion} zoom-based properties converted, constants and visibility gates preserved.`);
  await page.select('#mode', 'ground');
  await page.select('#place', 'helsinki');
  await page.click('#reset');
  await page.waitForFunction(() => latitudeDemo.standard.loaded() && latitudeDemo.enhanced.loaded(), {timeout: 60000});
  assert.equal(await page.evaluate(() => JSON.stringify(latitudeDemo.standard.getStyle().layers) === JSON.stringify(latitudeDemo.baseStyle.layers)), true);
  results.checks.push('Standard Bright layers remain unchanged.');
  await page.setViewport({width: 390, height: 844, deviceScaleFactor: 1});
  await page.waitForFunction(() => document.querySelector('#standard').clientWidth === 390);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: `${output}/mobile.png`, fullPage: true});
  results.checks.push('Mobile layout has no horizontal overflow.');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(await page.evaluate(() => latitudeDemo.errors), []);

  const probe = await browser.newPage();
  await probe.setViewport({width: 512, height: 256, deviceScaleFactor: 1});
  await probe.goto(new URL('./bright.json', url).href);
  await probe.evaluate(async (bundleUrl) => {
    const {Map, setWorkerUrl} = await import(bundleUrl);
    setWorkerUrl(new URL('./maplibre-gl-worker.mjs', bundleUrl).href);
    document.body.innerHTML = '<div id="probe" style="position:fixed;inset:0"></div>';
    window.probeErrors = [];
    window.probeMap = new Map({container:'probe', center:[0,0], zoom:6, fadeDuration:0,
      canvasContextAttributes:{preserveDrawingBuffer:true},
      style:{version:8,sources:{roads:{type:'geojson',data:{type:'FeatureCollection',features:[0,60,-60].map((latitude,id)=>({type:'Feature',id,properties:{width:10},geometry:{type:'LineString',coordinates:[[-2,latitude],[2,latitude]]}}))}}},
        layers:[{id:'background',type:'background',paint:{'background-color':'white'}},
          {id:'road',type:'line',source:'roads',paint:{'line-color':'#145dc0','line-width':['/',10,['cos',['*',['latitude'],['/', ['pi'],180]]]]}}]}});
    probeMap.on('error', event=>probeErrors.push(event.error.message));
  }, new URL('./assets/maplibre-gl.mjs', url).href);

  async function widthAt(latitude) {
    await probe.evaluate(latitude => probeMap.jumpTo({center:[0,latitude]}), latitude);
    await probe.waitForFunction(() => probeMap.loaded(), {timeout: 30000});
    await probe.evaluate(() => new Promise(resolve => {probeMap.once('render',resolve);probeMap.triggerRepaint();}));
    const dataUrl = await probe.evaluate(() => probeMap.getCanvas().toDataURL());
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
    let width = 0;
    for (let y = 0; y < png.height; y++) {
      const offset = (y * png.width + Math.floor(png.width / 2)) * 4;
      if (png.data[offset + 2] > png.data[offset] + 60) width++;
    }
    return width;
  }
  for (const [latitude, expected] of [[0,10],[60,20],[-60,20],[0,10]]) {
    const width = await widthAt(latitude);
    assert(Math.abs(width - expected) <= 1, `camera width at ${latitude}: ${width}, expected ${expected}`);
    results.pixelWidths.push({path:'camera paint',latitude,width,expected});
  }
  await probe.evaluate(() => probeMap.setPaintProperty('road','line-width',
    ['/', ['+', ['get','width'], ['coalesce',['feature-state','extra'],0]], ['cos',['*',['latitude'],['/', ['pi'],180]]]]));
  for (const [latitude, expected] of [[0,10],[60,20],[-60,20],[0,10]]) {
    const width = await widthAt(latitude);
    assert(Math.abs(width - expected) <= 1, `feature width at ${latitude}: ${width}, expected ${expected}`);
    results.pixelWidths.push({path:'feature paint',latitude,width,expected});
  }
  await widthAt(60);
  await probe.evaluate(() => probeMap.setFeatureState({source:'roads',id:1},{extra:4}));
  const stateWidth = await widthAt(60);
  assert(Math.abs(stateWidth - 28) <= 1, `feature state width: ${stateWidth}`);
  results.pixelWidths.push({path:'feature state',latitude:60,width:stateWidth,expected:28});
  await probe.evaluate(() => probeMap.setPaintProperty('road','line-width',
    ['/', ['*', ['get','width'], 2 * Math.PI * 6371008.8 / (512 * 2 ** 6)], ['scale']]));
  for (const [latitude, zoom] of [[0,6],[60,5],[-60,5],[0,6]]) {
    await probe.evaluate(zoom => probeMap.jumpTo({zoom}), zoom);
    const width = await widthAt(latitude);
    assert(Math.abs(width - 10) <= 1, `scale width at ${latitude}, zoom ${zoom}: ${width}`);
    results.pixelWidths.push({path:'scale feature paint',latitude,zoom,width,expected:10});
  }
  results.checks.push('Rendered feature widths remain equal at equal ground scale across latitude and zoom changes.');
  await probe.evaluate(() => {
    probeMap.removeLayer('road');
    probeMap.removeSource('roads');
    const data = new Uint8Array(10 * 10 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([20, 93, 192, 255], i);
    probeMap.addImage('square', {width:10, height:10, data});
    probeMap.addSource('points', {type:'geojson', data:{type:'FeatureCollection', features:[0,60,-60].map(latitude =>
      ({type:'Feature', properties:{}, geometry:{type:'Point', coordinates:[0,latitude]}}))}});
    probeMap.addLayer({id:'symbol',type:'symbol',source:'points',layout:{'icon-image':'square', 'icon-allow-overlap':true,
      'icon-size':['/',1,['cos',['*',['latitude'],['/', ['pi'],180]]]]}});
  });
  for (const [latitude, expected] of [[0,10],[60,20],[-60,20],[0,10]]) {
    const width = await widthAt(latitude);
    assert(Math.abs(width - expected) <= 1, `layout icon size at ${latitude}: ${width}, expected ${expected}`);
    results.pixelWidths.push({path:'symbol layout',latitude,width,expected});
  }
  results.checks.push('Latitude-dependent symbol layout rebuilds correctly at fixed zoom.');
  await probe.evaluate(() => probeMap.setLayoutProperty('symbol', 'icon-size',
    ['/', 2 * Math.PI * 6371008.8 / (512 * 2 ** 6), ['scale']]));
  for (const [latitude, zoom] of [[0,6],[60,5],[-60,5],[0,6]]) {
    await probe.evaluate(zoom => probeMap.jumpTo({zoom}), zoom);
    const width = await widthAt(latitude);
    assert(Math.abs(width - 10) <= 1, `scale layout size at ${latitude}: ${width}`);
    results.pixelWidths.push({path:'scale symbol layout',latitude,zoom,width,expected:10});
  }
  results.checks.push('Scale-dependent symbol layout stays equal at equal ground scale across latitude and zoom changes.');

  assert.deepEqual(await probe.evaluate(() => probeErrors), []);
  results.checks.push('Rendered pixel widths double from the equator to ±60° at fixed zoom, including feature paint, return to cached tiles, and feature-state updates.');
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)+'\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
