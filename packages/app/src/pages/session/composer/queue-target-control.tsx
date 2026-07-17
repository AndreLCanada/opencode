import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { useLanguage } from "@/context/language"
import { createEffect, createSignal, on } from "solid-js"
import type { FollowupTarget } from "@/components/prompt-input/submit"
import "./queue-target-control.css"

export const TARGETS: FollowupTarget[] = ["steer", "current-stream", "followup", "sub-session"]

export function QueueTargetControl(props: {
  target: FollowupTarget
  onChange: (target: FollowupTarget) => void
  keybind?: string[]
}) {
  const language = useLanguage()
  const labels: Record<FollowupTarget, string> = {
    steer: language.t("prompt.queue.target.steer"),
    "current-stream": language.t("prompt.queue.target.current-stream"),
    followup: language.t("prompt.queue.target.followup"),
    "sub-session": language.t("prompt.queue.target.sub-session"),
  }

  const [menuOpen, setMenuOpen] = createSignal(false)
  let skipNextOpen = false
  let labelRef: HTMLSpanElement | undefined

  createEffect(
    on(
      () => props.target,
      () => {
        if (menuOpen()) return
        if (skipNextOpen) {
          skipNextOpen = false
          return
        }
        if (labelRef && labelRef.offsetWidth === 0) setMenuOpen(true)
      },
      { defer: true },
    ),
  )

  return (
    <TooltipV2
      placement="top"
      gutter={4}
      class="min-w-0"
      value={
        <>
          {language.t("command.prompt.queueTarget.cycle")}
          {props.keybind && <KeybindV2 keys={props.keybind} variant="neutral" />}
        </>
      }
    >
      <MenuV2 gutter={6} modal={false} placement="top-start" open={menuOpen()} onOpenChange={setMenuOpen}>
        <MenuV2.Trigger
          as={ButtonV2}
          variant="ghost-muted"
          size="normal"
          data-component="queue-target-trigger"
          class="max-w-[175px] min-w-[44px] justify-start ![font-weight:440]"
        >
          <Icon name="bullet-list" size="small" />
          <span ref={labelRef} class="min-w-0 block truncate leading-5" data-component="queue-target-label">{labels[props.target]}</span>
          <span class="-ml-0.5 -mr-1 flex shrink-0">
            <Icon name="chevron-down" size="small" />
          </span>
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.RadioGroup
              value={props.target}
              onChange={(value) => {
                skipNextOpen = true
                props.onChange(value as FollowupTarget)
              }}
            >
              {TARGETS.map((value) => (
                <TooltipV2
                  class="w-full block"
                  placement="right-start"
                  gutter={6}
                  openDelay={0}
                  value={language.t(`prompt.queue.target.${value}.description`)}
                >
                  <MenuV2.RadioItem class="w-full" value={value}>{labels[value]}</MenuV2.RadioItem>
                </TooltipV2>
              ))}
            </MenuV2.RadioGroup>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </TooltipV2>
  )
}
