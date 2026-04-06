/**
 * GitHub UI/UX Enhancer - Manifest Tests
 *
 * Verifies manifest.json is valid and contains required fields.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const manifestRaw = fs.readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf-8');
let manifest;

describe('manifest.json', () => {
  test('TC-MF-01: is valid JSON', () => {
    expect(() => { manifest = JSON.parse(manifestRaw); }).not.toThrow();
  });

  test('TC-MF-02: uses Manifest V3', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.manifest_version).toBe(3);
  });

  test('TC-MF-03: has name, version, and description', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.name).toBe('GitHub UI/UX Enhancer');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBeTruthy();
  });

  test('TC-MF-04: declares required permissions', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('notifications');
    expect(manifest.permissions).toContain('alarms');
    expect(manifest.permissions).toContain('clipboardWrite');
  });

  test('TC-MF-05: has host_permissions for github.com and api.github.com', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.host_permissions).toContain('https://github.com/*');
    expect(manifest.host_permissions).toContain('https://api.github.com/*');
  });

  test('TC-MF-06: content_scripts targets github.com', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.content_scripts).toBeDefined();
    expect(manifest.content_scripts[0].matches).toContain('https://github.com/*');
  });

  test('TC-MF-07: content_scripts includes content.js and styles.css', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.content_scripts[0].js).toContain('content.js');
    expect(manifest.content_scripts[0].css).toContain('styles.css');
  });

  test('TC-MF-08: background service_worker points to background.js', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.background.service_worker).toBe('background.js');
  });

  test('TC-MF-09: action has default_popup pointing to popup.html', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  test('TC-MF-10: icon files are referenced', () => {
    manifest = JSON.parse(manifestRaw);
    expect(manifest.action.default_icon['16']).toBe('icons/icon16.png');
    expect(manifest.action.default_icon['48']).toBe('icons/icon48.png');
    expect(manifest.action.default_icon['128']).toBe('icons/icon128.png');
  });

  test('TC-MF-11: all referenced files exist on disk', () => {
    manifest = JSON.parse(manifestRaw);
    const root = path.resolve(__dirname, '..');
    const files = [
      manifest.content_scripts[0].js[0],
      manifest.content_scripts[0].css[0],
      manifest.background.service_worker,
      manifest.action.default_popup,
      manifest.action.default_icon['16'],
      manifest.action.default_icon['48'],
      manifest.action.default_icon['128'],
    ];
    files.forEach(file => {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    });
  });
});
