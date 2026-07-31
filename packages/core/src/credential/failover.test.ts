import { describe, expect, test } from "bun:test"
import { eligible, makePool, matchingModel, otherRoute, retryAfterMs } from "./failover"

describe("credential failover pool", () => {
  test("rotates without selecting a reserved key", () => {
    const pool = makePool([{ id: "a" }, { id: "b" }], () => 100)
    expect(pool.next()?.id).toBe("a")
    expect(pool.next()?.id).toBe("b")
    expect(pool.next()?.id).toBeUndefined()
    pool.release("a")
    expect(pool.next()?.id).toBe("a")
  })

  test("honors cooldown and Retry-After", () => {
    const pool = makePool([{ id: "a" }, { id: "b" }], () => 100)
    const first = pool.next()!
    pool.penalize(first.id, 500)
    expect(pool.next()?.id).toBe("b")
    expect(retryAfterMs("2")).toBe(2000)
    expect(retryAfterMs("Thu, 01 Jan 1970 00:00:01 GMT", 0)).toBe(1000)
  })

  test("maps only the GO and Zen routes", () => {
    expect(otherRoute("opencode-go")).toBe("opencode")
    expect(otherRoute("opencode")).toBe("opencode-go")
    expect(otherRoute("openai")).toBeUndefined()
  })

  test("recognizes quota and authentication failures", () => {
    expect(eligible({ data: { statusCode: 429 } })).toBe(true)
    expect(eligible({ data: { message: "balance exhausted" } })).toBe(true)
    expect(eligible({ data: { message: "authentication failed" } })).toBe(true)
    expect(eligible({ data: { statusCode: 500, message: "unrelated" } })).toBe(false)
  })

  test("keeps the model ID and falls back when it is absent", () => {
    const models = [{ id: "same" }, { id: "default" }]
    expect(matchingModel(models, "same", models[1])?.id).toBe("same")
    expect(matchingModel(models, "missing", models[1])?.id).toBe("default")
  })
})
