import { CronExpressionParser } from "cron-parser"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"

export type ScheduledTask = {
  id: string
  cron: string
  prompt: string
  agent: string
  model: { providerID: string; modelID: string }
  lastRun: number | null
  enabled: boolean
  createdAt: number
}

type TasksState = {
  tasks: ScheduledTask[]
}

let taskCounter = 0
const nextId = () => `scheduled_${++taskCounter}_${Date.now()}`

const TICK_MS = 30_000

function notify(prompt: string) {
  if (!("Notification" in window)) return
  if (Notification.permission === "denied") return
  if (Notification.permission === "default") {
    Notification.requestPermission().then((p) => {
      if (p === "granted") new Notification("Scheduled task finished", { body: prompt })
    })
    return
  }
  new Notification("Scheduled task finished", { body: prompt })
}

type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom"

const HOURS = Array.from({ length: 24 }, (_, i) => ({ label: String(i).padStart(2, "0"), value: i }))
const MINUTES = Array.from({ length: 60 }, (_, i) => ({ label: String(i).padStart(2, "0"), value: i }))
const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))

function frequencyToCron(freq: Frequency, hour: number, minute: number, dayOfWeek?: number, dayOfMonth?: number): string {
  switch (freq) {
    case "daily": return `${minute} ${hour} * * *`
    case "weekdays": return `${minute} ${hour} * * 1-5`
    case "weekly": return `${minute} ${hour} * * ${dayOfWeek ?? 1}`
    case "monthly": return `${minute} ${hour} ${dayOfMonth ?? 1} * *`
    case "custom": return ""
  }
}

export function createScheduledTasksStore(dir: string) {
  return persisted(
    Persist.workspace(dir, "scheduled-tasks"),
    createStore<TasksState>({ tasks: [] }),
  )
}

export function useScheduledTasks() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const local = useLocal()
  const layout = useLayout()
  const navigate = useNavigate()
  const [state, setState, , ready] = createScheduledTasksStore(sdk().directory)

  createEffect(() => {
    if (!ready()) return
    const interval = setInterval(() => tick(sdk().directory), TICK_MS)
    onCleanup(() => clearInterval(interval))
    tick(sdk().directory)
  })

  async function tick(directory: string) {
    const now = Date.now()
    const toRun = state.tasks.filter((t) => {
      if (!t.enabled) return false
      try {
        const expr = CronExpressionParser.parse(t.cron)
        const afterLast = t.lastRun ?? 0
        const prev = expr.prev()
        if (!prev || prev.getTime() <= afterLast) return false
        const next = expr.next()
        return next && next.getTime() <= now
      } catch {
        return false
      }
    })
    for (const task of toRun) {
      await runTask(task, directory)
    }
  }

  async function runTask(task: ScheduledTask, directory: string) {
    try {
      const client = sdk().client
      const created = await client.session.create().then((x) => x.data)
      if (!created) return

      setState("tasks", (t) => t.id === task.id, "lastRun", Date.now())

      local.session.promote(directory, created.id, {
        agent: task.agent,
        model: task.model,
      })

      const encoded = base64Encode(directory)
      layout.handoff.setTabs(encoded, created.id)
      navigate(`/${encoded}/session/${created.id}`)

      await client.session.promptAsync({
        sessionID: created.id,
        agent: task.agent,
        model: task.model,
        messageID: `scheduled_${created.id}_${Date.now()}`,
        parts: [
          {
            id: `part_${created.id}_${Date.now()}`,
            type: "text",
            text: task.prompt,
          },
        ],
      })

      notify(task.prompt)
    } catch (err) {
      console.error("Scheduled task failed:", task.id, err)
    }
  }

  return {
    tasks: () => state.tasks,
    add(task: Omit<ScheduledTask, "id" | "lastRun" | "enabled" | "createdAt">) {
      setState("tasks", [...state.tasks, { ...task, id: nextId(), lastRun: null, enabled: true, createdAt: Date.now() }])
    },
    remove(id: string) {
      setState("tasks", state.tasks.filter((t) => t.id !== id))
    },
    ready,
  }
}

export function ScheduleDialog() {
  const dialog = useDialog()
  const scheduled = useScheduledTasks()
  const language = useLanguage()
  const local = useLocal()
  const [freq, setFreq] = createSignal<Frequency>("daily")
  const [hour, setHour] = createSignal(9)
  const [minute, setMinute] = createSignal(0)
  const [dayOfWeek, setDayOfWeek] = createSignal(1)
  const [dayOfMonth, setDayOfMonth] = createSignal(1)
  const [customCron, setCustomCron] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)

  const frequencies = [
    { label: "Every day", value: "daily" as const },
    { label: "Weekdays only", value: "weekdays" as const },
    { label: "Every week", value: "weekly" as const },
    { label: "Every month", value: "monthly" as const },
    { label: "Custom (cron)", value: "custom" as const },
  ]

  const cronPreview = () => {
    if (freq() === "custom") return customCron()
    return frequencyToCron(freq(), hour(), minute(), dayOfWeek(), dayOfMonth())
  }

  const handleAdd = () => {
    const p = prompt().trim()
    if (!p) {
      setError("Prompt is required")
      return
    }
    const cron = cronPreview()
    if (!cron) {
      setError("Cron expression is required")
      return
    }
    try {
      CronExpressionParser.parse(cron)
    } catch {
      setError("Invalid cron expression")
      return
    }
    const model = local.model.current()
    if (!model) return
    const agent = local.agent.current()
    if (!agent) return
    scheduled.add({
      cron,
      prompt: p,
      agent: agent.name,
      model: { providerID: model.provider.id, modelID: model.id },
    })
    setPrompt("")
    setError(null)
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("command.schedule.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex max-h-[min(560px,calc(100vh-160px))] w-full flex-col gap-5 overflow-y-auto px-4 pt-4 pb-1">
        <Field>
          <Field.Label>{language.t("command.schedule.frequency")}</Field.Label>
          <SelectV2
            options={frequencies}
            value={(o) => o.value}
            label={(o) => o.label}
            current={frequencies.find((f) => f.value === freq())}
            onSelect={(v) => v && setFreq(v.value)}
          />
        </Field>

        <Show when={freq() !== "custom"}>
          <div class="flex gap-3">
            <Field class="flex-1">
              <Field.Label>Hour</Field.Label>
              <SelectV2
                options={HOURS}
                value={(o) => String(o.value)}
                label={(o) => o.label}
                current={HOURS.find((h) => h.value === hour())}
                onSelect={(v) => v && setHour(v.value)}
              />
            </Field>
            <Field class="flex-1">
              <Field.Label>Minute</Field.Label>
              <SelectV2
                options={MINUTES}
                value={(o) => String(o.value)}
                label={(o) => o.label}
                current={MINUTES.find((m) => m.value === minute())}
                onSelect={(v) => v && setMinute(v.value)}
              />
            </Field>
          </div>
        </Show>

        <Show when={freq() === "weekly"}>
          <Field>
            <Field.Label>Day of week</Field.Label>
            <SelectV2
              options={DAYS_OF_WEEK.map((label, i) => ({ label, value: i }))}
              value={(o) => String(o.value)}
              label={(o) => o.label}
              current={DAYS_OF_WEEK.map((label, i) => ({ label, value: i })).find((d) => d.value === dayOfWeek())}
              onSelect={(v) => v && setDayOfWeek(v.value)}
            />
          </Field>
        </Show>

        <Show when={freq() === "monthly"}>
          <Field>
            <Field.Label>Day of month</Field.Label>
            <SelectV2
              options={DAYS_OF_MONTH}
              value={(o) => String(o.value)}
              label={(o) => o.label}
              current={DAYS_OF_MONTH.find((d) => d.value === dayOfMonth())}
              onSelect={(v) => v && setDayOfMonth(v.value)}
            />
          </Field>
        </Show>

        <Show when={freq() === "custom"}>
          <Field>
            <Field.Label>Cron expression</Field.Label>
            <TextInputV2
              value={customCron()}
              placeholder="0 9 * * *"
              onInput={(e) => setCustomCron(e.currentTarget.value)}
            />
          </Field>
        </Show>

        <Field>
          <Field.Label>{language.t("command.schedule.prompt")}</Field.Label>
          <TextareaV2
            value={prompt()}
            placeholder="run tests"
            rows={3}
            onInput={(e) => setPrompt(e.currentTarget.value)}
          />
        </Field>

        <Show when={cronPreview()}>
          <div class="text-[13px] text-v2-text-text-muted">
            Cron: <code class="text-v2-text-text-base">{cronPreview()}</code>
          </div>
        </Show>

        <Show when={error()}>
          <div class="text-[13px] text-[var(--danger)]">{error()}</div>
        </Show>

        <div class="flex gap-2 justify-end">
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 onClick={handleAdd}>
            {language.t("command.schedule.add")}
          </ButtonV2>
        </div>

        <Show when={scheduled.tasks().length > 0}>
          <div class="border-t border-v2-border-border-default pt-4">
            <h3 class="text-[14px] font-[530] mb-3 text-v2-text-text-base">
              {language.t("command.schedule.existing")}
            </h3>
            <div class="flex flex-col gap-2">
              <For each={scheduled.tasks()}>
                {(task) => (
                  <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-v2-overlay-simple-overlay-hover text-[13px]">
                    <code class="shrink-0 text-v2-text-text-muted">{task.cron}</code>
                    <span class="flex-1 truncate text-v2-text-text-base">{task.prompt}</span>
                    <button
                      onClick={() => scheduled.remove(task.id)}
                      class="shrink-0 text-[var(--danger)] hover:underline"
                    >
                      {language.t("common.delete")}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
