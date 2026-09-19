/**
 * Non-code produced-file vocabulary: kind classification by extension and
 * conservative bash/pwsh artifact capture. The turn-tail card and the sidebar
 * tab route these paths to dsh-coding-sidebar's file-viewer pipeline
 * (`betterSidebar.openFile` → editor tab → matchFileViewer: image / pdf /
 * markdown / html built-ins, office/video via its viewer plugins) instead of
 * the diff review — an image or a .docx has no reversible text hunks to show.
 *
 * Capture is deliberately CONSERVATIVE: only well-known artifact extensions
 * behind unambiguous shell output indicators (redirects, curl/wget output
 * flags, cp/mv final argument, tee). Plain code commands never match, so the
 * change lists cannot fill with false positives.
 */
/** Non-code artifact classes the review surfaces can badge and preview. */
export type ArtifactKind = 'image' | 'video' | 'audio' | 'office' | 'pdf' | 'doc';
/**
 * Classify a produced path. Returns 'code' for everything that is not a
 * known artifact extension — the caller keeps the diff-review behavior for
 * 'code' unchanged.
 */
export declare function classifyPath(path: string): ArtifactKind | 'code';
/** One artifact path a captured shell command is judged to create. */
export interface CapturedArtifact {
    readonly path: string;
    readonly artifact: ArtifactKind;
}
/**
 * Artifact files one mutation-tool call creates, judged from its OWN
 * arguments — the same argument-contract philosophy as mutationDetail, with
 * a much tighter net: the tool must be a shell, and every candidate target
 * must carry a known artifact extension. Order is first-seen; duplicates
 * collapse.
 */
export declare function captureArtifacts(name: string, argsRaw: string): readonly CapturedArtifact[];
//# sourceMappingURL=artifacts.d.ts.map