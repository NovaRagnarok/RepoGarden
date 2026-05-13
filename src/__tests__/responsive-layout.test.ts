import test from "node:test";
import assert from "node:assert/strict";

import { computeOverlayCardSlot, getTerminalLayout } from "../lib/responsive-layout";

test("responsive layout classifies rich terminal sizes", () => {
  assert.equal(getTerminalLayout(144, 40).tier, "rich");
  assert.equal(getTerminalLayout(100, 30).tier, "rich");
});

test("responsive layout does not tie the sidebar to the overlay card height", () => {
  assert.equal(getTerminalLayout(120, 30).showSidebar, true);
  assert.equal(getTerminalLayout(120, 30).showOverlayCard, false);
  assert.equal(getTerminalLayout(144, 40).showSidebar, true);
});

test("responsive layout ties sidebar to the overlay card width", () => {
  assert.equal(getTerminalLayout(119, 60).showSidebar, false);
  assert.equal(getTerminalLayout(120, 60).showSidebar, true);
});

test("responsive layout classifies the supported minimum as compact", () => {
  const layout = getTerminalLayout(80, 24);
  assert.equal(layout.tier, "compact");
  assert.equal(layout.contentWidth, 78);
  assert.equal(layout.contentHeight, 23);
});

test("responsive layout rejects terminals below the supported minimum", () => {
  assert.equal(getTerminalLayout(79, 24).tier, "too-small");
  assert.equal(getTerminalLayout(80, 23).tier, "too-small");
  assert.equal(getTerminalLayout(60, 20).tier, "too-small");
});

test("responsive layout only shows the overlay card on tall wide terminals", () => {
  assert.equal(getTerminalLayout(120, 39).showOverlayCard, false);
  assert.equal(getTerminalLayout(119, 40).showOverlayCard, false);
  assert.equal(getTerminalLayout(120, 40).showOverlayCard, true);
});

test("overlay card slot reserves the same dead zone when hidden", () => {
  const visible = computeOverlayCardSlot({
    canReserve: true,
    cardVisible: true,
    gardenWidth: 100,
    gardenHeight: 24
  });
  const hidden = computeOverlayCardSlot({
    canReserve: true,
    cardVisible: false,
    gardenWidth: 100,
    gardenHeight: 24
  });

  assert.equal(visible.reserved, true);
  assert.equal(visible.visible, true);
  assert.equal(hidden.reserved, true);
  assert.equal(hidden.visible, false);
  assert.deepEqual(hidden.deadZone, visible.deadZone);
  assert.equal(hidden.width, visible.width);
  assert.equal(hidden.height, visible.height);
  assert.equal(hidden.offsetTop, visible.offsetTop);
  assert.equal(hidden.offsetLeft, visible.offsetLeft);
});

test("overlay card slot has no dead zone when the layout cannot reserve it", () => {
  const slot = computeOverlayCardSlot({
    canReserve: false,
    cardVisible: true,
    gardenWidth: 80,
    gardenHeight: 18
  });

  assert.equal(slot.reserved, false);
  assert.equal(slot.visible, false);
  assert.equal(slot.deadZone, undefined);
});
