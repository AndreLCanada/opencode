import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import type { FollowupTarget } from "@/components/prompt-input/submit"
import "./queue-target-control.css"

const TARGETS: FollowupTarget[] = ["steer", "current-stream", "followup", "sub-session"]

export function QueueTargetControl(props: {
  target: FollowupTarget
  onChange: (target: FollowupTarget) => void
}) {
  const language = useLanguage()
  const labels: Record<FollowupTarget, string> = {
    steer: language.t("prompt.queue.target.steer"),
    "current-stream": language.t("prompt.queue.target.current-stream"),
    followup: language.t("prompt.queue.target.followup"),
    "sub-session": language.t("prompt.queue.target.sub-session"),
  }

  return (
    <TooltipV2
      placement="top"
      gutter={4}
      value={labels[props.target]}
    >
    <MenuV2 gutter={6} modal={false} placement="top-start">
      <MenuV2.Trigger
        as={ButtonV2}
        variant="ghost-muted"
        size="normal"
        data-queue-target-trigger
        class="min-w-0 max-w-[175px] justify-start ![font-weight:440]"
      >
        <span data-queue-target-icon>
          <Icon name="bullet-list" size="small" class="shrink-0" />
        </span>
        <span data-queue-target-label class="min-w-0 truncate leading-5">{labels[props.target]}</span>
        <span class="-ml-0.5 -mr-1 flex shrink-0">
          <Icon name="chevron-down" size="small" class="text-v2-icon-icon-muted" />
        </span>
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.RadioGroup
            value={props.target}
            onChange={(value) => props.onChange(value as FollowupTarget)}
          >
            {TARGETS.map((value) => (
              <TooltipV2
                class="w-full"
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
