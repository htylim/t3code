import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SetThreadTagInput } from "./threadTag.ts";

const decode = Schema.decodeUnknownSync(SetThreadTagInput);

describe("thread tag input", () => {
  it("accepts labels containing spaces and trims surrounding whitespace", () => {
    expect(decode({ threadId: "thread", tag: { label: "  v3 refactor  " } })).toEqual({
      threadId: "thread",
      tag: { label: "v3 refactor" },
    });
  });
  it("uses null to clear a tag", () => {
    expect(decode({ threadId: "thread", tag: null }).tag).toBeNull();
  });
  it("accepts optional colors and an explicit reset to the default color", () => {
    for (const color of ["#8b5cf6", "#ABCDEF", null]) {
      expect(decode({ threadId: "thread", tag: { label: "work", color } }).tag).toEqual({
        label: "work",
        color,
      });
    }
  });
  it.each(["red", "#abc", "#12345678", "#zzzzzz", "url(example)"])(
    "rejects invalid tag color %s",
    (color) => {
      expect(() => decode({ threadId: "thread", tag: { label: "work", color } })).toThrow();
    },
  );
  it.each(["", "   ", "x".repeat(121)])("rejects invalid label %s", (label) => {
    expect(() => decode({ threadId: "thread", tag: { label } })).toThrow();
  });
});
