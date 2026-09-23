// PresentedFiles: the explicit-delivery section of the turn-tail row.
//
// dsh's `present` tool appends `deliverables/presented` for every file the
// model declares as a final deliverable, and the built-in ui-deliverables row
// renders those as cards. This plugin's card claims the same turn-tail row, so
// without this section the delivery cards would be swallowed on every turn
// that also wrote files. The section mirrors the built-in card's layout
// metrics and interaction contract — Sidebar preview on the card, a split Open
// control with default-application and file-manager actions, one full-width
// row for a single delivery and a two-column grid beyond four — while routing
// the preview through this plugin's own Sidebar pipeline.
//
// 0.1.7 共享文件动作子槽（deliverables.file.actions）：原生交付卡把每个文件
// 的动作位交给该子槽，由 ui-open-in-app 贡献「用其它应用打开 / 显示文件位置」
// 控件（应用清单 + 图标 + 揭示）。本卡片的动作位同样逐文件渲染这个子槽
// （见 PresentedCard 的 actions 计算），owner props 与 fork 逐字对齐：
// actionUrl / available / pending / onAction。与上游的差异（同一契约、不同
// 载体）：上游卡片只有子槽、没有自带控件；本插件在 KCoder 部署下必须能脱离
// ui-open-in-app 独立工作，因此把自己的分体控件作为该子槽的 fallback 传入
// ——有贡献者时由共享控件接管动作位（不出现两套打开按钮），没有时保持既有
// 行为不变（0.1.7 之前、以及未装 ui-open-in-app 的载具）。
//
// Only TYPE imports come from @deepseek-ai packages (see index.tsx): the
// native actions go through the Host's own authenticated routes
// (present-open.ts), so this file stays version-tolerant and dependency-free.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileActionsRenderFace } from './dsh-contracts.ts'
import {
  cleanDescription, extensionOf, basename, type PresentedPath,
} from './turn-deliverables.ts'
import {
  presentedFileUrl,
  type PresentedAction, type PresentedHostState, type PresentedOpenController,
  type PresentedOpenFailure, type PresentedOpenPhase,
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
  /**
   * Bound render face of the `deliverables.file.actions` child slot this
   * plugin's turn-tail registration declares (dsh 0.1.7), narrowed to the one
   * key it may render. Absent on carriers without the renderer-owned child
   * slots — and on a registration that had to fall back to declaring no
   * children (see index.tsx) — where the card keeps its own control only.
   */
  renderSlot?: FileActionsRenderFace | undefined
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

/**
 * This plugin's own native-open control: the split primary + application /
 * reveal menu the card has always rendered, with its own gesture latch.
 *
 * It is the FALLBACK BODY of the `deliverables.file.actions` child slot (see
 * PresentedCard): when the shared contribution is absent — a carrier without
 * ui-open-in-app, or any dsh before 0.1.7 — the action position keeps exactly
 * this control. Owning the menu state here (rather than in the card) keeps a
 * menu from surviving a swap between this control and the contributed one.
 */
function PresentedNativeControl({ file, phase, writable, reveal, onPreview, onAction, t }: {
  file: PresentedPath
  phase: PresentedOpenPhase | undefined
  writable: boolean
  reveal: 'finder' | 'explorer' | 'directory'
  onPreview: () => void
  onAction: (action: PresentedAction, application?: string) => Promise<PresentedOpenFailure>
} & PropsLocale<typeof NS>) {
  const [menuOpen, setMenuOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLButtonElement>(null)
  const pending = phase === 'opening' || phase === 'revealing'
  const menuDisabled = pending || !writable
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
    // The card's status line is driven by the controller's published phase, so
    // the gesture's own failure report is deliberately unobserved here.
    void onAction(action).catch(() => {})
  }

  return (
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
  )
}

/** One delivery card: Sidebar preview under the contributed or fallback action control. */
function PresentedCard({
  file, sessionId, cwd, phase, host, renderSlot, onPreview, onAction, t,
}: {
  file: PresentedPath
  sessionId: string
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHostState
  renderSlot?: FileActionsRenderFace | undefined
  onPreview: () => void
  onAction: (action: PresentedAction, application?: string) => Promise<PresentedOpenFailure>
} & PropsLocale<typeof NS>) {
  const pending = phase === 'opening' || phase === 'revealing'
  const writable = host !== null && host !== 'error' && host !== 'absent' && host.available
  const reveal = host !== null && host !== 'error' && host !== 'absent'
    ? host.fileManager ?? 'directory'
    : 'directory'

  const name = basename(file.path)
  const status = statusOf(phase, reveal, file, name, t)
  const failed = phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable'

  // Per-file action position. The owner props are the 0.1.7 contract verbatim
  // (dsh-contracts.FileActionOwnerProps ← fork file-actions.ts:8-19); the
  // fallback is this plugin's own control, so the position stays populated on
  // every carrier that does not contribute to the slot.
  const actionUrl = presentedFileUrl(sessionId, file.seq, file.index)
  const fallback = (
    <PresentedNativeControl
      file={file}
      phase={phase}
      writable={writable}
      reveal={reveal}
      onPreview={onPreview}
      onAction={onAction}
      t={t}
    />
  )
  const actions: ReactNode = renderSlot === undefined ? fallback : renderSlot(
    'deliverables.file.actions',
    { actionUrl, available: writable, pending, onAction },
    { fallback },
  )

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
        {/* Action position: the shared child slot's outlet is display:contents,
            so this wrapper is what re-enables pointer events for the
            contributed control (the fallback carries its own). */}
        <div className={css.actions}>{actions}</div>
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
  files, sessionId, projectRoot, onPreview, controller, renderSlot, t,
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
            sessionId={sessionId}
            cwd={projectRoot}
            phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
            host={host}
            renderSlot={renderSlot}
            onPreview={() => { onPreview(file.path) }}
            onAction={(action, application) => controller === undefined
              ? Promise.resolve(null)
              : controller.open(sessionId, file.seq, file.index, action, application)}
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
