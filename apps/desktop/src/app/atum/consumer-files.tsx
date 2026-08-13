import { useStore } from '@nanostores/react'
import { IconArrowUp, IconChevronLeft, IconFile, IconFolder, IconLayoutGrid, IconList } from '@tabler/icons-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import type { HermesReadDirEntry } from '@/global'
import { useI18n } from '@/i18n'
import { readDesktopDir } from '@/lib/desktop-fs'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { setWorkspaceTab } from '@/store/atum-shell'
import { setCurrentSessionPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

export type AtumFileView = 'grid' | 'list'

const VIEW_STORAGE_KEY = 'hermes.desktop.atum.fileView'

/**
 * Parent calculation deliberately supports the path shapes the desktop bridge
 * can return on macOS, Linux, Windows drives, and UNC shares. The returned
 * separator follows the input so it can be sent straight back to the bridge.
 */
export function parentDirectory(filePath: string): null | string {
  const separator = filePath.includes('\\') && !filePath.includes('/') ? '\\' : '/'
  const normalized = filePath.replace(/[\\/]+$/u, '')

  if (!normalized || normalized === '/' || /^[A-Za-z]:$/u.test(normalized)) {
    return null
  }

  const lastSeparator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparator < 0) {
    return null
  }

  // POSIX root and Windows drive root retain their trailing separator.
  if (lastSeparator === 0) {
    return '/'
  }

  const parent = normalized.slice(0, lastSeparator)

  return /^[A-Za-z]:$/u.test(parent) ? `${parent}${separator}` : parent
}

export function folderName(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/u, '')

  return normalized.split(/[\\/]/u).filter(Boolean).pop() || filePath || ''
}

export function consumerVisibleEntries(entries: readonly HermesReadDirEntry[]): HermesReadDirEntry[] {
  return entries
    .filter(entry => !entry.name.startsWith('.'))
    .toSorted(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true })
    )
}

function initialView(): AtumFileView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function AtumConsumerFiles() {
  const { t } = useI18n()
  const cwd = useStore($currentCwd)
  const [directory, setDirectory] = useState(cwd)
  const [entries, setEntries] = useState<HermesReadDirEntry[]>([])
  const [error, setError] = useState(false)
  const [openError, setOpenError] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [loading, setLoading] = useState(Boolean(cwd))
  const [openingPath, setOpeningPath] = useState<null | string>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [view, setView] = useState<AtumFileView>(initialView)
  const requestId = useRef(0)

  // A different assistant/session workspace starts a fresh Finder history.
  useEffect(() => {
    setDirectory(cwd)
    setHistory([])
  }, [cwd])

  useEffect(() => {
    if (!directory) {
      requestId.current += 1
      setEntries([])
      setError(false)
      setLoading(false)

      return
    }

    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setLoading(true)
    setError(false)

    void readDesktopDir(directory)
      .then(result => {
        if (requestId.current !== currentRequest) {
          return
        }

        if (result.error) {
          setEntries([])
          setError(true)
        } else {
          setEntries(consumerVisibleEntries(result.entries ?? []))
        }
      })
      .catch(() => {
        if (requestId.current === currentRequest) {
          setEntries([])
          setError(true)
        }
      })
      .finally(() => {
        if (requestId.current === currentRequest) {
          setLoading(false)
        }
      })
  }, [directory, reloadNonce])

  const parent = useMemo(() => parentDirectory(directory), [directory])

  const chooseView = (next: AtumFileView) => {
    setView(next)

    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // A disabled storage backend must not make the file browser unusable.
    }
  }

  const visitDirectory = (next: string) => {
    if (!next || next === directory) {
      return
    }

    setHistory(current => [...current, directory].filter(Boolean))
    setDirectory(next)
  }

  const goBack = () => {
    setHistory(current => {
      const next = current.at(-1)

      if (next) {
        setDirectory(next)
      }

      return next ? current.slice(0, -1) : current
    })
  }

  const openFile = async (entry: HermesReadDirEntry) => {
    if (entry.isDirectory) {
      visitDirectory(entry.path)

      return
    }

    setOpeningPath(entry.path)
    setOpenError(false)

    try {
      const target = await normalizeOrLocalPreviewTarget(entry.path, directory)

      if (!target) {
        setOpenError(true)

        return
      }

      setCurrentSessionPreviewTarget(target, 'file-browser', entry.path)
      setWorkspaceTab('view')
    } catch {
      setOpenError(true)
    } finally {
      setOpeningPath(null)
    }
  }

  if (!cwd) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <IconFolder aria-hidden className="mx-auto size-9 text-(--atum-ink-faint)" stroke={1.35} />
          <p className="mt-3 text-[13px] font-medium text-(--atum-ink)">{t.atum.workspace.filesNoFolder}</p>
          <p className="mt-1 text-[12px] leading-5 text-(--atum-ink-muted)">{t.atum.workspace.filesNoFolderHint}</p>
        </div>
      </div>
    )
  }

  return (
    <section aria-busy={loading} aria-label={t.atum.workspace.tabFiles} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-(--atum-line) px-2 py-2">
        <Tip label={t.atum.workspace.filesBack}>
          <Button
            aria-label={t.atum.workspace.filesBack}
            disabled={history.length === 0}
            onClick={goBack}
            size="icon-xs"
            variant="ghost"
          >
            <IconChevronLeft />
          </Button>
        </Tip>
        <Tip label={t.atum.workspace.filesUp}>
          <Button
            aria-label={t.atum.workspace.filesUp}
            disabled={!parent}
            onClick={() => parent && visitDirectory(parent)}
            size="icon-xs"
            variant="ghost"
          >
            <IconArrowUp />
          </Button>
        </Tip>

        <div className="min-w-0 flex-1 px-1 text-center text-[12px] font-medium text-(--atum-ink)">
          <span className="block truncate">{folderName(directory) || t.atum.workspace.filesRoot}</span>
        </div>

        <div
          aria-label={t.atum.workspace.filesView}
          className="flex rounded-[var(--atum-r-sm)] bg-(--atum-sunk) p-0.5"
          role="group"
        >
          <Tip label={t.atum.workspace.filesGrid}>
            <Button
              aria-label={t.atum.workspace.filesGrid}
              aria-pressed={view === 'grid'}
              className={cn(view === 'grid' && 'bg-(--atum-card) text-(--atum-ink) shadow-(--atum-shadow-row)')}
              onClick={() => chooseView('grid')}
              size="icon-xs"
              variant="ghost"
            >
              <IconLayoutGrid />
            </Button>
          </Tip>
          <Tip label={t.atum.workspace.filesList}>
            <Button
              aria-label={t.atum.workspace.filesList}
              aria-pressed={view === 'list'}
              className={cn(view === 'list' && 'bg-(--atum-card) text-(--atum-ink) shadow-(--atum-shadow-row)')}
              onClick={() => chooseView('list')}
              size="icon-xs"
              variant="ghost"
            >
              <IconList />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {openError ? (
          <div
            className="mb-3 rounded-[var(--atum-r-row)] border border-(--atum-line-strong) bg-(--atum-card) px-3 py-2 text-[12px] text-(--atum-ink-muted)"
            role="alert"
          >
            {t.atum.workspace.filesOpenError}
          </div>
        ) : null}
        {loading ? (
          <AtumFilesState>{t.atum.workspace.filesLoading}</AtumFilesState>
        ) : error ? (
          <AtumFilesState>
            <span>{t.atum.workspace.filesError}</span>
            <Button className="mt-3" onClick={() => setReloadNonce(value => value + 1)} size="xs" variant="secondary">
              {t.atum.workspace.filesRetry}
            </Button>
          </AtumFilesState>
        ) : entries.length === 0 ? (
          <AtumFilesState>{t.atum.workspace.filesEmpty}</AtumFilesState>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] content-start gap-x-2 gap-y-4">
            {entries.map(entry => (
              <FileEntryButton
                entry={entry}
                key={entry.path}
                loading={openingPath === entry.path}
                onActivate={openFile}
                view="grid"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {entries.map(entry => (
              <FileEntryButton
                entry={entry}
                key={entry.path}
                loading={openingPath === entry.path}
                onActivate={openFile}
                view="list"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function AtumFilesState({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full min-h-40 place-items-center px-4 text-center text-[12px] leading-5 text-(--atum-ink-muted)">
      <div>{children}</div>
    </div>
  )
}

function FileEntryButton({
  entry,
  loading,
  onActivate,
  view
}: {
  entry: HermesReadDirEntry
  loading: boolean
  onActivate: (entry: HermesReadDirEntry) => void
  view: AtumFileView
}) {
  const Icon = entry.isDirectory ? IconFolder : IconFile

  return (
    <button
      aria-label={entry.name}
      className={cn(
        'group min-w-0 rounded-[var(--atum-r-row)] text-(--atum-ink) transition-colors hover:bg-(--atum-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--atum-focus)',
        view === 'grid'
          ? 'flex flex-col items-center gap-2 px-1.5 py-3 text-center'
          : 'flex w-full items-center gap-2.5 px-2.5 py-2 text-left',
        loading && 'opacity-60'
      )}
      disabled={loading}
      onClick={() => onActivate(entry)}
      type="button"
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center text-(--atum-ink-soft)',
          view === 'grid' ? 'size-11' : 'size-7'
        )}
      >
        <Icon
          aria-hidden
          className={view === 'grid' ? 'size-9' : 'size-5'}
          fill={entry.isDirectory ? 'currentColor' : 'none'}
          stroke={entry.isDirectory ? 1 : 1.4}
        />
      </span>
      <span className={cn('text-[12px] leading-4', view === 'grid' ? 'line-clamp-2 break-words' : 'truncate')}>
        {entry.name}
      </span>
    </button>
  )
}
