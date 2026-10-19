import type { ReactElement } from 'react'
import { DeleteButton } from './delete-button'

type RowDeleteButtonProps = {
  /** Included in confirm/cancel logs so the row can be identified. */
  label: string
  /** When true, the control cannot open or confirm (sync / metadata lock). */
  disabled?: boolean
  /** Runs after the check is pressed. The button already confirmed. */
  onConfirm: () => void
}

/**
 * Row wrapper around the Rare UI delete button (see ./delete-button.tsx).
 * Clicks stay on the control so they do not queue, play, or activate the row.
 */
export function RowDeleteButton({
  label,
  disabled = false,
  onConfirm
}: RowDeleteButtonProps): ReactElement {
  return (
    <div
      className="shrink-0"
      // The parent row treats click and double-click as queue / play.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      inert={disabled ? true : undefined}
    >
      <DeleteButton
        size="sm"
        className={disabled ? 'pointer-events-none opacity-40' : undefined}
        aria-disabled={disabled || undefined}
        onConfirm={() => {
          console.info('[RowDeleteButton] confirmed', label)
          onConfirm()
        }}
        onCancel={() => {
          console.info('[RowDeleteButton] cancelled', label)
        }}
      />
    </div>
  )
}
