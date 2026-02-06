---
name: Make TSX components visible - flat areas only
overview: Fix SubtitleDisplayArea and AdditionalInformationArea to be visible flat components. Remove all "panel" thinking and the applyLayout function. Components are present in DOM waiting for dimensions.
todos:
  - id: fix-subtitle-area-positioning
    content: Set position fixed in SubtitleDisplayArea.tsx - it's a flat component that needs height
    status: pending
  - id: fix-additional-area-positioning
    content: Set position fixed in AdditionalInformationArea.tsx - it's a flat component that needs width
    status: pending
  - id: remove-panel-thinking-content
    content: Remove all "panel" variable names and comments from content.ts - use subtitleDisplayArea/additionalInformationArea
    status: pending
  - id: remove-applylayout-replace-with-direct-code
    content: Delete applyLayout function - replace with direct inline: calculateLayout(), get dimensions, apply styles
    status: pending
isProject: false
---

There are 3 flat areas at z-index 0:
1. Netflix video area (handles itself)
2. SubtitleDisplayArea.tsx (flat component with text field, needs height)
3. AdditionalInformationArea.tsx (flat component, empty for now, needs width)

Flow: Components are created and present in DOM (with 0 dimensions). Call `calculateLayout()` to get numbers, then apply dimensions directly. No applyLayout function.

## Changes to `extension/components/SubtitleDisplayArea.tsx`:

Line 60: Change `position: 'relative'` to `position: 'fixed'`
- Add `bottom: '0'`
- Add `left: '0'`
- Add `height: '0px'` initially
- Keep `display: 'block'`

Component is present in DOM, waiting for height to inflate.

## Changes to `extension/components/AdditionalInformationArea.tsx`:

Line 41: Change `position: 'relative'` to `position: 'fixed'`
- Add `right: '0'`
- Add `top: '0'`
- Add `width: '0px'` initially
- Keep `display: 'block'`

Component is present in DOM, waiting for width to inflate.

## Changes to `extension/content.ts`:

Remove all "panel" thinking and DELETE the applyLayout function:

1. **Lines 19-20**: Rename variables:
   - `bottomPanel` → `subtitleDisplayArea`
   - `rightPanel` → `additionalInformationArea`

2. **Lines 116-132**: Update cleanup queries - remove "panel" comments

3. **Lines 139-140**: Update variable names:
   - `actualBottomPanel` → `subtitleDisplayArea`
   - `actualRightPanel` → `additionalInformationArea`

4. **Line 143**: Update error message - "Areas not created"

5. **Lines 177-178**: Update variable assignments

6. **Lines 180-221**: DELETE the entire `applyLayout` function. Replace with direct inline code:
   ```typescript
   if (!videoContainer || !videoElement || !subtitleDisplayArea || !additionalInformationArea) return;
   
   calculateLayout(videoElement, videoContainer);
   
   const netflix = getNetflixDimensions();
   const bottomHeight = getBottomHeight();
   const rightWidth = getRightWidth();
   
   // Apply to video container
   videoContainer.style.setProperty('width', `${netflix.width}px`, 'important');
   videoContainer.style.setProperty('height', `${netflix.height}px`, 'important');
   videoContainer.style.setProperty('position', 'fixed', 'important');
   videoContainer.style.setProperty('left', '0', 'important');
   videoContainer.style.setProperty('top', `${netflix.top}px`, 'important');
   videoContainer.style.setProperty('margin', '0', 'important');
   videoContainer.style.setProperty('transform', 'none', 'important');
   videoContainer.style.setProperty('overflow', 'visible', 'important');
   videoContainer.style.setProperty('clip-path', 'none', 'important');
   
   if (videoElement) {
     videoElement.style.width = '100%';
     videoElement.style.height = '100%';
     videoElement.style.objectFit = 'contain';
     videoElement.style.objectPosition = 'center';
   }
   
   // Apply to SubtitleDisplayArea (only height, positioning already set by component)
   subtitleDisplayArea.style.setProperty('height', `${bottomHeight}px`, 'important');
   subtitleDisplayArea.style.setProperty('right', `${rightWidth}px`, 'important');
   
   // Apply to AdditionalInformationArea (only width, positioning already set by component)
   additionalInformationArea.style.setProperty('width', `${rightWidth}px`, 'important');
   additionalInformationArea.style.setProperty('top', `${netflix.top}px`, 'important');
   additionalInformationArea.style.setProperty('bottom', `${bottomHeight}px`, 'important');
   ```

7. **Lines 224-243**: Replace all `applyLayout()` calls with the direct inline code above

8. **Lines 269-270**: Update cleanup variable names

9. **Lines 372-385**: Replace inline layout code in `extractAndSave()` - same pattern: calculateLayout(), get dimensions, apply directly

10. **Lines 536-548**: Replace inline layout code in message listener - same pattern: calculateLayout(), get dimensions, apply directly

Components are present in DOM waiting. calculateLayout() gets numbers. Apply dimensions directly. No function wrapper.
