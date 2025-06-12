# DOM Processing: Accessibility-First Web Automation

This directory contains Wallcrawler's DOM processing implementation, heavily inspired by and aligned with [Stagehand's accessibility-first approach](https://github.com/browserbase/stagehand).

## Overview

Rather than relying on visual screenshot analysis or raw DOM manipulation, Wallcrawler uses browser accessibility APIs as the primary interface for understanding and interacting with web pages. This approach provides more reliable, performant, and maintainable web automation.

## Key Concepts

### Why Accessibility APIs?

1. **Stability**: Accessibility trees are more stable than DOM structures or visual layouts
2. **Performance**: No need for screenshots or vision processing
3. **Semantic Understanding**: Natural focus on interactive and meaningful elements
4. **Cross-browser**: Built on web standards (accessibility APIs)
5. **Natural Filtering**: Elements without accessible names are typically not important for automation

### Architecture Components

#### 1. Accessibility Tree Extraction

- Uses Chrome DevTools Protocol (CDP) `Accessibility.getFullAXTree`
- Extracts structured representation of all interactive elements
- Supports complex scenarios including nested iframes (same-process and out-of-process)

#### 2. Element Identification System

- **EncodedId Format**: `${frameId}-${backendNodeId}` for unique identification across frame boundaries
- **Multi-Frame Support**: Handles deep iframe hierarchies with frame chain resolution
- **XPath Mapping**: Maintains XPath selectors for reliable element targeting

#### 3. Tree Processing Pipeline

```typescript
// Raw accessibility nodes from browser
const { nodes } = await sendCDP("Accessibility.getFullAXTree");

// 1. Filter nodes based on accessible names and roles
const keep = node.name?.trim() || node.childIds?.length || isInteractive(node);

// 2. Clean structural nodes (remove generic/none roles)
const cleaned = await cleanStructuralNodes(node, tagNameMap);

// 3. Build hierarchical tree with XPath mappings
const tree = await buildHierarchicalTree(nodes, tagNameMap, xpathMap);
```

## Core Filtering Logic

### What Gets Kept

Elements are included if they have:

1. **Accessible Name** (`node.name`) - from any source:

   - `aria-label` attribute
   - `aria-labelledby` references
   - Associated `<label>` elements
   - Element text content
   - `alt` attribute (images)
   - `title` attribute
   - `placeholder` attribute (inputs)
   - `value` attribute (certain inputs)

2. **Child Elements** (`node.childIds?.length`)
3. **Interactive Roles** (not "none", "generic", or "InlineTextBox")

### What Gets Filtered Out

Elements are discarded if they:

- Have no accessible name AND no children AND have generic/none roles
- Are structural wrappers (`<div>`, `<span>`) without semantic value
- Are redundant StaticText nodes that duplicate parent names

## Browser Accessible Name Calculation

The browser follows the [W3C Accessible Name and Description Computation specification](https://www.w3.org/TR/accname-1.1/) with this priority:

1. **`aria-labelledby`** - Highest priority
2. **`aria-label`** - Direct label
3. **Associated `<label>` elements** - For form controls
4. **Element's text content** - For buttons, links, headings
5. **`alt` attribute`** - For images
6. **`title` attribute`** - Tooltip text
7. **`placeholder` attribute`** - For inputs
8. **`value` attribute`** - For certain input types

## Examples

### ✅ Elements That Will Be Detected

```html
<!-- Has aria-label -->
<div onclick="submit()" aria-label="Submit form">
  <i class="fas fa-submit"></i>
</div>

<!-- Has text content -->
<button onclick="submit()">Submit</button>

<!-- Has alt text -->
<img src="submit.png" onclick="submit()" alt="Submit" />

<!-- Has title attribute -->
<div onclick="submit()" title="Submit form">
  <i class="icon"></i>
</div>
```

### ❌ Elements That Will Be Filtered Out

```html
<!-- No accessible name -->
<div onclick="submit()">
  <i class="fas fa-submit"></i>
</div>

<!-- Image without alt text -->
<img src="submit.png" onclick="submit()" />

<!-- Generic wrapper with no semantic value -->
<div class="container">
  <span class="icon"></span>
</div>
```

## Multi-Frame Support

### Frame Chain Resolution

Wallcrawler handles complex iframe scenarios:

```typescript
// Resolves XPath like: /html/body/iframe[1]/html/body/iframe[2]/div[@id='target']
const { frames, rest } = await resolveFrameChain(xpath);
// frames: [iframe1, iframe2]
// rest: /div[@id='target']
```

### Frame Types

1. **Same-Process Iframes**: Share the main page's CDP session
2. **Out-of-Process Iframes (OOPIF)**: Require separate CDP sessions
3. **Nested Iframes**: Supported through recursive frame walking

### Combined Tree Generation

```typescript
// 1. Extract accessibility trees from each frame
const snapshots = await Promise.all(
  frames.map((frame) => getAccessibilityTree(frame))
);

// 2. Build XPath mappings with frame prefixes
combinedXpathMap[encodedId] = `${framePrefix}${localXpath}`;

// 3. Inject iframe subtrees into main tree outline
const combinedTree = injectSubtrees(mainTree, iframeSubtrees);
```

## Integration Points

### For Observation (`observe()`)

1. Extract accessibility tree from page
2. Send structured element data to LLM
3. LLM identifies relevant interactive elements
4. Return elements with XPath selectors

### For Action (`act()`)

1. Use accessibility tree to understand page structure
2. LLM determines target element based on instruction
3. Convert element ID back to XPath selector
4. Execute Playwright action

### For Extraction (`extract()`)

1. Provide structured page content to LLM
2. Use accessibility tree as foundation for content understanding
3. Extract structured data with semantic context

## Performance Considerations

### Caching Strategy

- **XPath Maps**: Cached per frame to avoid recomputation
- **Accessibility Trees**: Cached with DOM settle detection
- **EncodedId Mappings**: Persistent across operations

### Optimization Techniques

1. **Lazy Loading**: Only fetch accessibility data when needed
2. **Incremental Updates**: Re-use cached data when DOM hasn't changed
3. **Parallel Processing**: Fetch multiple frame trees concurrently
4. **Memory Management**: Clear old cached data to prevent leaks

## Error Handling

### Common Failure Scenarios

1. **Detached Frames**: Handle iframe lifecycle issues
2. **CDP Disconnection**: Graceful degradation and retry logic
3. **XPath Resolution Failures**: Fallback to alternative selectors
4. **Accessibility Tree Corruption**: Validation and error recovery

### Fallback Mechanisms

```typescript
// Primary: EncodedId-based selection
if (encodedId && xpathMap[encodedId]) {
  return xpathMap[encodedId];
}

// Fallback: Backend ID matching
const backendId = extractBackendId(encodedId);
return findElementByBackendId(backendId);
```

## Files in This Directory

- **`processor.ts`**: Main DOM processing class with accessibility tree extraction
- **`selector.ts`**: XPath and CSS selector generation utilities
- **`README.md`**: This documentation file

## Related Resources

- [Stagehand Documentation](https://docs.stagehand.dev)
- [W3C Accessible Name Computation](https://www.w3.org/TR/accname-1.1/)
- [Chrome DevTools Protocol - Accessibility](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/)
- [Playwright Accessibility Testing](https://playwright.dev/docs/accessibility-testing)
