import type { BatchContext } from './context.ts'

export default function AutoPanel({ ctx }: { ctx: BatchContext }) {
  return <div className="p-6 text-sm text-mute">{ctx.photos.length} photos</div>
}
