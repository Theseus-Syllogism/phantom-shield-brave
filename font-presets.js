// font-presets.js - per-platform stock fonts + generic family set.
// Loaded as a MAIN-world content script (before inject.js) and as a
// service-worker importScripts target.
(function (root) {
  'use strict';

  const FONT_GENERICS = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
    'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
    'ui-rounded', 'math', 'emoji', 'fangsong',
  ]);

  const FONT_BASELINE = {
    Windows: [
      'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math',
      'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
      'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia',
      'HoloLens MDL2 Assets', 'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI',
      'Lucida Console', 'Lucida Sans Unicode', 'MS Gothic', 'MV Boli', 'Malgun Gothic',
      'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue',
      'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le',
      'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
      'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe MDL2 Assets',
      'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji',
      'Segoe UI Historic', 'Segoe UI Symbol', 'SimSun', 'Sitka', 'Sylfaen',
      'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
      'Webdings', 'Wingdings', 'Yu Gothic',
    ],
    macOS: [
      'Apple Color Emoji', 'Apple SD Gothic Neo', 'Apple Symbols', 'AppleGothic',
      'Arial', 'Arial Black', 'Arial Hebrew', 'Arial Narrow', 'Arial Rounded MT Bold',
      'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville',
      'Bodoni 72', 'Bradley Hand', 'Chalkboard SE', 'Chalkduster', 'Charter',
      'Cochin', 'Comic Sans MS', 'Copperplate', 'Courier', 'Courier New',
      'Didot', 'Futura', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica',
      'Helvetica Neue', 'Hiragino Sans', 'Impact', 'Lucida Grande', 'Marker Felt',
      'Menlo', 'Monaco', 'Optima', 'Palatino', 'Papyrus', 'San Francisco',
      'SF Mono', 'SF Pro', 'SF Pro Display', 'Symbol', 'Tahoma',
      'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Zapf Dingbats',
      'Zapfino',
    ],
    iOS: [
      'Apple Color Emoji', 'Apple SD Gothic Neo', 'Arial', 'Arial Hebrew',
      'Avenir', 'Avenir Next', 'Courier', 'Courier New', 'Georgia',
      'Helvetica', 'Helvetica Neue', 'Hiragino Sans', 'Marker Felt', 'Menlo',
      'Optima', 'Palatino', 'San Francisco', 'SF Pro', 'SF Pro Display',
      'SF Mono', 'Symbol', 'Times New Roman', 'Trebuchet MS', 'Verdana',
      'Zapf Dingbats',
    ],
    Android: [
      'Roboto', 'Roboto Condensed', 'Roboto Mono', 'Roboto Slab',
      'Noto Sans', 'Noto Sans CJK', 'Noto Serif', 'Noto Color Emoji',
      'Droid Sans', 'Droid Sans Mono', 'Droid Serif', 'Cutive Mono',
      'Coming Soon', 'Dancing Script', 'Carrois Gothic', 'sans-serif-condensed',
      'sans-serif-light', 'sans-serif-medium', 'sans-serif-thin',
    ],
  };

  root.FONT_BASELINE = FONT_BASELINE;
  root.FONT_GENERICS = FONT_GENERICS;
})(typeof self !== 'undefined' ? self : globalThis);
