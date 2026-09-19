// PresentedFiles: the explicit-delivery section of the turn-tail row.
//
// dsh's `present` tool appends `deliverables/presented` for every file the
// model declares as a final deliverable, and the built-in ui-deliverables row
// renders those as cards. This plugin's card claims the same turn-tail CHAIN
// (first non-null selector wins, exactly one row renders), so without this
// section the new delivery cards would be swallowed on every turn that also
// wrote files. The section mirrors the built-in card's layout metrics and
// interaction contract — Sidebar preview on the card, a split Open control
// with default-application and file-manager actions, one full-width row for a
// single delivery and a two-column grid beyond four — while routing the
// preview through this plugin's own Sidebar pipeline.
//
// Only TYPE imports come from @deepseek-ai packages (see index.tsx): the
// native actions go through the Host's own authenticated routes
// (present-open.ts), so this file stays version-tolerant and dependency-free.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  cleanDescription, extensionOf, basename, type PresentedPath,
} from './turn-deliverables.ts'
import {
  presentedFileUrl,
  type PresentedAction, type PresentedHostState, type PresentedOpenController, type PresentedOpenPhase,
} from './present-open.ts'
import type { DeliverablesKey, NS } from './chat-locales.ts'
import css from './PresentedFiles.module.css'

/** A list longer than this starts collapsed behind an expand control. */
const COLLAPSED_COUNT = 4

/** useSyncExternalStore fallbacks for the controller-less (older) carriers. */
const subscribeNever = (): (() => void) => () => {}
const NO_STATES: Readonly<Record<string, PresentedOpenPhase | undefined>> = {}
const getNoStates = (): Readonly<Record<string, PresentedOpenPhase | undefined>> => NO_STATES
const getNoHost = (): PresentedHostState => 'absent'

/** Props supplied by the plugin's slot registration. */
export type PresentedFilesProps = {
  /** Deliveries the closing turn declared, in first-seen path order. */
  files: readonly PresentedPath[]
  /** Viewed Session; addresses the Host's authenticated native-open route. */
  sessionId: string
  /** Session workspace root, used for the card's full-path title. */
  projectRoot?: string | undefined
  /** Open the file in the Sidebar viewer pipeline (Host opener as fallback). */
  onPreview: (path: string) => void
  /** Native-open controller; absent on carriers without the delivery routes. */
  controller?: PresentedOpenController | undefined
} & PropsLocale<typeof NS>

/**
 * Resolve a (possibly relative) delivery path against the Session cwd for the
 * card's title and the Host-side stat. Mirrors the Sidebar's own resolver:
 * POSIX roots, drive letters, and UNC shares must not be joined onto the cwd.
 */
function resolvePresentedPath(cwd: string | undefined, path: string): string {
  if (/^(?:[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(path)) return path
  if (cwd === undefined || cwd === '') return path
  const separator = cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[\\/]+$/, '')}${separator}${path}`
}

/** The card's secondary line: the phase status, or the description it replaces. */
function statusOf(
  phase: PresentedOpenPhase | undefined,
  reveal: 'finder' | 'explorer' | 'directory',
  file: PresentedPath,
  name: string,
  t: (key: DeliverablesKey, params?: Record<string, unknown>) => string,
): string {
  if (phase !== undefined) {
    const directory = reveal === 'directory'
    if (directory && phase === 'revealed') return t('presented.directoryOpened')
    if (directory && phase === 'revealing') return t('presented.directoryOpening')
    if (directory && phase === 'revealError') return t('presented.directoryError')
    return t(`presented.${phase}` as DeliverablesKey)
  }
  const described = cleanDescription(file.description)
  if (described !== undefined) return described
  const extension = extensionOf(name)
  return extension === '' ? t('presented.file') : extension
}

/** A modest document glyph; no shared icon package is imported on purpose. */
function FileGlyph() {
  return (
    <svg className={css.glyph} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
      <path d="M11.25 2.75v3.5h3.5" />
    </svg>
  )
}

/** One delivery card: Sidebar preview under a split native-open control. */
function PresentedCard({ file, cwd, phase, host, onPreview, onAction, t }: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHostState
  onPreview: () => void
  onAction: (action: PresentedAction) => void
} & PropsLocale<typeof NS>) {
  const [menuOpen, setMenuOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLButtonElement>(null)
  const pending = phase === 'opening' || phase === 'revealing'
  const writable = host !== null && host !== 'error' && host !== 'absent' && host.available
  const menuDisabled = pending || !writable
  const reveal = host !== null && host !== 'error' && host !== 'absent'
    ? host.fileManager ?? 'directory'
    : 'directory'
  // A menu that can no longer act (the desktop vanished, a gesture started)
  // must not stay open above a disabled chevron.
  if (menuDisabled && menuOpen) setMenuOpen(false)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (splitRef.current?.contains(event.target as Node) === true) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      previewRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const act = (action: PresentedAction): void => {
    setMenuOpen(false)
    previewRef.current?.focus()
    onAction(action)
  }

  const name = basename(file.path)
  const status = statusOf(phase, reveal, file, name, t)
  const failed = phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable'

  return (
    <div className={css.file} data-presented-file>
      <button
        type="button"
        className={css.cardPreview}
        title={resolvePresentedPath(cwd, file.path)}
        aria-label={t('presented.previewCard', { name: file.path })}
        onClick={onPreview}
      />
      <span className={css.fileIcon}><FileGlyph /></span>
      <div className={css.fileBody}>
        <div className={css.details}>
          <span className={css.fileName}>{name}</span>
          <span className={css.description} role={phase === undefined ? undefined : 'status'} data-error={failed || undefined}>
            <span className={css.secondaryText}>{status}</span>
            <span className={css.previewHint}>{t('presented.preview')}</span>
          </span>
        </div>
        <div className={css.split} ref={splitRef}>
          <button
            ref={previewRef}
            type="button"
            className={css.open}
            aria-label={t('presented.previewButton', { name: file.path })}
            onClick={onPreview}
          >
            {t('presented.action')}
          </button>
          <button
            type="button"
            className={css.chevron}
            disabled={menuDisabled}
            aria-haspopup="menu"
            aria-expanded={menuOpen && !menuDisabled}
            aria-label={t('presented.more', { name: file.path })}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <svg className={css.chevronGlyph} viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 5.25 7 8.75l3.5-3.5" />
            </svg>
          </button>
          {menuOpen && !menuDisabled && (
            <div className={css.menu} role="menu">
              <button type="button" role="menuitem" className={css.menuItem} onClick={() => { act('open') }}>
                <svg className={css.menuIcon} viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3.5h6.5V10M12.5 3.5 6.5 9.5M11 9.5v3H3.5v-7.5H7" />
                </svg>
                {t('presented.defaultApp')}
              </button>
              <button type="button" role="menuitem" className={css.menuItem} onClick={() => { act('reveal') }}>
                <svg className={css.menuIcon} viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M1.75 4.25h4l1.25 1.5h7.25v6.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
                </svg>
                {t(`presented.${reveal}` as DeliverablesKey)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The closing turn's explicit deliveries.
 * @param props - deliveries, Session scope, preview route, and native controller.
 * @returns the delivery section, or null when the turn declared none.
 */
export function PresentedFiles({
  files, sessionId, projectRoot, onPreview, controller, t,
}: PresentedFilesProps) {
  const [expanded, setExpanded] = useState(false)
  // Both stores are read through stable module-level fallbacks when the
  // carrier has no controller: a fresh object per render would loop the hook.
  const states = useSyncExternalStore(
    controller?.state.subscribe ?? subscribeNever,
    controller?.state.getSnapshot ?? getNoStates,
  )
  const host = useSyncExternalStore(
    controller?.host.subscribe ?? subscribeNever,
    controller?.host.getSnapshot ?? getNoHost,
  )
  const readableHost = host === 'error' || host === 'absent' ? null : host

  // Desktop metadata is read when cards appear and never re-probed after the
  // Host answered 404 (the controller owns that latch).
  useEffect(() => {
    if (controller === undefined || files.length === 0 || host !== null) return
    void controller.loadHost()
  }, [controller, files.length, host])

  if (files.length === 0) return null
  const collapsible = files.length > COLLAPSED_COUNT
  const shown = collapsible && !expanded ? files.slice(0, COLLAPSED_COUNT) : files

  return (
    <section className={css.root} aria-label={t('presented.summary')}>
      {host === 'error' && (
        <div className={css.hostStatus}>
          <span>{t('presented.hostError')}</span>
          <button type="button" className={css.retry} onClick={() => { void controller?.loadHost() }}>
            {t('presented.retry')}
          </button>
        </div>
      )}
      {readableHost !== null && !readableHost.available && (
        <span className={css.hostStatus}>{t('presented.unavailable')}</span>
      )}
      <div className={css.grid} data-presented-files-row data-single={files.length === 1 || undefined}>
        {shown.map(file => (
          <PresentedCard
            key={`${file.seq}:${file.index}:${file.path}`}
            file={file}
            cwd={projectRoot}
            phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
            host={host}
            onPreview={() => { onPreview(file.path) }}
            onAction={(action) => { void controller?.open(sessionId, file.seq, file.index, action) }}
            t={t}
          />
        ))}
      </div>
      {collapsible && (
        <button
          type="button"
          className={css.toggle}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'presented.collapseAria' : 'presented.expandAria', { count: String(files.length) })}
          onClick={() => { setExpanded(value => !value) }}
        >
          {expanded
            ? t('presented.collapse')
            : t('presented.all', { count: String(files.length) })}
        </button>
      )}
    </section>
  )
}
