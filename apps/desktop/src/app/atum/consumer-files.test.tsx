import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesReadDirResult } from '@/global'

const readDesktopDir = vi.fn<(path: string) => Promise<HermesReadDirResult>>()
const normalizeOrLocalPreviewTarget = vi.fn()
const setCurrentSessionPreviewTarget = vi.fn()

vi.mock('@/lib/desktop-fs', () => ({ readDesktopDir }))
vi.mock('@/lib/local-preview', () => ({ normalizeOrLocalPreviewTarget }))
vi.mock('@/store/preview', () => ({ setCurrentSessionPreviewTarget }))

const { $currentCwd } = await import('@/store/session')
const { $workspaceTab, resetAtumShellState } = await import('@/store/atum-shell')
const { AtumConsumerFiles, consumerVisibleEntries, folderName, parentDirectory } = await import('./consumer-files')

function result(entries: HermesReadDirResult['entries']): HermesReadDirResult {
  return { entries }
}

describe('AtumConsumerFiles', () => {
  beforeEach(() => {
    localStorage.clear()
    resetAtumShellState()
    readDesktopDir.mockReset()
    normalizeOrLocalPreviewTarget.mockReset()
    setCurrentSessionPreviewTarget.mockReset()
    $currentCwd.set('/Users/minh')
  })

  afterEach(cleanup)

  it('starts in a Finder-like icon grid and defensively hides every dot entry', async () => {
    readDesktopDir.mockResolvedValue(
      result([
        { isDirectory: false, name: '.env.local', path: '/Users/minh/.env.local' },
        { isDirectory: false, name: 'notes.txt', path: '/Users/minh/notes.txt' },
        { isDirectory: true, name: 'Documents', path: '/Users/minh/Documents' }
      ])
    )

    render(<AtumConsumerFiles />)

    expect(await screen.findByRole('button', { name: 'Documents' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'notes.txt' })).toBeTruthy()
    expect(screen.queryByText('.env.local')).toBeNull()
    expect(screen.getByRole('button', { name: 'Icons' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('navigates into folders and offers both back and parent navigation', async () => {
    readDesktopDir.mockImplementation(async path =>
      path === '/Users/minh'
        ? result([{ isDirectory: true, name: 'Documents', path: '/Users/minh/Documents' }])
        : result([{ isDirectory: false, name: 'letter.txt', path: `${path}/letter.txt` }])
    )

    render(<AtumConsumerFiles />)
    fireEvent.click(await screen.findByRole('button', { name: 'Documents' }))

    await waitFor(() => expect(readDesktopDir).toHaveBeenCalledWith('/Users/minh/Documents'))
    expect(await screen.findByText('letter.txt')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(readDesktopDir).toHaveBeenLastCalledWith('/Users/minh'))

    fireEvent.click(screen.getByRole('button', { name: 'Up one folder' }))
    await waitFor(() => expect(readDesktopDir).toHaveBeenLastCalledWith('/Users'))
  })

  it('switches to a persistent compact list', async () => {
    readDesktopDir.mockResolvedValue(result([{ isDirectory: false, name: 'notes.txt', path: '/Users/minh/notes.txt' }]))

    render(<AtumConsumerFiles />)
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))

    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('hermes.desktop.atum.fileView')).toBe('list')
  })

  it('opens files through the existing preview pipeline and changes to View', async () => {
    const target = {
      kind: 'file',
      label: 'notes.txt',
      path: '/Users/minh/notes.txt',
      previewKind: 'text',
      source: '/Users/minh/notes.txt',
      url: 'file:///Users/minh/notes.txt'
    }

    readDesktopDir.mockResolvedValue(result([{ isDirectory: false, name: 'notes.txt', path: '/Users/minh/notes.txt' }]))
    normalizeOrLocalPreviewTarget.mockResolvedValue(target)
    $workspaceTab.set('files')

    render(<AtumConsumerFiles />)
    fireEvent.click(await screen.findByRole('button', { name: 'notes.txt' }))

    await waitFor(() => {
      expect(normalizeOrLocalPreviewTarget).toHaveBeenCalledWith('/Users/minh/notes.txt', '/Users/minh')
      expect(setCurrentSessionPreviewTarget).toHaveBeenCalledWith(target, 'file-browser', '/Users/minh/notes.txt')
      expect($workspaceTab.get()).toBe('view')
    })
  })

  it('keeps a valid folder listing visible when one file cannot open', async () => {
    readDesktopDir.mockResolvedValue(result([{ isDirectory: false, name: 'notes.txt', path: '/Users/minh/notes.txt' }]))
    normalizeOrLocalPreviewTarget.mockRejectedValue(new Error('preview failed'))

    render(<AtumConsumerFiles />)
    fireEvent.click(await screen.findByRole('button', { name: 'notes.txt' }))

    expect(await screen.findByText("Couldn't open this file.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'notes.txt' })).toBeTruthy()
    expect(screen.queryByText("Couldn't open this folder.")).toBeNull()
  })

  it('renders honest loading, error, retry, and empty states without exposing error codes', async () => {
    let rejectRead: ((reason?: unknown) => void) | undefined

    readDesktopDir.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject
        })
    )

    render(<AtumConsumerFiles />)
    expect(screen.getByText('Opening folder…')).toBeTruthy()

    rejectRead?.(new Error('EACCES /Users/minh'))
    expect(await screen.findByText("Couldn't open this folder.")).toBeTruthy()
    expect(screen.queryByText(/EACCES/u)).toBeNull()

    readDesktopDir.mockResolvedValueOnce(result([]))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('This folder is empty')).toBeTruthy()
  })

  it('explains the no-folder state without calling the bridge', () => {
    $currentCwd.set('')

    render(<AtumConsumerFiles />)

    expect(screen.getByText('No folder is open')).toBeTruthy()
    expect(readDesktopDir).not.toHaveBeenCalled()
  })
})

describe('Atum consumer file path helpers', () => {
  it('handles POSIX and Windows parents and labels', () => {
    expect(parentDirectory('/Users/minh/Documents/')).toBe('/Users/minh')
    expect(parentDirectory('/')).toBeNull()
    expect(parentDirectory('C:\\Users\\minh')).toBe('C:\\Users')
    expect(parentDirectory('C:\\')).toBeNull()
    expect(folderName('/Users/minh/Documents/')).toBe('Documents')
  })

  it('filters dot entries and sorts folders before files', () => {
    expect(
      consumerVisibleEntries([
        { isDirectory: false, name: 'b.txt', path: '/b.txt' },
        { isDirectory: true, name: 'Folder', path: '/Folder' },
        { isDirectory: false, name: '.secret', path: '/.secret' },
        { isDirectory: false, name: 'a.txt', path: '/a.txt' }
      ]).map(entry => entry.name)
    ).toEqual(['Folder', 'a.txt', 'b.txt'])
  })
})
