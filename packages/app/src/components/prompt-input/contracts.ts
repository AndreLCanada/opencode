import type { useLocal } from "@/context/local"
import type { Prompt, usePrompt } from "@/context/prompt"
import type { Accessor, JSX } from "solid-js"
import type { PromptInputHistory } from "./history-store"
import type { FollowupDraft, FollowupTarget } from "./submit"

export type PromptInputState = ReturnType<typeof usePrompt>

export type PromptInputSubmission = {
  abort: () => Promise<void> | void
  handleSubmit: (event: Event) => Promise<void> | void
}

export type PromptInputControls = {
  agents: {
    available: { name: string; hidden?: boolean; mode: string }[]
    options: string[]
    current: string
    loading: boolean
    visible: boolean
    select: (name: string | undefined) => void
  }
  model: {
    selection: ReturnType<typeof useLocal>["model"]
    paid: boolean
    loading: boolean
  }
  session: {
    id?: string
    tabs: {
      active: () => string | undefined
      all: () => string[]
      open: (tab: string) => void | Promise<void>
      setActive: (tab: string) => void
    }
    reviewPanel: {
      opened: () => boolean
      open: () => void
    }
  }
}

export interface PromptInputProps {
  class?: string
  state?: PromptInputState
  history?: PromptInputHistory
  submission?: PromptInputSubmission
  controls: PromptInputControls
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"]; target?: FollowupTarget }
  onEditLoaded?: () => void
  shouldQueue?: () => boolean
  queueTarget?: Accessor<FollowupTarget>
  setQueueTarget?: (target: FollowupTarget) => void
  onQueue?: (draft: FollowupDraft) => void
  onInterrupt?: (draft: FollowupDraft, messageID: string) => void | Promise<void>
  onAbort?: () => void
  onSubmit?: () => void
  toolbar?: JSX.Element
}
