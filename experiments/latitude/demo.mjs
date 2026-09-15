import {Map, NavigationControl, ScaleControl, setWorkerUrl} from './assets/maplibre-gl.mjs';

setWorkerUrl(new URL('./assets/maplibre-gl-worker.mjs', import.meta.url).href);
const places = {
  helsinki: [24.941, 60.170], tromso: [18.956, 69.650],
  paris: [2.349, 48.858], singapore: [103.851, 1.290], sydney: [151.209, -33.869]
};
const circumference = 2 * Math.PI * 6371008.8;
const referenceScaleAtZero = circumference * Math.cos(Math.PI / 4) / 512;
const initialScale = groundScale(16, places.helsinki[1]);
const scaleZoom = ['log2', ['/', referenceScaleAtZero, ['scale']]];
const errors = [];
let standard, enhanced, baseStyle, enhancedStyle, synchronizing = false;
const mode = document.querySelector('#mode');

/** Assumed carriageway widths; OFM's road classes are not surveyed width measurements. */
function roadMeters(id) {
  if (/path|pedestrian|steps/.test(id)) return 2;
  if (/track/.test(id)) return 3;
  if (/service/.test(id)) return 5;
  if (/link/.test(id)) return 7;
  if (/motorway/.test(id)) return 22;
  if (/trunk|primary/.test(id)) return 16;
  if (/secondary|tertiary/.test(id)) return 12;
  return 7;
}

/** Nominal ground resolution for a flat Mercator map, in meters per CSS pixel. */
function groundScale(zoom, latitude) {
  return circumference * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
}

function zoomForScale(scale, latitude) {
  return Math.log2(circumference * Math.cos(latitude * Math.PI / 180) / (512 * scale));
}

/** Physical width using the experimental scale input directly. */
function groundWidth(meters) {
  return ['/', meters, ['scale']];
}

/** Evaluates Bright's original curve at its equivalent zoom at the 45° reference latitude. */
function correctedWidth(value) {
  if (!Array.isArray(value)) return value;
  if (value[0] === 'zoom') return scaleZoom;
  if (value[0] === 'literal') return value;
  return value.map(part => Array.isArray(part) ? correctedWidth(part) : part);
}

function changeCity(center, scale = groundScale(standard.getZoom(), standard.getCenter().lat)) {
  standard.jumpTo({center, zoom: zoomForScale(scale, center[1])});
}

function enhanceStyle(style, sizing) {
  const result = structuredClone(style);
  for (const layer of result.layers) {
    if (sizing === 'all') {
      for (const section of ['paint', 'layout']) {
        for (const [property, value] of Object.entries(layer[section] || {})) {
          layer[section][property] = correctedWidth(value);
        }
      }
      continue;
    }
    if (layer.type !== 'line' || layer['source-layer'] !== 'transportation' ||
        !/^(highway|bridge|tunnel)-/.test(layer.id) || /railway/.test(layer.id)) continue;
    const meters = roadMeters(layer.id) + (layer.id.endsWith('-casing') ? 2 : 0);
    for (const property of ['line-width', 'line-gap-width', 'line-offset']) {
      if (layer.paint?.[property] === undefined) continue;
      layer.paint[property] = sizing === 'ground' && property === 'line-width'
        ? groundWidth(meters) : correctedWidth(layer.paint[property]);
    }
  }
  return result;
}

/** Evaluates only the numeric operators in the displayed road-width readout. */
function evaluate(expression, zoom, latitude) {
  if (typeof expression === 'number') return expression;
  const [op, ...args] = expression;
  const ev = value => evaluate(value, zoom, latitude);
  if (op === 'zoom') return zoom;
  if (op === 'latitude') return latitude;
  if (op === 'scale') return groundScale(zoom, latitude);
  if (op === 'log2') return Math.log2(ev(args[0]));
  if (op === 'pi') return Math.PI;
  if (op === '*') return args.map(ev).reduce((a, b) => a * b, 1);
  if (op === '/') return ev(args[0]) / ev(args[1]);
  if (op === 'cos') return Math.cos(ev(args[0]));
  if (op === 'max') return Math.max(...args.map(ev));
  if (op === 'min') return Math.min(...args.map(ev));
  if (op === 'interpolate') {
    const [method, input, ...stops] = args;
    const x = ev(input);
    if (x <= stops[0]) return ev(stops[1]);
    for (let i = 2; i < stops.length; i += 2) {
      if (x > stops[i]) continue;
      const progress = x - stops[i - 2], span = stops[i] - stops[i - 2];
      const base = method[0] === 'exponential' ? method[1] : 1;
      const t = base === 1 ? progress / span : (base ** progress - 1) / (base ** span - 1);
      return ev(stops[i - 1]) * (1 - t) + ev(stops[i + 1]) * t;
    }
    return ev(stops.at(-1));
  }
  throw new Error(`Unsupported readout operator: ${op}`);
}

function updateReadout() {
  if (!standard || !baseStyle || !enhancedStyle) return;
  const latitude = standard.getCenter().lat, zoom = standard.getZoom();
  const metersPerPixel = groundScale(zoom, latitude);
  document.querySelector('#camera').textContent = `${Math.abs(latitude).toFixed(3)}° ${latitude < 0 ? 'S' : 'N'}  ·  zoom ${zoom.toFixed(2)}  ·  ${metersPerPixel.toFixed(3)} m/px`;
  for (const [id, style] of [['standard', baseStyle], ['enhanced', enhancedStyle]]) {
    const width = style.layers.find(layer => layer.id === 'highway-minor').paint['line-width'];
    const px = evaluate(width, zoom, latitude);
    document.querySelector(`#${id}-width`).textContent = `${px.toFixed(1)} px ≈ ${(px * metersPerPixel).toFixed(1)} m`;
  }
}

function synchronize(from, to) {
  if (synchronizing) return;
  synchronizing = true;
  try {
    to.jumpTo({center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch()});
    updateReadout();
  } finally { synchronizing = false; }
}

function reportError(error) {
  const message = error?.message || String(error);
  errors.push(message);
  const box = document.querySelector('#error');
  box.hidden = false;
  box.textContent = `Map resource failed: ${message}. Reload to retry.`;
}

function setMode() {
  enhancedStyle = enhanceStyle(baseStyle, mode.value);
  enhanced.setStyle(enhancedStyle);
  document.querySelector('#mode-caption').textContent = mode.value === 'ground' ? 'Road widths in ground meters' : mode.value === 'all' ? 'All Bright expressions use ground scale' : 'Bright width curves use ground scale';
  document.querySelector('#explanation').textContent = mode.value === 'ground'
    ? 'Ground widths are estimates by road class: a local street is 7 m wide. Road casings, bridges, tunnels and paths scale together. These are styling choices, not surveyed road widths.'
    : mode.value === 'all'
      ? 'All zoom-based paint and layout expressions use ground scale at a 45° reference: labels, icons, colors, opacity and widths. Layer visibility ranges and source tiles still use zoom; features missing from a tile cannot be restored by styling. Layout changes rebuild tiles and may lag while moving.'
      : 'Bright’s width curves use ground scale, calibrated to the original style at 45°. At the same meters per pixel, widths stay the same across cities. Labels, visibility and opacity still follow Bright’s original zoom rules.';
  document.querySelector('#expression').textContent = JSON.stringify(enhancedStyle.layers.find(layer => layer.id === 'highway-minor').paint['line-width'], null, 2);
  updateReadout();
}

try {
  const response = await fetch('./bright.json');
  if (!response.ok) throw new Error(`Bright style: HTTP ${response.status}`);
  baseStyle = await response.json();
  enhancedStyle = enhanceStyle(baseStyle, mode.value);
  const options = {center: places.helsinki, zoom: 16, minZoom: 0, maxZoom: 24, pitch: 0, maxPitch: 60, fadeDuration: 0, attributionControl: true};
  standard = new Map({...options, container: 'standard', style: structuredClone(baseStyle)});
  enhanced = new Map({...options, container: 'enhanced', style: enhancedStyle});
  for (const map of [standard, enhanced]) {
    map.addControl(new NavigationControl(), 'top-right');
    map.addControl(new ScaleControl({unit: 'metric'}), 'bottom-left');
    map.on('error', event => reportError(event.error));
  }
  standard.on('move', () => synchronize(standard, enhanced));
  enhanced.on('move', () => synchronize(enhanced, standard));
  document.querySelector('#place').addEventListener('change', event => changeCity(places[event.target.value]));
  mode.addEventListener('change', setMode);
  document.querySelector('#reset').addEventListener('click', () => { changeCity(places[document.querySelector('#place').value], initialScale); standard.jumpTo({bearing: 0, pitch: 0}); });
  document.querySelector('#expression').textContent = JSON.stringify(groundWidth(7), null, 2);
  updateReadout();
  window.latitudeDemo = {standard, enhanced, errors, groundWidth, correctedWidth, enhanceStyle, groundScale, zoomForScale, get baseStyle() {return baseStyle;}, get enhancedStyle() {return enhancedStyle;}};
} catch (error) { reportError(error); }
