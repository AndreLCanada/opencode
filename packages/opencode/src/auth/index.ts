import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const multiKeyProviders = new Set(["opencode", "opencode-go"])
const rotations = new Map<string, number>()

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
  readonly removeKey: (providerID: string, index: number) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      const info = (yield* all())[providerID]
      if (!info || info.type !== "api" || !multiKeyProviders.has(providerID)) return info
      const keys = parseKeys(info)
      if (keys.length === 0) return info
      const index = rotations.get(providerID) ?? 0
      rotations.set(providerID, (index + 1) % keys.length)
      return new Api({ ...info, key: keys[index % keys.length] })
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      const stored =
        info.type === "api" && multiKeyProviders.has(norm)
          ? new Api({
              ...info,
              metadata: { ...info.metadata, keys: JSON.stringify(uniqueKeys(parseKeys(data[norm]), info.key)) },
            })
          : info
      yield* fsys
        .writeJson(file, { ...data, [norm]: stored }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const removeKey = Effect.fn("Auth.removeKey")(function* (providerID: string, index: number) {
      const data = yield* all()
      const info = data[providerID]
      if (!info || info.type !== "api") return
      const keys = parseKeys(info).filter((_, current) => current !== index)
      if (keys.length === 0) {
        delete data[providerID]
      } else {
        data[providerID] = new Api({
          ...info,
          key: keys[0],
          metadata: { ...info.metadata, keys: JSON.stringify(keys) },
        })
      }
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove, removeKey })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

function parseKeys(value: unknown) {
  if (!value || typeof value !== "object") return []
  if ("metadata" in value && value.metadata && typeof value.metadata === "object" && "keys" in value.metadata) {
    const raw = value.metadata.keys
    if (typeof raw === "string") {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.filter((key): key is string => typeof key === "string")
      } catch {}
    }
  }
  if ("key" in value && typeof value.key === "string") return [value.key]
  return []
}

function uniqueKeys(existing: readonly string[], next: string) {
  return existing.includes(next) ? [...existing] : [...existing, next]
}

export * as Auth from "."
