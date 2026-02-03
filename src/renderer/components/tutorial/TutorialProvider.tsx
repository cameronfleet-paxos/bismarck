import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import type { TutorialStep, OperatingMode } from '@/shared/types'
import { tutorialSteps, getAvailableSteps } from './tutorial-steps'
import type { TutorialStepDefinition, TutorialAction } from './tutorial-steps'
import { TutorialOverlay } from './TutorialOverlay'
import { TutorialTooltip } from './TutorialTooltip'

interface TutorialContextValue {
  isActive: boolean
  currentStep: TutorialStep | null
  currentStepIndex: number
  totalSteps: number
  completedSteps: TutorialStep[]
  availableSteps: TutorialStepDefinition[]
  startTutorial: () => void
  nextStep: () => void
  previousStep: () => void
  skipTutorial: () => void
  completeTutorial: () => void
  goToStep: (step: TutorialStep) => void
}

const TutorialContext = createContext<TutorialContextValue | null>(null)

export function useTutorial() {
  const context = useContext(TutorialContext)
  if (!context) {
    throw new Error('useTutorial must be used within a TutorialProvider')
  }
  return context
}

interface TutorialProviderProps {
  children: ReactNode
  operatingMode: OperatingMode
  tutorialCompleted?: boolean
  onTutorialComplete?: () => void
  onTutorialSkip?: () => void
  onAction?: (action: TutorialAction) => void
}

export function TutorialProvider({
  children,
  operatingMode,
  tutorialCompleted = false,
  onTutorialComplete,
  onTutorialSkip,
  onAction,
}: TutorialProviderProps) {
  const [isActive, setIsActive] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<TutorialStep[]>([])
  const [availableSteps, setAvailableSteps] = useState<TutorialStepDefinition[]>([])
  const previousStepRef = useRef<TutorialStepDefinition | null>(null)

  // Update available steps when operating mode changes
  useEffect(() => {
    const steps = getAvailableSteps(operatingMode)
    setAvailableSteps(steps)

    // If tutorial is active and current step is no longer available, move to next available step
    if (isActive && steps.length > 0) {
      const currentStep = availableSteps[currentStepIndex]
      if (currentStep && !steps.some(s => s.id === currentStep.id)) {
        const nextAvailableIndex = Math.min(currentStepIndex, steps.length - 1)
        setCurrentStepIndex(nextAvailableIndex)
      }
    }
  }, [operatingMode])

  const currentStep = availableSteps[currentStepIndex] || null
  const totalSteps = availableSteps.length

  // Execute onEnter/onExit actions when step changes
  useEffect(() => {
    if (!isActive) {
      // Tutorial ended - run onExit for previous step if any
      if (previousStepRef.current?.onExit) {
        onAction?.(previousStepRef.current.onExit)
      }
      previousStepRef.current = null
      return
    }

    // Run onExit for previous step
    if (previousStepRef.current?.onExit) {
      onAction?.(previousStepRef.current.onExit)
    }

    // Run onEnter for current step
    if (currentStep?.onEnter) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        onAction?.(currentStep.onEnter!)
      }, 50)
      return () => clearTimeout(timer)
    }

    previousStepRef.current = currentStep
  }, [isActive, currentStep, onAction])

  // Update previous step ref after effect runs
  useEffect(() => {
    previousStepRef.current = currentStep
  }, [currentStep])

  const startTutorial = useCallback(() => {
    if (tutorialCompleted) {
      // Allow restarting the tutorial
      setCompletedSteps([])
    }
    setIsActive(true)
    setCurrentStepIndex(0)
  }, [tutorialCompleted])

  const nextStep = useCallback(() => {
    if (!currentStep) return

    // Mark current step as completed
    setCompletedSteps(prev => {
      if (!prev.includes(currentStep.id)) {
        return [...prev, currentStep.id]
      }
      return prev
    })

    // Move to next step or complete tutorial
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex(prev => prev + 1)
    } else {
      completeTutorial()
    }
  }, [currentStep, currentStepIndex, totalSteps])

  const previousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1)
    }
  }, [currentStepIndex])

  const skipTutorial = useCallback(() => {
    setIsActive(false)
    setCurrentStepIndex(0)
    onTutorialSkip?.()
  }, [onTutorialSkip])

  const completeTutorial = useCallback(() => {
    if (currentStep) {
      setCompletedSteps(prev => {
        if (!prev.includes(currentStep.id)) {
          return [...prev, currentStep.id]
        }
        return prev
      })
    }
    setIsActive(false)
    setCurrentStepIndex(0)
    onTutorialComplete?.()
  }, [currentStep, onTutorialComplete])

  const goToStep = useCallback((step: TutorialStep) => {
    const stepIndex = availableSteps.findIndex(s => s.id === step)
    if (stepIndex !== -1) {
      setCurrentStepIndex(stepIndex)
    }
  }, [availableSteps])

  const value: TutorialContextValue = {
    isActive,
    currentStep: currentStep?.id || null,
    currentStepIndex,
    totalSteps,
    completedSteps,
    availableSteps,
    startTutorial,
    nextStep,
    previousStep,
    skipTutorial,
    completeTutorial,
    goToStep,
  }

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {isActive && currentStep && (
        <TutorialOverlay step={currentStep} isActive={isActive}>
          <TutorialTooltip
            step={currentStep}
            currentStepIndex={currentStepIndex}
            totalSteps={totalSteps}
            onNext={nextStep}
            onPrevious={previousStep}
            onSkip={skipTutorial}
            onClose={skipTutorial}
          />
        </TutorialOverlay>
      )}
    </TutorialContext.Provider>
  )
}
