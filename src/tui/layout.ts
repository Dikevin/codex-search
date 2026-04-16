import type { SearchSessionGroup } from "../search/session-reader.js";
import type { TuiState } from "./types.js";

export interface PanelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TUI_LAYOUT = {
  wideDetailsMinWidth: 78,
  panelGap: " │ ",
  panelMinWidth: 56,
  panelMinHeight: 12,
  stackedListRatio: 0.35,
  minStackedListHeight: 3,
  detailMetadataTitleMinHeight: 2,
  detailMetadataIdMinHeight: 3,
  detailMetadataActionMinHeight: 4,
  detailMetadataCwdMinHeight: 9,
  detailMetadataFilePathMinHeight: 10,
  sideBySideListRatio: 0.4,
  minSideBySideListWidth: 30,
  minSideBySideDetailWidth: 28,
} as const;

export function computePanelFrame(width: number, height: number): PanelFrame {
  let horizontalMargin = width >= 150 ? 4 : width >= 110 ? 2 : width >= 80 ? 1 : 0;
  let verticalMargin = height >= 36 ? 2 : height >= 22 ? 1 : 0;

  while (width - (horizontalMargin * 2) < TUI_LAYOUT.panelMinWidth && horizontalMargin > 0) {
    horizontalMargin -= 1;
  }

  while (height - (verticalMargin * 2) < TUI_LAYOUT.panelMinHeight && verticalMargin > 0) {
    verticalMargin -= 1;
  }

  return {
    x: horizontalMargin,
    y: verticalMargin,
    width: Math.max(4, width - (horizontalMargin * 2)),
    height: Math.max(4, height - (verticalMargin * 2)),
  };
}

export function getPanelContentSize(width: number, height: number): { width: number; height: number } {
  const frame = computePanelFrame(width, height);
  return {
    width: Math.max(1, frame.width - 2),
    height: Math.max(1, frame.height - 2),
  };
}

export function getBodyHeight(height: number): number {
  return Math.max(3, height - 6);
}

export function usesWideDetailsLayout(width: number): boolean {
  return width >= TUI_LAYOUT.wideDetailsMinWidth;
}

export function getStackedListHeight(bodyHeight: number, sessionCount: number): number {
  return Math.min(
    sessionCount,
    Math.max(TUI_LAYOUT.minStackedListHeight, Math.floor(bodyHeight * TUI_LAYOUT.stackedListRatio)),
  );
}

export function getSideBySidePaneWidths(width: number): { leftWidth: number; rightWidth: number } {
  const gapWidth = TUI_LAYOUT.panelGap.length;
  const availableWidth = Math.max(1, width - gapWidth);
  const proposedLeft = Math.floor(availableWidth * TUI_LAYOUT.sideBySideListRatio);
  const maxLeft = Math.max(TUI_LAYOUT.minSideBySideListWidth, availableWidth - TUI_LAYOUT.minSideBySideDetailWidth);
  const leftWidth = Math.max(
    TUI_LAYOUT.minSideBySideListWidth,
    Math.min(proposedLeft, maxLeft),
  );
  const rightWidth = Math.max(TUI_LAYOUT.minSideBySideDetailWidth, width - leftWidth - gapWidth);

  return { leftWidth, rightWidth };
}

export function getDetailMetadataLineCount(
  height: number,
  options: { hasCwd: boolean; hasActionLine: boolean; hasFilePath: boolean },
): number {
  let lines = 1;

  if (height >= TUI_LAYOUT.detailMetadataTitleMinHeight) {
    lines += 1;
  }

  if (height >= TUI_LAYOUT.detailMetadataIdMinHeight) {
    lines += 1;
  }

  if (options.hasActionLine && height >= TUI_LAYOUT.detailMetadataActionMinHeight) {
    lines += 1;
  }

  if (options.hasCwd && height >= TUI_LAYOUT.detailMetadataCwdMinHeight) {
    lines += 1;
  }

  if (options.hasFilePath && height >= TUI_LAYOUT.detailMetadataFilePathMinHeight) {
    lines += 1;
  }

  return Math.min(height, lines);
}

export function getDetailPanelHeightForLayout(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  height: number,
): number {
  const expanded = sessions.some((session) => session.sessionId === state.expandedSessionId);
  if (!expanded) {
    return 0;
  }

  const bodyHeight = getBodyHeight(height);
  if (usesWideDetailsLayout(width)) {
    return bodyHeight;
  }

  const listHeight = getStackedListHeight(bodyHeight, sessions.length);
  return Math.max(0, bodyHeight - listHeight);
}

export function getDetailPreviewPageStep(detailHeight: number, hasCwd = true): number {
  const previewHeight = Math.max(0, detailHeight - getDetailMetadataLineCount(detailHeight, {
    hasCwd,
    hasActionLine: true,
    hasFilePath: true,
  }));
  return Math.max(1, Math.floor(previewHeight / 4));
}
