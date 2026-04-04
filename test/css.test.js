/**
 * GitHub Enhancer - CSS Tests
 *
 * Verifies that styles.css contains the expected CSS rules for all features.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf-8');

describe('styles.css', () => {
  // ─── Feature 1: Dropdown width rules ────────────────────────────────

  test('TC-CSS-01: contains branch-select-menu dropdown width rule with 1.7 multiplier', () => {
    expect(css).toMatch(/1\.7/);
  });

  test('TC-CSS-02: sets max-width 600px for dropdown modals', () => {
    expect(css).toMatch(/max-width:\s*600px/);
  });

  // ─── Feature 2: Branch name full display ────────────────────────────

  test('TC-CSS-03: gh-enhancer-branch-name removes overflow hidden', () => {
    expect(css).toMatch(/\.gh-enhancer-branch-name[\s\S]*?overflow:\s*visible\s*!important/);
  });

  test('TC-CSS-04: gh-enhancer-branch-name removes text-overflow ellipsis', () => {
    expect(css).toMatch(/\.gh-enhancer-branch-name[\s\S]*?text-overflow:\s*unset\s*!important/);
  });

  test('TC-CSS-05: gh-enhancer-branch-name removes max-width', () => {
    expect(css).toMatch(/\.gh-enhancer-branch-name[\s\S]*?max-width:\s*none\s*!important/);
  });

  test('TC-CSS-06: gh-enhancer-branch-name sets white-space nowrap', () => {
    expect(css).toMatch(/\.gh-enhancer-branch-name[\s\S]*?white-space:\s*nowrap\s*!important/);
  });

  // ─── Feature 3: Copy button styles ──────────────────────────────────

  test('TC-CSS-07: gh-enhancer-copy-btn is defined', () => {
    expect(css).toContain('.gh-enhancer-copy-btn');
  });

  test('TC-CSS-08: copy button has hover state', () => {
    expect(css).toContain('.gh-enhancer-copy-btn:hover');
  });

  test('TC-CSS-09: copy button has .copied state with green color', () => {
    expect(css).toMatch(/\.gh-enhancer-copy-btn\.copied[\s\S]*?color:\s*#1a7f37/);
  });

  // ─── Feature 4: Notify button styles ────────────────────────────────

  test('TC-CSS-10: gh-enhancer-notify-btn is defined', () => {
    expect(css).toContain('.gh-enhancer-notify-btn');
  });

  test('TC-CSS-11: notify button has hover state', () => {
    expect(css).toContain('.gh-enhancer-notify-btn:hover');
  });

  test('TC-CSS-12: notify button has active state with blue color', () => {
    expect(css).toMatch(/\.gh-enhancer-notify-btn\.active[\s\S]*?color:\s*#0969da/);
  });
});
