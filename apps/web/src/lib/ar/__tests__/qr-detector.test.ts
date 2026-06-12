import { describe, expect, it } from "vitest";

import { parseStationPayload } from "../qr-detector";

/**
 * `parseStationPayload` is the boundary that decides whether a scanned QR is
 * one of ours (an anchor) or someone else's. Spec §6 (2026-06-13) makes the
 * URL form primary and keeps the `tcsh://` scheme for early demo sheets, so
 * both shapes must resolve to the same station id and unrelated QRs must come
 * back `foreign` — a false "station" would feed a bogus solvePnP anchor.
 */
describe("parseStationPayload", () => {
  it("parses the primary URL form on any host", () => {
    expect(parseStationPayload("https://tcsh.example.com/a/scan/demo-01")).toEqual({
      kind: "station",
      stationId: "demo-01",
    });
    // LAN IP + port (dev / venue Wi-Fi) is a valid host too.
    expect(parseStationPayload("http://192.168.1.20:5173/a/scan/station-a")).toEqual({
      kind: "station",
      stationId: "station-a",
    });
  });

  it("tolerates a trailing slash, query string, and hash on the URL form", () => {
    expect(
      parseStationPayload("https://x.y/a/scan/demo-01/?utm=qr#frag"),
    ).toEqual({ kind: "station", stationId: "demo-01" });
  });

  it("decodes percent-encoded station ids", () => {
    expect(parseStationPayload("https://x.y/a/scan/st%20a")).toEqual({
      kind: "station",
      stationId: "st a",
    });
  });

  it("parses the legacy tcsh:// scheme", () => {
    expect(parseStationPayload("tcsh://station/demo-01")).toEqual({
      kind: "station",
      stationId: "demo-01",
    });
  });

  it("rejects URLs that are not the /a/scan path", () => {
    expect(parseStationPayload("https://x.y/a/view/demo-01")).toEqual({
      kind: "foreign",
    });
    expect(parseStationPayload("https://x.y/a/scan/")).toEqual({
      kind: "foreign",
    });
    expect(parseStationPayload("https://x.y/a/scan/a/b")).toEqual({
      kind: "foreign",
    });
  });

  it("rejects unrelated text / other peoples' QRs", () => {
    expect(parseStationPayload("https://google.com")).toEqual({ kind: "foreign" });
    expect(parseStationPayload("just some text")).toEqual({ kind: "foreign" });
    expect(parseStationPayload("tcsh://station/")).toEqual({ kind: "foreign" });
    expect(parseStationPayload("")).toEqual({ kind: "foreign" });
  });
});
