import { CronExpressionParser } from "cron-parser"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
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
import { Identifier } from "@/utils/id"
import { useServerSDK } from "@/context/server-sdk"
import { useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"

type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom"

export type ScheduledTask = {
  id: string
  cron: string
  prompt: string
  agent: string
  model: { providerID: string; modelID: string }
  lastRun: number | null
  enabled: boolean
  createdAt: number
  frequency?: Frequency
  hour?: number
  minute?: number
  dayOfWeek?: number
  dayOfMonth?: number
  customCron?: string
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

function cronToFrequency(cron: string): { frequency: Frequency; hour: number; minute: number; dayOfWeek: number; dayOfMonth: number; customCron: string } {
  const parts = cron.split(" ")
  if (parts.length === 5) {
    const minute = Number(parts[0])
    const hour = Number(parts[1])
    const dayOfMonth = Number(parts[2])
    const dayOfWeek = Number(parts[4])
    if (parts[3] === "*" && parts[2] === "*" && parts[4] === "*") return { frequency: "daily", hour, minute, dayOfWeek: 1, dayOfMonth: 1, customCron: cron }
    if (parts[3] === "*" && parts[2] === "*" && parts[4] === "1-5") return { frequency: "weekdays", hour, minute, dayOfWeek: 1, dayOfMonth: 1, customCron: cron }
    if (parts[3] === "*" && parts[2] === "*" && !Number.isNaN(dayOfWeek)) return { frequency: "weekly", hour, minute, dayOfWeek, dayOfMonth: 1, customCron: cron }
    if (parts[3] === "*" && !Number.isNaN(dayOfMonth) && parts[4] === "*") return { frequency: "monthly", hour, minute, dayOfWeek: 1, dayOfMonth, customCron: cron }
  }
  return { frequency: "custom", hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1, customCron: cron }
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
        return prev && prev.getTime() > afterLast && prev.getTime() <= now
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
      const messageID = Identifier.ascending("message")
      const created = await sdk()
        .api.session.create({
          agent: task.agent,
          model: { id: task.model.modelID, providerID: task.model.providerID },
          location: { directory },
        })
        .catch((err) => {
          console.error("Scheduled task failed to create session:", task.id, err)
          return undefined
        })
      if (!created) return

      setState("tasks", (t) => t.id === task.id, "lastRun", Date.now())

      local.session.promote(directory, created.id, {
        agent: task.agent,
        model: task.model,
      })

      const encoded = base64Encode(directory)
      layout.handoff.setTabs(encoded, created.id)
      navigate(`/${encoded}/session/${created.id}`)

      await sdk()
        .api.session.prompt({
          sessionID: created.id,
          id: messageID,
          agent: task.agent,
          model: task.model,
          text: task.prompt,
          legacyParts: [{ type: "text", text: task.prompt }],
        })
        .catch((err) => {
          console.error("Scheduled task failed to send prompt:", task.id, err)
        })

      notify(task.prompt)
    } catch (err) {
      console.error("Scheduled task failed:", task.id, err)
    }
  }

  return {
    tasks: () => state.tasks,
    add(task: Omit<ScheduledTask, "id" | "lastRun" | "enabled" | "createdAt">) {
      setState("tasks", [...state.tasks, { ...task, id: nextId(), lastRun: Date.now(), enabled: true, createdAt: Date.now() }])
    },
    update(id: string, task: Partial<ScheduledTask>) {
      setState("tasks", (t) => t.id === id, task)
    },
    remove(id: string) {
      setState("tasks", state.tasks.filter((t) => t.id !== id))
    },
    ready,
  }
}

const DEFAULT_FORM = {
  editingTaskId: null as string | null,
  freq: "daily" as Frequency,
  hour: 9,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
  customCron: "",
  modelKey: null as string | null,
  prompt: "",
  error: null as string | null,
}

export function ScheduleDialog() {
  const dialog = useDialog()
  const scheduled = useScheduledTasks()
  const language = useLanguage()
  const local = useLocal()
  const [form, setForm] = createStore({ ...DEFAULT_FORM })
  const models = createMemo(() => local.model.list())
  const modelKey = (model: { provider: { id: string }; id: string }) => `${model.provider.id}:${model.id}`
  const modelLabel = (model: { provider: { name: string }; name: string }) => `${model.provider.name} / ${model.name}`
  const selectedModel = createMemo(() => {
    if (form.modelKey) return models().find((model) => modelKey(model) === form.modelKey)
    return local.model.current()
  })

  const frequencies = [
    { label: language.t("command.schedule.frequency.daily"), value: "daily" as const },
    { label: language.t("command.schedule.frequency.weekdays"), value: "weekdays" as const },
    { label: language.t("command.schedule.frequency.weekly"), value: "weekly" as const },
    { label: language.t("command.schedule.frequency.monthly"), value: "monthly" as const },
    { label: language.t("command.schedule.frequency.custom"), value: "custom" as const },
  ]

  const cronPreview = () => {
    if (form.freq === "custom") return form.customCron
    return frequencyToCron(form.freq, form.hour, form.minute, form.dayOfWeek, form.dayOfMonth)
  }

  const resetForm = () => setForm({ ...DEFAULT_FORM })

  const loadTask = (task: ScheduledTask) => {
    const derived = cronToFrequency(task.cron)
    setForm({
      editingTaskId: task.id,
      freq: derived.frequency,
      hour: derived.hour,
      minute: derived.minute,
      dayOfWeek: derived.dayOfWeek,
      dayOfMonth: derived.dayOfMonth,
      customCron: task.customCron || derived.customCron,
      modelKey: `${task.model.providerID}:${task.model.modelID}`,
      prompt: task.prompt,
      error: null,
    })
  }

  const validate = () => {
    const p = form.prompt.trim()
    if (!p) {
      setForm("error", language.t("command.schedule.error.promptRequired"))
      return false
    }
    const cron = cronPreview()
    if (!cron) {
      setForm("error", language.t("command.schedule.error.cronRequired"))
      return false
    }
    try {
      CronExpressionParser.parse(cron)
    } catch {
      setForm("error", language.t("command.schedule.error.cronInvalid"))
      return false
    }
    const model = selectedModel()
    if (!model) {
      setForm("error", language.t("command.schedule.error.modelRequired"))
      return false
    }
    const agent = local.agent.current()
    if (!agent) {
      setForm("error", language.t("command.schedule.error.agentRequired"))
      return false
    }
    setForm("error", null)
    return { p, cron, model, agent }
  }

  const handleSave = () => {
    const result = validate()
    if (!result) return
    const { p, cron, model, agent } = result
    if (form.editingTaskId) {
      scheduled.update(form.editingTaskId, {
        cron,
        prompt: p,
        agent: agent.name,
        model: { providerID: model.provider.id, modelID: model.id },
        frequency: form.freq,
        hour: form.hour,
        minute: form.minute,
        dayOfWeek: form.dayOfWeek,
        dayOfMonth: form.dayOfMonth,
        customCron: form.customCron,
      })
    } else {
      scheduled.add({
        cron,
        prompt: p,
        agent: agent.name,
        model: { providerID: model.provider.id, modelID: model.id },
        frequency: form.freq,
        hour: form.hour,
        minute: form.minute,
        dayOfWeek: form.dayOfWeek,
        dayOfMonth: form.dayOfMonth,
        customCron: form.customCron,
      })
    }
    resetForm()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("command.schedule.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex max-h-[min(560px,calc(100vh-160px))] w-full flex-col gap-5 !overflow-y-auto min-h-0 px-4 pt-4 pb-1">
        <div class="flex flex-col gap-5 shrink-0">
           <Field>
             <Field.Label>{language.t("command.schedule.model")}</Field.Label>
             <SelectV2
               class="!w-full"
               options={models()}
               value={modelKey}
               label={modelLabel}
               current={selectedModel()}
               onSelect={(value) => value && setForm("modelKey", modelKey(value))}
             />
           </Field>

           <Field>
            <Field.Label>{language.t("command.schedule.frequency")}</Field.Label>
            <SelectV2
              class="!w-full"
              options={frequencies}
              value={(o) => o.value}
              label={(o) => o.label}
              current={frequencies.find((f) => f.value === form.freq)}
              onSelect={(v) => v && setForm("freq", v.value)}
            />
          </Field>

          <Show when={form.freq !== "custom"}>
            <div class="flex gap-3">
              <Field class="flex-1">
                <Field.Label>{language.t("command.schedule.hour")}</Field.Label>
                <SelectV2
                  class="!w-full"
                  options={HOURS}
                  value={(o) => String(o.value)}
                  label={(o) => o.label}
                  current={HOURS.find((h) => h.value === form.hour)}
                  onSelect={(v) => v && setForm("hour", v.value)}
                />
              </Field>
              <Field class="flex-1">
                <Field.Label>{language.t("command.schedule.minute")}</Field.Label>
                <SelectV2
                  class="!w-full"
                  options={MINUTES}
                  value={(o) => String(o.value)}
                  label={(o) => o.label}
                  current={MINUTES.find((m) => m.value === form.minute)}
                  onSelect={(v) => v && setForm("minute", v.value)}
                />
              </Field>
            </div>
            <div class="text-[12px] text-v2-text-text-muted mt-1">
              {language.t("command.schedule.localTime")}
            </div>
          </Show>

          <Show when={form.freq === "weekly"}>
            <Field>
              <Field.Label>{language.t("command.schedule.dayOfWeek")}</Field.Label>
              <SelectV2
                class="!w-full"
                options={DAYS_OF_WEEK.map((label, i) => ({ label, value: i }))}
                value={(o) => String(o.value)}
                label={(o) => o.label}
                current={DAYS_OF_WEEK.map((label, i) => ({ label, value: i })).find((d) => d.value === form.dayOfWeek)}
                onSelect={(v) => v && setForm("dayOfWeek", v.value)}
              />
            </Field>
          </Show>

          <Show when={form.freq === "monthly"}>
            <Field>
              <Field.Label>{language.t("command.schedule.dayOfMonth")}</Field.Label>
              <SelectV2
                class="!w-full"
                options={DAYS_OF_MONTH}
                value={(o) => String(o.value)}
                label={(o) => o.label}
                current={DAYS_OF_MONTH.find((d) => d.value === form.dayOfMonth)}
                onSelect={(v) => v && setForm("dayOfMonth", v.value)}
              />
            </Field>
          </Show>

          <Show when={form.freq === "custom"}>
            <Field>
              <Field.Label>{language.t("command.schedule.cron")}</Field.Label>
              <TextInputV2
                class="!w-full"
                appearance="large"
                value={form.customCron}
                placeholder="0 9 * * *"
                onInput={(e) => setForm("customCron", e.currentTarget.value)}
              />
            </Field>
          </Show>

          <Field>
            <Field.Label>{language.t("command.schedule.prompt")}</Field.Label>
            <TextareaV2
              value={form.prompt}
              placeholder="run tests"
              rows={3}
              onInput={(e) => setForm("prompt", e.currentTarget.value)}
            />
          </Field>

          <Show when={cronPreview()}>
            <div class="text-[13px] text-v2-text-text-muted">
              Cron: <code class="text-v2-text-text-base">{cronPreview()}</code>
            </div>
          </Show>

          <Show when={form.error}>
            <div class="text-[13px] text-[var(--danger)]">{form.error}</div>
          </Show>

          <div class="flex gap-2 justify-end">
            <Show when={form.editingTaskId}>
              <ButtonV2 variant="ghost" onClick={resetForm}>
                {language.t("common.cancel")}
              </ButtonV2>
            </Show>
            <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </ButtonV2>
            <ButtonV2 onClick={handleSave}>
              {form.editingTaskId ? language.t("common.save") : language.t("command.schedule.add")}
            </ButtonV2>
          </div>
        </div>

        <Show when={scheduled.tasks().length > 0}>
          <div class="border-t border-v2-border-border-default pt-4">
            <h3 class="text-[14px] font-[530] mb-3 text-v2-text-text-base">
              {language.t("command.schedule.existing")}
            </h3>
            <div class="flex flex-col gap-2 pr-1 pb-4">
              <For each={scheduled.tasks()}>
                {(task) => (
                  <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-v2-overlay-simple-overlay-hover text-[13px] overflow-hidden">
                    <code class="shrink-0 text-v2-text-text-muted">{task.cron}</code>
                    <span class="flex-1 min-w-0 truncate text-v2-text-text-base">{task.prompt}</span>
                    <ButtonV2
                      variant="ghost-muted"
                      size="small"
                      icon="edit"
                      onClick={() => loadTask(task)}
                    >
                      {language.t("common.edit")}
                    </ButtonV2>
                    <ButtonV2
                      variant="ghost-muted"
                      size="small"
                      onClick={() => scheduled.remove(task.id)}
                    >
                      {language.t("common.delete")}
                    </ButtonV2>
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
