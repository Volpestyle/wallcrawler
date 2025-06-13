import { CDPSession, Frame } from 'playwright';
import {
  AXNode,
  AccessibilityNode,
  TreeResult,
  DOMNode,
  BackendIdMaps,
  EncodedId,
  CdpFrameTree,
  FrameOwnerResult,
  CombinedA11yResult,
  FrameSnapshot,
  RichNode,
  ID_PATTERN,
} from '../types/cdp';
import { WallCrawlerPage } from '../types/page';
import { createLogger } from '../utils/logger';
import {
  WallCrawlerIframeError,
  WallCrawlerDomProcessError,
  ElementNotFoundError,
  ContentFrameNotFoundError,
  XPathResolutionError,
} from '../types/errors';

const logger = createLogger('dom');

const IFRAME_STEP_RE = /iframe\[\d+]$/i;
const PUA_START = 0xe000;
const PUA_END = 0xf8ff;
const NBSP_CHARS = new Set<number>([0x00a0, 0x202f, 0x2007, 0xfeff]);

export interface ProcessedDOM {
  title: string;
  url: string;
  accessibility: TreeResult;
  timestamp: number;
}

export interface ProcessedElement {
  id: string;
  tagName: string;
  text?: string;
  value?: string;
  placeholder?: string;
  role?: string;
  name?: string;
  description?: string;
  selector: string;
  xpath: string;
  visible: boolean;
  interactive: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

export interface DOMProcessorOptions {
  includeAccessibility?: boolean;
  includeInvisible?: boolean;
  maxElements?: number;
  chunkSize?: number;
  selector?: string;
  targetFrame?: Frame;
}

/**
 * Clean a string by removing private-use unicode characters, normalizing whitespace,
 * and trimming the result.
 */
export function cleanText(input: string): string {
  let out = '';
  let prevWasSpace = false;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    // Skip private-use area glyphs
    if (code >= PUA_START && code <= PUA_END) {
      continue;
    }

    // Convert NBSP-family characters to a single space, collapsing repeats
    if (NBSP_CHARS.has(code)) {
      if (!prevWasSpace) {
        out += ' ';
        prevWasSpace = true;
      }
      continue;
    }

    // Append the character and update space tracker
    out += input[i];
    prevWasSpace = input[i] === ' ';
  }

  // Trim leading/trailing spaces before returning
  return out.trim();
}

/**
 * Generate a human-readable, indented outline of an accessibility node tree.
 */
export function formatSimplifiedTree(
  node: AccessibilityNode & { encodedId?: EncodedId },
  level = 0
): string {
  // Compute indentation based on depth level
  const indent = '  '.repeat(level);

  // Use encodedId if available, otherwise fallback to nodeId
  const idLabel = node.encodedId ?? node.nodeId;

  // Prepare the formatted name segment if present
  const namePart = node.name ? `: ${cleanText(node.name)}` : '';

  // Build current line and recurse into child nodes
  const currentLine = `${indent}[${idLabel}] ${node.role}${namePart}\n`;
  const childrenLines =
    node.children
      ?.map((c) => formatSimplifiedTree(c as typeof node, level + 1))
      .join('') ?? '';

  return currentLine + childrenLines;
}

const lowerCache = new Map<string, string>();

/**
 * Memoized lowercase conversion for strings to avoid repeated .toLowerCase() calls.
 */
const lc = (raw: string): string => {
  let v = lowerCache.get(raw);
  if (!v) {
    v = raw.toLowerCase();
    lowerCache.set(raw, v);
  }
  return v;
};

export class DOMProcessor {
  constructor(private wallCrawlerPage: WallCrawlerPage) {}

  async getProcessedDOM(
    options: DOMProcessorOptions = {}
  ): Promise<ProcessedDOM> {
    const { includeAccessibility = true, selector, targetFrame } = options;

    logger.debug('Processing DOM', options);

    try {
      // Get page metadata
      const title = await this.wallCrawlerPage.title();
      const url = this.wallCrawlerPage.url();

      // Get accessibility tree if requested
      let accessibility: TreeResult;
      if (includeAccessibility) {
        accessibility = await this.getAccessibilityTree(selector, targetFrame);
      } else {
        accessibility = {
          tree: [],
          simplified: '',
          idToUrl: {},
          xpathMap: {},
        };
      }

      logger.info('DOM processed', {
        accessibilityNodeCount: accessibility.tree.length,
      });

      return {
        title,
        url,
        accessibility,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('Failed to process DOM', error);
      throw error;
    }
  }

  /**
   * Get combined accessibility tree with multi-frame support
   */
  async getAccessibilityTreeWithFrames(
    rootXPath?: string
  ): Promise<CombinedA11yResult> {
    return this.getAccessibilityTreeWithFramesInternal(rootXPath);
  }

  /**
   * Retrieve and build a cleaned accessibility tree for a document or specific iframe.
   */
  private async getAccessibilityTree(
    selector?: string,
    targetFrame?: Frame
  ): Promise<TreeResult> {
    // Build DOM helpers (maps, xpath)
    const { tagNameMap, xpathMap } = await this.buildBackendIdMaps(targetFrame);

    await this.wallCrawlerPage.enableCDP('Accessibility', targetFrame);

    try {
      // Decide params + session for the CDP call
      let params: Record<string, unknown> = {};
      let sessionFrame: Frame | undefined = targetFrame;

      if (targetFrame && targetFrame !== this.wallCrawlerPage.mainFrame()) {
        // Try opening a CDP session: succeeds only for OOPIFs
        let isOopif = true;
        try {
          await this.wallCrawlerPage.context().newCDPSession(targetFrame);
        } catch {
          isOopif = false;
        }

        if (!isOopif) {
          // Same-proc → use page session + { frameId }
          const frameId = await this.getCDPFrameId(targetFrame);
          logger.debug(
            `Same-proc iframe: frameId=${frameId}. Using existing CDP session.`
          );
          if (frameId) params = { frameId };
          sessionFrame = undefined; // page session
        } else {
          logger.debug(`OOPIF iframe: starting new CDP session`);
          params = {}; // no frameId allowed
          sessionFrame = targetFrame; // talk to OOPIF session
        }
      }

      // Fetch raw AX nodes
      const { nodes: fullNodes } = await this.wallCrawlerPage.sendCDP<{
        nodes: AXNode[];
      }>('Accessibility.getFullAXTree', params, sessionFrame);

      // Scrollable detection
      const scrollableIds = await this.findScrollableElementIds(targetFrame);

      // Filter by xpath if one is given
      let nodes = fullNodes;
      if (selector) {
        nodes = await this.filterAXTreeByXPath(
          fullNodes,
          selector,
          targetFrame
        );
      }

      // Build hierarchical tree
      const start = Date.now();
      const tree = await this.buildHierarchicalTree(
        this.decorateRoles(nodes, scrollableIds),
        tagNameMap,
        xpathMap
      );

      logger.debug(`Got accessibility tree in ${Date.now() - start} ms`);
      return tree;
    } finally {
      await this.wallCrawlerPage.disableCDP('Accessibility', targetFrame);
    }
  }

  /**
   * Build mappings from CDP backendNodeIds to HTML tag names and relative XPaths.
   */
  private async buildBackendIdMaps(
    targetFrame?: Frame
  ): Promise<BackendIdMaps> {
    // Choose CDP session
    let session: CDPSession;
    if (!targetFrame || targetFrame === this.wallCrawlerPage.mainFrame()) {
      session = await this.wallCrawlerPage.getCDPClient();
    } else {
      try {
        session = await this.wallCrawlerPage
          .context()
          .newCDPSession(targetFrame); // OOPIF
      } catch {
        session = await this.wallCrawlerPage.getCDPClient(); // same-proc iframe
      }
    }

    await this.wallCrawlerPage.enableCDP(
      'DOM',
      session === (await this.wallCrawlerPage.getCDPClient())
        ? undefined
        : targetFrame
    );

    try {
      // Full DOM tree
      const { root } = (await session.send('DOM.getDocument', {
        depth: -1,
        pierce: true,
      })) as { root: DOMNode };

      // Pick start node + root frame-id
      let startNode: DOMNode = root;
      let rootFid: string | undefined =
        targetFrame && (await this.getCDPFrameId(targetFrame));

      if (
        targetFrame &&
        targetFrame !== this.wallCrawlerPage.mainFrame() &&
        session === (await this.wallCrawlerPage.getCDPClient())
      ) {
        // Same-proc iframe: walk down to its contentDocument
        const frameId = rootFid!;
        const { backendNodeId } = await this.wallCrawlerPage.sendCDP<{
          backendNodeId: number;
        }>('DOM.getFrameOwner', { frameId });

        let iframeNode: DOMNode | undefined;
        const locate = (n: DOMNode): boolean => {
          if (n.backendNodeId === backendNodeId) return (iframeNode = n), true;
          return (
            (n.children?.some(locate) ?? false) ||
            (n.contentDocument ? locate(n.contentDocument) : false)
          );
        };

        if (!locate(root) || !iframeNode?.contentDocument) {
          throw new WallCrawlerIframeError(
            targetFrame?.url() || 'unknown',
            'iframe element or its contentDocument not found'
          );
        }
        startNode = iframeNode.contentDocument;
        rootFid = iframeNode.contentDocument.frameId ?? frameId;
      }

      // DFS walk: fill maps
      const tagNameMap: Record<EncodedId, string> = {};
      const xpathMap: Record<EncodedId, string> = {};

      interface StackEntry {
        node: DOMNode;
        path: string;
        fid: string | undefined; // CDP frame-id of this node's doc
      }
      const stack: StackEntry[] = [{ node: startNode, path: '', fid: rootFid }];
      const seen = new Set<EncodedId>();

      while (stack.length) {
        const { node, path, fid } = stack.pop()!;

        if (!node.backendNodeId) continue;
        const enc = this.wallCrawlerPage.encodeWithFrameId(
          fid,
          node.backendNodeId
        ) as EncodedId;
        if (seen.has(enc)) continue;
        seen.add(enc);

        tagNameMap[enc] = lc(String(node.nodeName));
        xpathMap[enc] = path;

        // Recurse into sub-document if <iframe>
        if (lc(String(node.nodeName)) === 'iframe' && node.contentDocument) {
          const childFid = node.contentDocument.frameId ?? fid;
          stack.push({ node: node.contentDocument, path: '', fid: childFid });
        }

        // Push children
        const kids = node.children ?? [];
        if (kids.length) {
          // Build per-child XPath segment (L→R)
          const segs: string[] = [];
          const ctr: Record<string, number> = {};
          for (const child of kids) {
            const tag = lc(String(child.nodeName));
            const key = `${child.nodeType}:${tag}`;
            const idx = (ctr[key] = (ctr[key] ?? 0) + 1);
            segs.push(
              child.nodeType === 3
                ? `text()[${idx}]`
                : child.nodeType === 8
                  ? `comment()[${idx}]`
                  : `${tag}[${idx}]`
            );
          }
          // Push R→L so traversal remains L→R
          for (let i = kids.length - 1; i >= 0; i--) {
            stack.push({
              node: kids[i]!,
              path: `${path}/${segs[i]}`,
              fid,
            });
          }
        }
      }

      return { tagNameMap, xpathMap };
    } finally {
      await this.wallCrawlerPage.disableCDP(
        'DOM',
        session === (await this.wallCrawlerPage.getCDPClient())
          ? undefined
          : targetFrame
      );
    }
  }

  /**
   * Convert a flat array of AccessibilityNodes into a cleaned, hierarchical tree.
   */
  private async buildHierarchicalTree(
    nodes: AccessibilityNode[],
    tagNameMap: Record<EncodedId, string>,
    xpathMap?: Record<EncodedId, string>
  ): Promise<TreeResult> {
    // EncodedId → URL (only if the backend-id is unique)
    const idToUrl: Record<EncodedId, string> = {};

    // nodeId (string) → mutable copy of the AX node we keep
    const nodeMap = new Map<string, RichNode>();

    // list of iframe AX nodes
    const iframeList: AccessibilityNode[] = [];

    // Helper: keep only roles that matter to the LLM
    const isInteractive = (n: AccessibilityNode) =>
      n.role !== 'none' && n.role !== 'generic' && n.role !== 'InlineTextBox';

    // Build "backendId → EncodedId[]" lookup from tagNameMap keys
    const backendToIds = new Map<number, EncodedId[]>();
    for (const enc of Object.keys(tagNameMap) as EncodedId[]) {
      const [, backend] = enc.split('-'); // "ff-bb"
      const list = backendToIds.get(+backend) ?? [];
      list.push(enc);
      backendToIds.set(+backend, list);
    }

    // Pass 1 – copy / filter CDP nodes we want to keep
    for (const node of nodes) {
      if (!node.nodeId || +node.nodeId < 0) continue; // skip pseudo-nodes

      const url = this.extractUrlFromAccessibilityNode(node);

      const keep =
        node.name?.trim() || node.childIds?.length || isInteractive(node);
      if (!keep) continue;

      // Resolve our EncodedId (unique per backendId)
      let encodedId: EncodedId | undefined;
      if (node.backendDOMNodeId !== undefined) {
        const matches = backendToIds.get(node.backendDOMNodeId) ?? [];
        if (matches.length === 1) encodedId = matches[0]; // unique → keep
        // if there are collisions we leave encodedId undefined; subtree
        // injection will fall back to backend-id matching
      }

      // Store URL only when we have an unambiguous EncodedId
      if (url && encodedId) idToUrl[encodedId] = url;

      if (!node.nodeId) continue;
      nodeMap.set(node.nodeId, {
        ...(encodedId ? { encodedId } : {}),
        role: node.role,
        nodeId: node.nodeId,
        ...(node.name && { name: node.name }),
        ...(node.description && { description: node.description }),
        ...(node.value && { value: node.value }),
        ...(node.backendDOMNodeId !== undefined && {
          backendDOMNodeId: node.backendDOMNodeId,
        }),
      });
    }

    // Pass 2 – parent-child wiring
    for (const node of nodes) {
      if (!node.nodeId) continue;
      if (node.role === 'Iframe')
        iframeList.push({ role: node.role, nodeId: node.nodeId });

      if (!node.parentId) continue;
      const parent = nodeMap.get(node.parentId);
      const current = nodeMap.get(node.nodeId);
      if (parent && current) (parent.children ??= []).push(current);
    }

    // Pass 3 – prune structural wrappers & tidy tree
    const roots = nodes
      .filter((n) => !n.parentId && n.nodeId && nodeMap.has(n.nodeId))
      .map((n) => nodeMap.get(n.nodeId!)!) as RichNode[];

    const cleanedRoots = (
      await Promise.all(
        roots.map((n) => this.cleanStructuralNodes(n, tagNameMap))
      )
    ).filter(Boolean) as AccessibilityNode[];

    // Pretty outline for logging / LLM input
    const simplified = cleanedRoots.map(formatSimplifiedTree).join('\n');

    return {
      tree: cleanedRoots,
      simplified,
      iframes: iframeList,
      idToUrl,
      xpathMap: xpathMap || {},
    };
  }

  /**
   * Recursively prune or collapse structural nodes in the AX tree to simplify hierarchy.
   */
  private async cleanStructuralNodes(
    node: AccessibilityNode & { encodedId?: EncodedId },
    tagNameMap: Record<EncodedId, string>
  ): Promise<AccessibilityNode | null> {
    // Ignore negative pseudo-nodes
    if (!node.nodeId || +node.nodeId < 0) return null;

    // Leaf check
    if (!node.children?.length) {
      return node.role === 'generic' || node.role === 'none' ? null : node;
    }

    // Recurse into children
    const cleanedChildren = (
      await Promise.all(
        node.children.map((c) => this.cleanStructuralNodes(c, tagNameMap))
      )
    ).filter(Boolean) as AccessibilityNode[];

    // Collapse / prune generic wrappers
    if (node.role === 'generic' || node.role === 'none') {
      if (cleanedChildren.length === 1) {
        // Collapse single-child structural node
        return cleanedChildren[0];
      } else if (cleanedChildren.length === 0) {
        // Remove empty structural node
        return null;
      }
    }

    // Replace generic role with real tag name (if we know it)
    if (
      (node.role === 'generic' || node.role === 'none') &&
      node.encodedId !== undefined
    ) {
      const tagName = tagNameMap[node.encodedId];
      if (tagName) node.role = tagName;
    }

    // Drop redundant StaticText children
    const pruned = this.removeRedundantStaticTextChildren(
      node,
      cleanedChildren
    );
    if (!pruned.length && (node.role === 'generic' || node.role === 'none')) {
      return null;
    }

    // Return updated node
    return { ...node, children: pruned };
  }

  /**
   * Resolve the CDP frame identifier for a Playwright Frame.
   */
  private async getCDPFrameId(frame?: Frame): Promise<string | undefined> {
    if (!frame || frame === this.wallCrawlerPage.mainFrame()) return undefined;

    // Same-proc search in the page-session tree
    const rootResp = (await this.wallCrawlerPage.sendCDP(
      'Page.getFrameTree'
    )) as unknown;
    const { frameTree: root } = rootResp as { frameTree: CdpFrameTree };

    const url = frame.url();
    let depth = 0;
    for (let p = frame.parentFrame(); p; p = p.parentFrame()) depth++;

    const findByUrlDepth = (
      node: CdpFrameTree,
      lvl = 0
    ): string | undefined => {
      if (lvl === depth && node.frame.url === url) return node.frame.id;
      for (const child of node.childFrames ?? []) {
        const id = findByUrlDepth(child, lvl + 1);
        if (id) return id;
      }
      return undefined;
    };

    const sameProcId = findByUrlDepth(root);
    if (sameProcId) return sameProcId; // found in page tree

    // OOPIF path: open its own target
    try {
      const sess = await this.wallCrawlerPage.context().newCDPSession(frame); // throws if detached

      const ownResp = (await sess.send('Page.getFrameTree')) as unknown;
      const { frameTree } = ownResp as { frameTree: CdpFrameTree };

      return frameTree.frame.id; // root of OOPIF
    } catch (err) {
      throw new WallCrawlerIframeError(url, String(err));
    }
  }

  /**
   * Filter an accessibility tree to include only the subtree under a specific XPath root.
   */
  private async filterAXTreeByXPath(
    full: AXNode[],
    xpath: string,
    targetFrame?: Frame
  ): Promise<AXNode[]> {
    // Resolve the backendNodeId for the element at the provided XPath
    const objectId = await this.resolveObjectIdForXPath(xpath, targetFrame);
    // Describe the DOM node to retrieve its backendNodeId via CDP
    const { node } = await this.wallCrawlerPage.sendCDP<{
      node: { backendNodeId: number };
    }>('DOM.describeNode', { objectId }, targetFrame);

    // Throw if unable to get a backendNodeId for the XPath target
    if (!node?.backendNodeId) {
      throw new WallCrawlerDomProcessError(
        `Unable to resolve backendNodeId for "${xpath}"`
      );
    }
    // Locate the corresponding AccessibilityNode in the full tree
    const target = full.find((n) => n.backendDOMNodeId === node.backendNodeId)!;

    // Initialize BFS: collect the target node and its descendants
    const keep = new Set<string>([target.nodeId]);
    const queue = [target];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const id of cur.childIds ?? []) {
        if (keep.has(id)) continue;
        keep.add(id);
        const child = full.find((n) => n.nodeId === id);
        if (child) queue.push(child);
      }
    }
    // Return only nodes in the keep set, unsetting parentId for the new root
    return full
      .filter((n) => keep.has(n.nodeId))
      .map((n) => {
        if (n.nodeId === target.nodeId) {
          const { parentId, ...rest } = n;
          return rest;
        }
        return n;
      });
  }

  /**
   * Decorate AX nodes by marking scrollable elements in their role property.
   */
  private decorateRoles(
    nodes: AXNode[],
    scrollables: Set<number>
  ): AccessibilityNode[] {
    return nodes.map((n) => {
      // Extract the base role from the AX node
      let role = n.role?.value ?? '';

      // Prepend "scrollable" to roles of nodes identified as scrollable
      if (scrollables.has(n.backendDOMNodeId!)) {
        role =
          role && role !== 'generic' && role !== 'none'
            ? `scrollable, ${role}`
            : 'scrollable';
      }

      // Construct the AccessibilityNode with decorated role and existing properties
      return {
        role,
        ...(n.name?.value ? { name: n.name.value } : {}),
        ...(n.description?.value ? { description: n.description.value } : {}),
        ...(n.value?.value ? { value: n.value.value } : {}),
        ...(n.nodeId ? { nodeId: n.nodeId } : {}),
        ...(n.backendDOMNodeId !== undefined ? { backendDOMNodeId: n.backendDOMNodeId } : {}),
        ...(n.parentId ? { parentId: n.parentId } : {}),
        ...(n.childIds ? { childIds: n.childIds } : {}),
        ...(n.properties ? { properties: n.properties } : {}),
      };
    });
  }

  /**
   * Find scrollable element IDs in the DOM.
   */
  private async findScrollableElementIds(
    targetFrame?: Frame
  ): Promise<Set<number>> {
    // JS runs inside the right browsing context
    const xpaths: string[] = targetFrame
      ? await targetFrame.evaluate(() =>
          (window as any).getScrollableElementXpaths()
        )
      : await this.wallCrawlerPage.evaluate(() =>
          (window as any).getScrollableElementXpaths()
        );

    const backendIds = new Set<number>();

    for (const xpath of xpaths) {
      if (!xpath) continue;

      const objectId = await this.resolveObjectIdForXPath(xpath, targetFrame);

      if (objectId) {
        const { node } = await this.wallCrawlerPage.sendCDP<{
          node?: { backendNodeId?: number };
        }>('DOM.describeNode', { objectId }, targetFrame);
        if (node?.backendNodeId) backendIds.add(node.backendNodeId);
      }
    }
    return backendIds;
  }

  /**
   * Resolve an XPath to a Chrome-DevTools-Protocol (CDP) remote-object ID.
   */
  private async resolveObjectIdForXPath(
    xpath: string,
    targetFrame?: Frame
  ): Promise<string | null> {
    const { result } = await this.wallCrawlerPage.sendCDP<{
      result?: { objectId?: string };
    }>(
      'Runtime.evaluate',
      {
        expression: `
          (() => {
            const res = document.evaluate(
              ${JSON.stringify(xpath)},
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            return res.singleNodeValue;
          })();
        `,
        returnByValue: false,
      },
      targetFrame
    );
    if (!result?.objectId) throw new ElementNotFoundError(xpath);
    return result.objectId;
  }

  /**
   * Extract the URL string from an AccessibilityNode's properties, if present.
   */
  private extractUrlFromAccessibilityNode(
    AccessibilityNode: AccessibilityNode
  ): string | undefined {
    // Exit early if there are no properties on this node
    if (!AccessibilityNode.properties) return undefined;

    // Find a property named 'url'
    const urlProp = AccessibilityNode.properties.find(
      (prop) => prop.name === 'url'
    );
    // Return the trimmed URL string if the property exists and is valid
    if (urlProp && urlProp.value && typeof urlProp.value.value === 'string') {
      return urlProp.value.value.trim();
    }
    return undefined;
  }

  /**
   * Remove StaticText children whose combined text matches the parent's accessible name.
   */
  private removeRedundantStaticTextChildren(
    parent: AccessibilityNode,
    children: AccessibilityNode[]
  ): AccessibilityNode[] {
    // If the parent has no accessible name, there is nothing to compare
    if (!parent.name) return children;

    // Normalize and trim the parent's name for accurate string comparison
    const parentNorm = this.normaliseSpaces(parent.name).trim();
    let combinedText = '';

    // Concatenate all StaticText children's normalized names
    for (const child of children) {
      if (child.role === 'StaticText' && child.name) {
        combinedText += this.normaliseSpaces(child.name).trim();
      }
    }

    // If combined StaticText equals the parent's name, filter them out
    if (combinedText === parentNorm) {
      return children.filter((c) => c.role !== 'StaticText');
    }
    return children;
  }

  /**
   * Collapse consecutive whitespace characters into single ASCII spaces.
   */
  private normaliseSpaces(s: string): string {
    // Initialize output buffer and state flag for whitespace grouping
    let out = '';
    let inWs = false;

    // Iterate through each character of the input string
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      const isWs = ch === 32 || ch === 9 || ch === 10 || ch === 13;

      if (isWs) {
        // If this is the first whitespace in a sequence, append a single space
        if (!inWs) {
          out += ' ';
          inWs = true;
        }
      } else {
        // Non-whitespace character: append it and reset whitespace flag
        out += s[i];
        inWs = false;
      }
    }

    return out;
  }

  /**
   * Retrieve and merge accessibility trees for the main document and nested iframes.
   */
  private async getAccessibilityTreeWithFramesInternal(
    rootXPath?: string
  ): Promise<CombinedA11yResult> {
    // Main-frame bookkeeping
    const main = this.wallCrawlerPage.mainFrame();

    // "Focus XPath" → frame chain + inner XPath
    let targetFrames: Frame[] | undefined; // full chain, main-first
    let innerXPath: string | undefined;

    if (rootXPath?.trim()) {
      const { frames, rest } = await this.resolveFrameChain(rootXPath.trim());
      targetFrames = frames.length ? frames : undefined; // empty → undefined
      innerXPath = rest;
    }

    const mainOnlyFilter = !!innerXPath && !targetFrames;

    // Depth-first walk – collect snapshots
    const snapshots: FrameSnapshot[] = [];
    const frameStack: Frame[] = [main];

    while (frameStack.length) {
      const frame = frameStack.pop()!;

      // Unconditional: enqueue children so we can reach deep targets
      frame.childFrames().forEach((c) => frameStack.push(c));

      // Skip frames that are outside the requested chain / slice
      if (targetFrames && !targetFrames.includes(frame)) continue;
      if (!targetFrames && frame !== main && innerXPath) continue;

      // Selector to forward (unchanged)
      const selector = targetFrames
        ? frame === targetFrames[targetFrames.length - 1]
          ? innerXPath
          : undefined
        : frame === main
          ? innerXPath
          : undefined;

      try {
        const res = await this.getAccessibilityTree(selector, frame);

        // Guard: main frame has no backendNodeId
        const backendId =
          frame === main ? null : await this.getFrameRootBackendNodeId(frame);

        const frameXpath =
          frame === main ? '/' : await this.getFrameRootXpath(frame);

        // Resolve the CDP frameId for this Playwright Frame (undefined for main)
        const frameId = await this.getCDPFrameId(frame);

        snapshots.push({
          tree: res.simplified.trimEnd(),
          xpathMap: res.xpathMap as Record<EncodedId, string>,
          urlMap: res.idToUrl as Record<string, string>,
          frameXpath: frameXpath,
          backendNodeId: backendId,
          parentFrame: frame.parentFrame(),
          ...(frameId ? { frameId } : {}),
        });

        if (mainOnlyFilter) break; // nothing else to fetch
      } catch (err) {
        logger.warn(
          `Failed to get AX tree for ${
            frame === main ? 'main frame' : `iframe (${frame.url()})`
          }`,
          err instanceof Error
            ? { error: err.message, stack: err.stack }
            : { error: String(err) }
        );
      }
    }

    // Merge per-frame maps
    const combinedXpathMap: Record<EncodedId, string> = {};
    const combinedUrlMap: Record<EncodedId, string> = {};

    const seg = new Map<Frame | null, string>();
    for (const s of snapshots) seg.set(s.parentFrame || null, s.frameXpath);

    /* recursively build the full prefix for a frame */
    function fullPrefix(f: Frame | null): string {
      if (!f) return ''; // reached main
      const parent = f.parentFrame();
      const above = fullPrefix(parent || null);
      const hop = seg.get(parent || null) ?? '';
      return hop === '/'
        ? above
        : above
          ? `${above.replace(/\/$/, '')}/${hop.replace(/^\//, '')}`
          : hop;
    }

    for (const snap of snapshots) {
      const prefix =
        snap.frameXpath === '/'
          ? ''
          : `${fullPrefix(snap.parentFrame || null)}${snap.frameXpath}`;

      for (const [enc, local] of Object.entries(snap.xpathMap) as [
        EncodedId,
        string,
      ][]) {
        combinedXpathMap[enc] =
          local === ''
            ? prefix || '/'
            : prefix
              ? `${prefix.replace(/\/$/, '')}/${local.replace(/^\//, '')}`
              : local;
      }
      Object.assign(combinedUrlMap, snap.urlMap);
    }

    // EncodedId → subtree map (skip main)
    const idToTree = new Map<EncodedId, string>();
    for (const { backendNodeId, frameId, tree } of snapshots)
      if (backendNodeId !== null && frameId !== undefined)
        // ignore main frame and snapshots without a CDP frameId
        idToTree.set(
          this.wallCrawlerPage.encodeWithFrameId(
            frameId,
            backendNodeId
          ) as EncodedId,
          tree
        );

    // Stitch everything together
    const rootSnap = snapshots.find((s) => s.frameXpath === '/');
    const combinedTree = rootSnap
      ? this.injectSubtrees(rootSnap.tree, idToTree)
      : (snapshots[0]?.tree ?? '');

    return { combinedTree, combinedXpathMap, combinedUrlMap };
  }

  /**
   * Get the backendNodeId of the iframe element that contains a given Playwright.Frame.
   */
  private async getFrameRootBackendNodeId(
    frame: Frame | undefined
  ): Promise<number | null> {
    // Return null for top-level or undefined frames
    if (!frame || frame === this.wallCrawlerPage.mainFrame()) {
      return null;
    }

    // Create a CDP session on the main page context
    const cdp = await this.wallCrawlerPage
      .context()
      .newCDPSession(this.wallCrawlerPage);
    // Resolve the CDP frameId for the target iframe frame
    const fid = await this.getCDPFrameId(frame);
    if (!fid) {
      return null;
    }

    // Retrieve the DOM node that owns the frame via CDP
    const { backendNodeId } = (await cdp.send('DOM.getFrameOwner', {
      frameId: fid,
    })) as FrameOwnerResult;

    return backendNodeId ?? null;
  }

  /**
   * Compute the absolute XPath for the iframe element hosting a given Playwright.Frame.
   */
  private async getFrameRootXpath(frame: Frame | undefined): Promise<string> {
    // Return root path when no frame context is provided
    if (!frame) {
      return '/';
    }
    // Obtain the element handle of the iframe in the embedding document
    const handle = await frame.frameElement();
    // Evaluate the element's absolute XPath within the page context
    return handle.evaluate((node: Element) => {
      const pos = (el: Element) => {
        let i = 1;
        for (
          let sib = el.previousElementSibling;
          sib;
          sib = sib.previousElementSibling
        )
          if (sib.tagName === el.tagName) i += 1;
        return i;
      };
      const segs: string[] = [];
      for (let el: Element | null = node; el; el = el.parentElement)
        segs.unshift(`${el.tagName.toLowerCase()}[${pos(el)}]`);
      return `/${segs.join('/')}`;
    });
  }

  /**
   * Inject simplified subtree outlines into the main frame outline for nested iframes.
   */
  private injectSubtrees(
    tree: string,
    idToTree: Map<EncodedId, string>
  ): string {
    /**  Return the *only* EncodedId that ends with this backend-id.
     *   If several frames share that backend-id we return undefined
     *   (avoids guessing the wrong subtree). */
    const uniqueByBackend = (backendId: number): EncodedId | undefined => {
      let found: EncodedId | undefined;
      let hit = 0;
      for (const enc of Array.from(idToTree.keys())) {
        const [, b] = enc.split('-'); // "ff-bbb"
        if (+b === backendId) {
          if (++hit > 1) return; // collision → abort
          found = enc;
        }
      }
      return hit === 1 ? found : undefined;
    };

    interface StackFrame {
      lines: string[];
      idx: number;
      indent: string;
    }

    const stack: StackFrame[] = [
      { lines: tree.split('\n'), idx: 0, indent: '' },
    ];
    const out: string[] = [];
    const visited = new Set<EncodedId>(); // avoid infinite loops

    // Depth-first injection walk
    while (stack.length) {
      const top = stack[stack.length - 1];

      if (top.idx >= top.lines.length) {
        stack.pop();
        continue;
      }

      const raw = top.lines[top.idx++];
      const line = top.indent + raw;
      out.push(line);

      // Grab whatever sits inside the first brackets, e.g. "[0-42]" or "[42]"
      const m = /^\s*\[([^\]]+)]/.exec(raw);
      if (!m) continue;

      const label = m[1]; // could be "1-13"   or "13"
      let enc: EncodedId | undefined;
      let child: string | undefined;

      // 1 exact match ("<ordinal>-<backend>") or fallback by backend ID
      if (idToTree.has(label as EncodedId)) {
        enc = label as EncodedId;
        child = idToTree.get(enc);
      } else {
        // Attempt to extract backendId from "<ordinal>-<backend>" or pure numeric label
        let backendId: number | undefined;
        const dashMatch = ID_PATTERN.exec(label);
        if (dashMatch) {
          backendId = +dashMatch[0].split('-')[1];
        } else if (/^\d+$/.test(label)) {
          backendId = +label;
        }
        if (backendId !== undefined) {
          const alt = uniqueByBackend(backendId);
          if (alt) {
            enc = alt;
            child = idToTree.get(alt);
          }
        }
      }

      if (!enc || !child || visited.has(enc)) continue;

      visited.add(enc);
      stack.push({
        lines: child.split('\n'),
        idx: 0,
        indent: (line.match(/^\s*/)?.[0] ?? '') + '  ',
      });
    }

    return out.join('\n');
  }

  /**
   * Resolve a chain of iframe frames from an absolute XPath.
   */
  private async resolveFrameChain(
    absPath: string // must start with '/'
  ): Promise<{ frames: Frame[]; rest: string }> {
    let path = absPath.startsWith('/') ? absPath : '/' + absPath;
    let ctxFrame: Frame | undefined = undefined; // current frame
    const chain: Frame[] = []; // collected frames

    while (true) {
      /*  Does the whole path already resolve inside the current frame?  */
      try {
        await this.resolveObjectIdForXPath(path, ctxFrame);
        return { frames: chain, rest: path }; // we're done
      } catch {
        /* keep walking */
      }

      /*  Otherwise: accumulate steps until we include an <iframe> step  */
      const steps = path.split('/').filter(Boolean);
      const buf: string[] = [];

      for (let i = 0; i < steps.length; i++) {
        buf.push(steps[i]);

        if (IFRAME_STEP_RE.test(steps[i])) {
          // "/…/iframe[k]" found – descend into that frame
          const selector = 'xpath=/' + buf.join('/');
          const handle = (ctxFrame ?? this.wallCrawlerPage.mainFrame()).locator(
            selector
          );
          const frame = await handle
            .elementHandle()
            .then((h) => h?.contentFrame());

          if (!frame) throw new ContentFrameNotFoundError(selector);

          chain.push(frame);
          ctxFrame = frame;
          path = '/' + steps.slice(i + 1).join('/'); // remainder
          break;
        }

        // Last step processed – but no iframe found  →  dead-end
        if (i === steps.length - 1) {
          throw new XPathResolutionError(absPath);
        }
      }
    }
  }
}

// Add helper functions to page context
declare global {
  interface Window {
    generateSelector(element: Element): string;
    generateXPath(element: Element): string;
    isInteractive(element: Element): boolean;
    getAttributes(element: Element): Record<string, string>;
    getScrollableElementXpaths(): string[];
  }
}
