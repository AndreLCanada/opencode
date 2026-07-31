import { describe, expect, test } from "bun:test"
import { ProviderAuth } from "@/provider/auth"
import { Schema } from "effect"

describe("provider.auth stored key schema", () => {
  test("decodes api method with empty prompts array", () => {
    const decoded = Schema.decodeUnknownSync(ProviderAuth.Method)({
      type: "api",
      label: "Stored API key 1",
      prompts: [],
    })
    expect(decoded.label).toBe("Stored API key 1")
    expect(decoded.type).toBe("api")
  })

  test("encodes api method with empty prompts array", () => {
    const decoded = Schema.decodeUnknownSync(ProviderAuth.Method)({
      type: "api",
      label: "Stored API key 1",
      prompts: [],
    })
    const encoded = Schema.encodeSync(ProviderAuth.Method)(decoded)
    expect(encoded).toEqual({ type: "api", label: "Stored API key 1", prompts: [] })
  })

  test("decodes api method without prompts", () => {
    const decoded = Schema.decodeUnknownSync(ProviderAuth.Method)({
      type: "api",
      label: "Plugin API method",
    })
    expect(decoded.label).toBe("Plugin API method")
    expect(decoded.type).toBe("api")
  })

  test("decodes and encodes Methods record with stored api key", () => {
    const methods = {
      "opencode-go": [
        Schema.decodeUnknownSync(ProviderAuth.Method)({
          type: "api",
          label: "Stored API key 1",
          prompts: [],
        }),
      ],
    }
    const encoded = Schema.encodeSync(ProviderAuth.Methods)(methods)
    expect(encoded).toEqual({
      "opencode-go": [{ type: "api", label: "Stored API key 1", prompts: [] }],
    })
    const decoded = Schema.decodeUnknownSync(ProviderAuth.Methods)(encoded)
    expect(decoded["opencode-go"][0].label).toBe("Stored API key 1")
  })
})
