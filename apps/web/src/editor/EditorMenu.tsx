import { MoreHorizontal } from 'lucide-react'
import { IconButton } from '../ui/primitives.tsx'
import type { BatchContext } from './context.ts'

export function EditorMenu(_: { ctx: BatchContext; view: string }) {
  return <IconButton icon={MoreHorizontal} label="More" />
}
