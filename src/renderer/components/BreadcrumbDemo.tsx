import { useState } from 'react'
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb'
import { Button } from './ui/button'

/**
 * Demo component showing breadcrumb navigation with multi-level paths.
 * This demonstrates how the breadcrumb will be used in the Settings page.
 *
 * Example navigation paths:
 * - Settings
 * - Settings > Docker
 * - Settings > Docker > Proxied Tools
 * - Settings > Docker > Proxied Tools > Edit npm
 * - Settings > Repositories
 * - Settings > Repositories > Edit my-repo
 */
export function BreadcrumbDemo() {
  const [path, setPath] = useState<string[]>(['Settings'])

  const navigateTo = (newPath: string[]) => {
    setPath(newPath)
  }

  const getBreadcrumbItems = (): BreadcrumbItem[] => {
    return path.map((label, index) => ({
      label,
      onClick: index < path.length - 1
        ? () => navigateTo(path.slice(0, index + 1))
        : undefined
    }))
  }

  return (
    <div className="p-6 space-y-6">
      <div className="border-b pb-4">
        <Breadcrumb items={getBreadcrumbItems()} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Current Path: {path.join(' > ')}</h3>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Navigate to:</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateTo(['Settings'])}
            >
              Settings Root
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateTo(['Settings', 'Docker'])}
            >
              Docker Section
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateTo(['Settings', 'Docker', 'Proxied Tools'])}
            >
              Proxied Tools
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateTo(['Settings', 'Docker', 'Proxied Tools', 'Edit npm'])}
            >
              Edit npm Tool
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateTo(['Settings', 'Repositories'])}
            >
              Repositories
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateTo(['Settings', 'Repositories', 'Edit my-repo'])}
            >
              Edit Repository
            </Button>
          </div>
        </div>

        <div className="mt-6 p-4 bg-muted rounded-md">
          <p className="text-sm">
            Click on any breadcrumb segment (except the last one) to navigate back to that level.
            This matches the behavior described in the discussion for Settings navigation.
          </p>
        </div>
      </div>
    </div>
  )
}
