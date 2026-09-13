/**
 * Native-open plumbing for declared deliveries.
 *
 * The delivery cards must be able to (a) preview a file in the Sidebar and
 * (b) hand it to the Host desktop (default application / file manager). This
 * plugin owns only (a) through dsh-coding-sidebar; (b) is a Host capability
 * that the built-in ui-deliverables host half already exposes as two
 * authenticated same-origin routes:
 *
 *   GET  /api/present.host                    → desktop availability + file manager
 *   POST /api/present.open?sessionId&seq&index[&action=reveal]
 *
 * Those routes are addressed by URL on purpose instead of imported: this
 * plugin's client half deliberately keeps only TYPE imports from the
 * @deepseek-ai UI packages (see index.tsx), because the versions it supports
 * span releases in which the runtime exports of those packages moved. A route
 * is therefore used best-effort and degrades in two steps:
 *
 *   - 404 on the metadata route  → 'absent': the carrier does not ship the
 *     present feature at all, so the native actions are not rendered and the
 *     card keeps the Sidebar preview.
 *   - any other failure / 422    → 'error' / 'nativeUnavailable': the card
 *     shows the retryable state, exactly like the built-in row.
 */
/** Native file action selected by an explicit user gesture. */
export type PresentedAction = 'open' | 'reveal';
/** State of the latest explicit open gesture for one delivered file. */
export type PresentedOpenPhase = 'opening' | 'opened' | 'error' | 'revealing' | 'revealed' | 'revealError' | 'nativeUnavailable';
/** Serving Host information; file-manager names never derive from the browser's OS. */
export interface PresentedHost {
    readonly name: string;
    readonly available: boolean;
    readonly fileManager: 'finder' | 'explorer' | 'directory' | null;
}
/**
 * Metadata read result. `'absent'` means the carrier has no present routes at
 * all — a permanent condition, unlike the retryable `'error'`.
 */
export type PresentedHostState = PresentedHost | 'error' | 'absent' | null;
/** Minimal immutable snapshot store, the shape useSyncExternalStore expects. */
interface Store<T> {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
    set(value: T): void;
}
/**
 * Same-origin action URL, keyed by the viewed Session's delivery coordinates.
 * Also the card's status key: the same file reached from two surfaces shares
 * one pending/acknowledged phase.
 * @param sessionId - viewed Session.
 * @param seq - durable delivery event sequence.
 * @param index - original file index within that event.
 * @returns the authenticated action URL.
 */
export declare function presentedFileUrl(sessionId: string, seq: number, index: number): string;
/**
 * One browser plugin's native-open requests, cancelled when that plugin is
 * disposed. Mirrors the built-in PresentedOpenController's observable shape
 * so the card's status line and pending states behave identically.
 */
export declare class PresentedOpenController {
    /** File action URLs key the state across Sessions, turns, and both clickable surfaces. */
    readonly state: Store<Record<string, PresentedOpenPhase | undefined>>;
    /** Native destination metadata, a retryable read failure, or an absent carrier. */
    readonly host: Store<PresentedHostState>;
    private loading;
    private metadata;
    private readonly lifetime;
    private readonly pending;
    /**
     * Open a declared file once while a request for the same coordinates is
     * pending. Failures stay visible on the card and a later gesture retries.
     * @param sessionId - viewed Session, including a fork's own identity.
     * @param seq - durable delivery event sequence.
     * @param index - original file index within that event.
     * @param action - default-application open or file-manager reveal.
     * @returns after the Host acknowledges the action or the error state is published.
     */
    open(sessionId: string, seq: number, index: number, action?: PresentedAction): Promise<void>;
    /**
     * Read the serving desktop metadata, coalescing concurrent reads.
     * @returns after metadata, a retryable error, or 'absent' is published.
     */
    loadHost(): Promise<void>;
    /**
     * Invalidate cached metadata after a connection replacement. `'absent'`
     * survives: the composed plugin roster does not change with a reconnect.
     */
    resetHost(): void;
    /** Cancel outstanding requests and wait until no request can publish state. */
    dispose(): Promise<void>;
    private readHost;
    private request;
}
export {};
//# sourceMappingURL=present-open.d.ts.map