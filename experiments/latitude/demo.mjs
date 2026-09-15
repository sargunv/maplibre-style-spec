import {Map, NavigationControl, ScaleControl, setWorkerUrl} from './assets/maplibre-gl.mjs';

setWorkerUrl(new URL('./assets/maplibre-gl-worker.mjs', import.meta.url).href);
const places = {
  helsinki: [24.941, 60.170], tromso: [18.956, 69.650],
  paris: [2.349, 48.858], singapore: [103.851, 1.290], sydney: [151.209, -33.869]
};
const circumference = 2 * Math.PI * 6371008.8;
const latitudeRadians = ['*', ['max', -85.05112878, ['min', 85.05112878, ['latitude']]], ['/', ['pi'], 180]];
const correction = ['/', Math.cos(Math.PI / 4), ['cos', latitudeRadians]];
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

/** A top-level zoom curve, with latitude evaluated by the renderer at each stop. */
function groundWidth(meters) {
  const w0 = ['/', meters * 512 / circumference, ['cos', latitudeRadians]];
  return ['interpolate', ['exponential', 2], ['zoom'], 0, w0, 24, ['*', 2 ** 24, w0]];
}

/** Scales stop outputs while retaining the original camera curve and its zoom restrictions. */
function correctedWidth(value) {
  if (Array.isArray(value) && value[0] === 'interpolate') {
    return value.map((part, index) => index >= 4 && index % 2 === 0 ? ['*', part, correction] : part);
  }
  if (Array.isArray(value) && value[0] === 'step') {
    return value.map((part, index) => index >= 2 && index % 2 === 0 ? ['*', part, correction] : part);
  }
  return ['*', value, correction];
}

function enhanceStyle(style, sizing) {
  const result = structuredClone(style);
  for (const layer of result.layers) {
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
  const metersPerPixel = circumference * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
  document.querySelector('#camera').textContent = `${Math.abs(latitude).toFixed(3)}° ${latitude < 0 ? 'S' : 'N'}  ·  zoom ${zoom.toFixed(2)}  ·  ${(1 / Math.cos(latitude * Math.PI / 180)).toFixed(2)}× equator scale`;
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
  document.querySelector('#mode-caption').textContent = mode.value === 'ground' ? 'Road widths in ground meters' : 'Bright zoom curves · calibrated at 45°';
  document.querySelector('#explanation').textContent = mode.value === 'ground'
    ? 'Ground widths are estimates by road class: a local street is 7 m wide. Road casings, bridges, tunnels and paths scale together. These are styling choices, not surveyed road widths.'
    : 'Latitude correction keeps Bright’s original zoom curves. Widths match the standard style at 45° latitude and scale by cos(45°) / cos(latitude). This isolates latitude; it does not keep ground width constant while zooming.';
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
  document.querySelector('#place').addEventListener('change', event => standard.jumpTo({center: places[event.target.value]}));
  mode.addEventListener('change', setMode);
  document.querySelector('#reset').addEventListener('click', () => standard.jumpTo({center: places[document.querySelector('#place').value], zoom: 16, bearing: 0, pitch: 0}));
  document.querySelector('#expression').textContent = JSON.stringify(groundWidth(7), null, 2);
  updateReadout();
  window.latitudeDemo = {standard, enhanced, errors, groundWidth, correctedWidth, enhanceStyle, get baseStyle() {return baseStyle;}, get enhancedStyle() {return enhancedStyle;}};
} catch (error) { reportError(error); }
