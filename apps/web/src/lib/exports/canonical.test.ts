import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}',
    );
  });

  it("gives the same bytes regardless of insertion order", () => {
    const one = { rows: [{ day: "2026-09-01", edited: false }], id: "e" };
    const two = { id: "e", rows: [{ edited: false, day: "2026-09-01" }] };
    expect(canonicalJson(one)).toBe(canonicalJson(two));
  });

  it("sorts keys by UTF-16 code units, like RFC 8785", () => {
    expect(canonicalJson({ é: 1, z: 2, Z: 3, _: 4 })).toBe('{"Z":3,"_":4,"z":2,"é":1}');
  });

  it("escapes strings the JSON.stringify way", () => {
    expect(canonicalJson({ name: 'Jan "de" Smet\n\u0001' })).toBe(
      String.raw`{"name":"Jan \"de\" Smet\n\u0001"}`,
    );
  });

  it("writes -0 as 0", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  it("refuses floats, undefined and class instances", () => {
    expect(() => canonicalJson(1.5)).toThrow(TypeError);
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson(new Date(0))).toThrow(TypeError);
  });
});
