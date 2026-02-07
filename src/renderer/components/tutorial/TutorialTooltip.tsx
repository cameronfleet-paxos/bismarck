import { X } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import type { TutorialStepDefinition } from './tutorial-steps'
import { cn } from '@/lib/utils'

export interface TutorialTooltipProps {
  step: TutorialStepDefinition
  currentStepIndex: number
  totalSteps: number
  onNext?: () => void
  onPrevious?: () => void
  onSkip?: () => void
  onClose?: () => void
  className?: string
}

export function TutorialTooltip({
  step,
  currentStepIndex,
  totalSteps,
  onNext,
  onPrevious,
  onSkip,
  onClose,
  className,
}: TutorialTooltipProps) {
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === totalSteps - 1

  return (
    <div
      data-testid="tutorial-tooltip"
      data-slot="tutorial-tooltip"
      className={cn(
        'relative w-[400px] rounded-lg border bg-background shadow-lg',
        'animate-in fade-in-0 zoom-in-95 duration-200',
        className
      )}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className={cn(
          'absolute right-2 top-2 rounded-sm opacity-70 transition-opacity',
          'hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring',
          'disabled:pointer-events-none'
        )}
        aria-label="Close tutorial"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Content */}
      <div className="space-y-4 p-6">
        {/* Progress indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Step {currentStepIndex + 1} of {totalSteps}
          </span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold leading-none tracking-tight">
          {step.title}
        </h3>

        {/* Description */}
        <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
          {step.description.split('\n').map((line, i) => {
            // Handle bullet points with bold text
            const boldMatch = line.match(/^(•\s*)\*\*(.+?)\*\*(.*)$/)
            if (boldMatch) {
              return (
                <p key={i} className={i > 0 ? 'mt-1' : ''}>
                  {boldMatch[1]}<strong className="text-foreground">{boldMatch[2]}</strong>{boldMatch[3]}
                </p>
              )
            }
            // Empty lines create spacing
            if (line.trim() === '') {
              return <div key={i} className="h-2" />
            }
            return <p key={i} className={i > 0 ? 'mt-1' : ''}>{line}</p>
          })}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {!isFirstStep && onPrevious && (
              <Button
                variant="outline"
                size="sm"
                onClick={onPrevious}
              >
                Previous
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onSkip && !isLastStep && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSkip}
              >
                Skip Tutorial
              </Button>
            )}
            {onNext && (
              <Button
                size="sm"
                onClick={onNext}
              >
                {isLastStep ? 'Finish' : 'Next'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
