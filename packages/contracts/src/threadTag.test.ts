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
  it.each(["", "   ", "x".repeat(121)])("rejects invalid label %s", (label) => {
    expect(() => decode({ threadId: "thread", tag: { label } })).toThrow();
  });
});
