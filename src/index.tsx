import cn from "classnames";
import * as React from "react";
import type { JSX, ReactElement } from "react";

import type { Change } from "diff";
import memoize from "memoize-one";
import { type Block, computeHiddenBlocks } from "./compute-hidden-blocks.js";
import {
  type DiffInformation,
  DiffMethod,
  DiffType,
  type LineInformation,
  computeLineInformation,
} from "./compute-lines.js";
import { Expand } from "./expand.js";
import computeStyles, {
  type ReactDiffViewerStyles,
  type ReactDiffViewerStylesOverride,
} from "./styles.js";

import { Fold } from "./fold.js";

type IntrinsicElements = JSX.IntrinsicElements;

export enum LineNumberPrefix {
  LEFT = "L",
  RIGHT = "R",
}

export interface ReactDiffViewerProps {
  // Old value to compare.
  oldValue: string | Record<string, unknown>;
  // New value to compare.
  newValue: string | Record<string, unknown>;
  // Enable/Disable split view.
  splitView?: boolean;
  // Set line Offset
  linesOffset?: number;
  // Enable/Disable word diff.
  disableWordDiff?: boolean;
  // JsDiff text diff method from https://github.com/kpdecker/jsdiff/tree/v4.0.1#api
  compareMethod?: DiffMethod | ((oldStr: string, newStr: string) => Change[]);
  // Number of unmodified lines surrounding each line diff.
  extraLinesSurroundingDiff?: number;
  // Show/hide line number.
  hideLineNumbers?: boolean;
  /**
   * Show the lines indicated here. Specified as L20 or R18 for respectively line 20 on the left or line 18 on the right.
   */
  alwaysShowLines?: string[];
  // Show only diff between the two values.
  showDiffOnly?: boolean;
  // Render prop to format final string before displaying them in the UI.
  renderContent?: (source: string) => ReactElement;
  // Render prop to format code fold message.
  codeFoldMessageRenderer?: (
    totalFoldedLines: number,
    leftStartLineNumber: number,
    rightStartLineNumber: number,
  ) => ReactElement;
  // Event handler for line number click.
  onLineNumberClick?: (
    lineId: string,
    event: React.MouseEvent<HTMLTableCellElement>,
  ) => void;
  // render gutter
  renderGutter?: (data: {
    lineNumber: number;
    type: DiffType;
    prefix: LineNumberPrefix;
    value: string | DiffInformation[];
    additionalLineNumber: number;
    additionalPrefix: LineNumberPrefix;
    styles: ReactDiffViewerStyles;
  }) => ReactElement;
  // Array of line ids to highlight lines.
  highlightLines?: string[];
  // Style overrides.
  styles?: ReactDiffViewerStylesOverride;
  // Use dark theme.
  useDarkTheme?: boolean;
  /**
   * Used to describe the thing being diffed
   */
  summary?: string | ReactElement;
  // Title for left column
  leftTitle?: string | ReactElement;
  // Title for left column
  rightTitle?: string | ReactElement;
  // Nonce
  nonce?: string;
}

export interface ReactDiffViewerState {
  // Array holding the expanded code folding.
  expandedBlocks: number[];
  noSelect?: "left" | "right";
}

class DiffViewer extends React.Component<
  ReactDiffViewerProps,
  ReactDiffViewerState
> {
  private styles: ReactDiffViewerStyles;

  public static defaultProps: ReactDiffViewerProps = {
    oldValue: "",
    newValue: "",
    splitView: true,
    highlightLines: [],
    disableWordDiff: false,
    compareMethod: DiffMethod.CHARS,
    styles: {},
    hideLineNumbers: false,
    extraLinesSurroundingDiff: 3,
    showDiffOnly: true,
    useDarkTheme: false,
    linesOffset: 0,
    nonce: "",
  };

  public constructor(props: ReactDiffViewerProps) {
    super(props);

    this.styles = this.computeStyles(
      props.styles || {},
      props.useDarkTheme || false,
      props.nonce || ""
    );

    this.state = {
      expandedBlocks: [],
      noSelect: undefined,
    };
  }

  /**
   * Resets code block expand to the initial stage. Will be exposed to the parent component via
   * refs.
   */
  public resetCodeBlocks = (): boolean => {
    if (this.state && this.state.expandedBlocks && this.state.expandedBlocks.length > 0) {
      this.setState({
        expandedBlocks: [],
      });
      return true;
    }
    return false;
  };

  /**
   * Pushes the target expanded code block to the state. During the re-render,
   * this value is used to expand/fold unmodified code.
   */
  private onBlockExpand = (id: number): void => {
    const prevState = this.state.expandedBlocks.slice();
    prevState.push(id);

    this.setState({
      expandedBlocks: prevState,
    });
  };

  /**
   * Computes final styles for the diff viewer. It combines the default styles with the user
   * supplied overrides. The computed styles are cached with performance in mind.
   *
   * @param styles User supplied style overrides.
   */
  private computeStyles: (
    styles: ReactDiffViewerStylesOverride,
    useDarkTheme: boolean,
    nonce: string,
  ) => ReactDiffViewerStyles = memoize(computeStyles);

  /**
   * Returns a function with clicked line number in the closure. Returns an no-op function when no
   * onLineNumberClick handler is supplied.
   *
   * @param id Line id of a line.
   */
  private onLineNumberClickProxy = (id: string): any => {
    if (this.props.onLineNumberClick) {
      return (e: any): void => this.props.onLineNumberClick?.(id, e);
    }
    return (): void => {};
  };

  /**
   * Maps over the word diff and constructs the required React elements to show word diff.
   *
   * @param diffArray Word diff information derived from line information.
   * @param renderer Optional renderer to format diff words. Useful for syntax highlighting.
   */
  private renderWordDiff = (
    diffArray: DiffInformation[],
    renderer?: (chunk: string) => JSX.Element,
  ): ReactElement[] => {
    return diffArray.map((wordDiff, i): JSX.Element => {
      const content = renderer
        ? renderer(wordDiff.value as string)
        : wordDiff.value;
      if (typeof content !== "string") return <></>;

      return wordDiff.type === DiffType.ADDED ? (
        <ins
          key={i}
          className={cn(this.styles.wordDiff, {
            [String(this.styles.wordAdded)]: wordDiff.type === DiffType.ADDED,
          })}
        >
          {content}
        </ins>
      ) : wordDiff.type === DiffType.REMOVED ? (
        <del
          key={i}
          className={cn(this.styles.wordDiff, {
            [String(this.styles.wordRemoved)]: wordDiff.type === DiffType.REMOVED,
          })}
        >
          {content}
        </del>
      ) : (
        <span key={i} className={cn(this.styles.wordDiff)}>
          {content}
        </span>
      );
    });
  };

  /**
   * Maps over the line diff and constructs the required react elements to show line diff. It calls
   * renderWordDiff when encountering word diff. This takes care of both inline and split view line
   * renders.
   *
   * @param lineNumber Line number of the current line.
   * @param type Type of diff of the current line.
   * @param prefix Unique id to prefix with the line numbers.
   * @param value Content of the line. It can be a string or a word diff array.
   * @param additionalLineNumber Additional line number to be shown. Useful for rendering inline
   *  diff view. Right line number will be passed as additionalLineNumber.
   * @param additionalPrefix Similar to prefix but for additional line number.
   */
  private renderLine = (
    lineNumber: number | null,
    type: DiffType,
    prefix: LineNumberPrefix,
    value: string | DiffInformation[],
    additionalLineNumber?: number | null,
    additionalPrefix?: LineNumberPrefix,
  ): ReactElement => {
    const lineNumberTemplate = lineNumber === null ? '' : `${prefix}-${lineNumber}`;
    const additionalLineNumberTemplate = additionalLineNumber === null ? '' : `${additionalPrefix}-${additionalLineNumber}`;
    const highlightLine =
      (lineNumberTemplate && this.props.highlightLines?.includes(lineNumberTemplate)) ||
      (additionalLineNumberTemplate && this.props.highlightLines?.includes(additionalLineNumberTemplate)) ||
      false;
    const added = type === DiffType.ADDED;
    const removed = type === DiffType.REMOVED;
    const changed = type === DiffType.CHANGED;
    let content;
    const hasWordDiff = Array.isArray(value);
    if (hasWordDiff) {
      content = this.renderWordDiff(value, this.props.renderContent);
    } else if (this.props.renderContent) {
      content = this.props.renderContent(value);
    } else {
      content = value;
    }

    let ElementType: keyof IntrinsicElements = "div";
    if (added && !hasWordDiff) {
      ElementType = "ins";
    } else if (removed && !hasWordDiff) {
      ElementType = "del";
    }

    return (
      <>
        {!this.props.hideLineNumbers && (
          <td
            onClick={
              lineNumber !== null && lineNumberTemplate ? this.onLineNumberClickProxy(lineNumberTemplate) : undefined
            }
            className={cn(this.styles.gutter, {
              [String(this.styles.emptyGutter)]: lineNumber === null,
              [String(this.styles.diffAdded)]: added,
              [String(this.styles.diffRemoved)]: removed,
              [String(this.styles.diffChanged)]: changed,
              [String(this.styles.highlightedGutter)]: highlightLine,
            })}
          >
            <pre className={this.styles.lineNumber}>{lineNumber}</pre>
          </td>
        )}
        {!this.props.splitView && !this.props.hideLineNumbers && (
          <td
            onClick={
              additionalLineNumber !== null && additionalLineNumberTemplate
                ? this.onLineNumberClickProxy(additionalLineNumberTemplate)
                : undefined
            }
            className={cn(this.styles.gutter, {
              [String(this.styles.emptyGutter)]: additionalLineNumber === null,
              [String(this.styles.diffAdded)]: added,
              [String(this.styles.diffRemoved)]: removed,
              [String(this.styles.diffChanged)]: changed,
              [String(this.styles.highlightedGutter)]: highlightLine,
            })}
          >
            <pre className={this.styles.lineNumber}>{additionalLineNumber}</pre>
          </td>
        )}
        {this.props.renderGutter
          ? this.props.renderGutter({
              lineNumber: lineNumber === null ? 0 : lineNumber, // renderGutter might expect a number
              type,
              prefix,
              value,
              additionalLineNumber: additionalLineNumber ?? 0, // Ensure it's a number, defaulting to 0
              additionalPrefix: additionalPrefix || LineNumberPrefix.LEFT,
              styles: this.styles,
            })
          : null}
        <td
          className={cn(this.styles.marker, {
            [String(this.styles.emptyLine)]: !content,
            [String(this.styles.diffAdded)]: added,
            [String(this.styles.diffRemoved)]: removed,
            [String(this.styles.diffChanged)]: changed,
            [String(this.styles.highlightedLine)]: highlightLine,
          })}
        >
          <pre>
            {added && "+"}
            {removed && "-"}
          </pre>
        </td>
        <td
          className={cn(this.styles.content, {
            [String(this.styles.emptyLine)]: !content,
            [String(this.styles.diffAdded)]: added,
            [String(this.styles.diffRemoved)]: removed,
            [String(this.styles.diffChanged)]: changed,
            [String(this.styles.highlightedLine)]: highlightLine,
            left: prefix === LineNumberPrefix.LEFT,
            right: prefix === LineNumberPrefix.RIGHT,
          })}
          onMouseDown={() => {
            const elements = document.getElementsByClassName(
              prefix === LineNumberPrefix.LEFT ? "right" : "left",
            );
            for (let i = 0; i < elements.length; i++) {
              const element = elements.item(i);
              if (element) {
                element.classList.add(String(this.styles.noSelect));
              }
            }
          }}
          title={
            added && !hasWordDiff
              ? "Added line"
              : removed && !hasWordDiff
                ? "Removed line"
                : undefined
          }
        >
          <ElementType className={this.styles.contentText}>
            {content}
          </ElementType>
        </td>
      </>
    );
  };

  /**
   * Generates lines for split view.
   *
   * @param obj Line diff information.
   * @param obj.left Life diff information for the left pane of the split view.
   * @param obj.right Life diff information for the right pane of the split view.
   * @param index React key for the lines.
   */
  private renderSplitView = (
    { left, right }: LineInformation,
    index: number,
  ): ReactElement => {
    return (
      <tr key={index} className={this.styles.line}>
        {this.renderLine(
          left?.lineNumber ?? null,
          left?.type ?? DiffType.DEFAULT,
          LineNumberPrefix.LEFT,
          left?.value ?? '',
        )}
        {this.renderLine(
          right?.lineNumber ?? null,
          right?.type ?? DiffType.DEFAULT,
          LineNumberPrefix.RIGHT,
          right?.value ?? '',
        )}
      </tr>
    );
  };

  /**
   * Generates lines for inline view.
   *
   * @param obj Line diff information.
   * @param obj.left Life diff information for the added section of the inline view.
   * @param obj.right Life diff information for the removed section of the inline view.
   * @param index React key for the lines.
   */
  public renderInlineView = (
    { left, right }: LineInformation,
    index: number,
  ): ReactElement => {
    let content;
    if (left?.type === DiffType.REMOVED && right?.type === DiffType.ADDED) {
      return (
        <React.Fragment key={index}>
          <tr className={this.styles.line}>
            {this.renderLine(
              left?.lineNumber ?? null,
              left?.type ?? DiffType.DEFAULT, // Default if left is undefined
              LineNumberPrefix.LEFT,
              left?.value ?? '',
              null,
            )}
          </tr>
          <tr className={this.styles.line}>
            {this.renderLine(
              null,
              right?.type ?? DiffType.DEFAULT, // Default if right is undefined
              LineNumberPrefix.RIGHT,
              right?.value ?? '',
              right?.lineNumber ?? null,
              LineNumberPrefix.RIGHT,
            )}
          </tr>
        </React.Fragment>
      );
    }
    if (left?.type === DiffType.REMOVED) {
      content = this.renderLine(
        left?.lineNumber ?? null,
        left?.type ?? DiffType.DEFAULT,
        LineNumberPrefix.LEFT,
        left?.value ?? '',
        null,
      );
    }
    if (left?.type === DiffType.DEFAULT) {
      content = this.renderLine(
        left?.lineNumber ?? null,
        left?.type ?? DiffType.DEFAULT,
        LineNumberPrefix.LEFT,
        left?.value ?? '',
        right?.lineNumber ?? null,
        LineNumberPrefix.RIGHT,
      );
    }
    if (right?.type === DiffType.ADDED) {
      content = this.renderLine(
        null,
        right?.type ?? DiffType.DEFAULT,
        LineNumberPrefix.RIGHT,
        right?.value ?? '',
        right?.lineNumber ?? null,
      );
    }

    return (
      <tr key={index} className={this.styles.line}>
        {content}
      </tr>
    );
  };

  /**
   * Returns a function with clicked block number in the closure.
   *
   * @param id Cold fold block id.
   */
  private onBlockClickProxy =
    (id: number): (() => void) =>
    (): void =>
      this.onBlockExpand(id);

  /**
   * Generates cold fold block. It also uses the custom message renderer when available to show
   * cold fold messages.
   *
   * @param num Number of skipped lines between two blocks.
   * @param blockNumber Code fold block id.
   * @param leftBlockLineNumber First left line number after the current code fold block.
   * @param rightBlockLineNumber First right line number after the current code fold block.
   */
  private renderSkippedLineIndicator = (
    num: number,
    blockNumber: number,
    leftBlockLineNumber: number,
    rightBlockLineNumber: number,
  ): ReactElement => {
    const { hideLineNumbers, splitView } = this.props;
    const message = this.props.codeFoldMessageRenderer ? (
      this.props.codeFoldMessageRenderer(
        num,
        leftBlockLineNumber,
        rightBlockLineNumber,
      )
    ) : (
      <span className={this.styles.codeFoldContent}>
        Expand {num} lines ...
      </span>
    );
    const content = (
      <td className={this.styles.codeFoldContentContainer}>
        <button
          type="button"
          className={this.styles.codeFoldExpandButton}
          onClick={this.onBlockClickProxy(blockNumber)}
          tabIndex={0}
        >
          {message}
        </button>
      </td>
    );
    const isUnifiedViewWithoutLineNumbers = !splitView && !hideLineNumbers;
    return (
      <tr
        key={`${leftBlockLineNumber}-${rightBlockLineNumber}`}
        className={this.styles.codeFold}
      >
        {!hideLineNumbers && <td className={this.styles.codeFoldGutter} />}
        {this.props.renderGutter ? (
          <td className={this.styles.codeFoldGutter} />
        ) : null}
        <td
          className={cn({
            [String(this.styles.codeFoldGutter)]: isUnifiedViewWithoutLineNumbers,
          })}
        />

        {/* Swap columns only for unified view without line numbers */}
        {isUnifiedViewWithoutLineNumbers ? (
          <React.Fragment>
            <td />
            {content}
          </React.Fragment>
        ) : (
          <React.Fragment>
            {content}
            {this.props.renderGutter ? <td /> : null}
            <td />
            <td />
            {!hideLineNumbers ? <td /> : null}
          </React.Fragment>
        )}
      </tr>
    );
  };

  /**
   * Generates the entire diff view.
   */
  private renderDiff = (): {
    diffNodes: ReactElement[];
    lineInformation: LineInformation[];
    blocks: Block[];
  } => {
    const {
      oldValue,
      newValue,
      splitView,
      disableWordDiff,
      compareMethod,
      linesOffset,
    } = this.props;
    const { lineInformation, diffLines } = computeLineInformation(
      oldValue,
      newValue,
      disableWordDiff,
      compareMethod,
      linesOffset,
      this.props.alwaysShowLines,
    );

    const extraLinesSurroundingDiffValue = this.props.extraLinesSurroundingDiff ?? 3;
    const extraLines =
      extraLinesSurroundingDiffValue < 0
        ? 0
        : Math.round(extraLinesSurroundingDiffValue);

    const { lineBlocks, blocks } = computeHiddenBlocks(
      lineInformation,
      diffLines,
      extraLines,
    );

    const diffNodes = lineInformation.map(
      (line: LineInformation, lineIndex: number) => {
        if (this.props.showDiffOnly) {
          const blockIndex = lineBlocks[lineIndex];

          if (blockIndex !== undefined) {
            const lastLineOfBlock = blocks[blockIndex].endLine === lineIndex;
            if (
              !this.state.expandedBlocks.includes(blockIndex) &&
              lastLineOfBlock
            ) {
              return (
                <React.Fragment key={lineIndex}>
                  {this.renderSkippedLineIndicator(
                    blocks[blockIndex].lines,
                    blockIndex,
                    line.left?.lineNumber ?? 0,
                    line.right?.lineNumber ?? 0,
                  )}
                </React.Fragment>
              );
            }
            if (!this.state.expandedBlocks.includes(blockIndex)) {
              return null;
            }
          }
        }

        return splitView
          ? this.renderSplitView(line, lineIndex)
          : this.renderInlineView(line, lineIndex);
      },
    );
    const filteredDiffNodes = diffNodes.filter(Boolean) as ReactElement[];
    return {
      diffNodes: filteredDiffNodes,
      blocks,
      lineInformation,
    };
  };

  public render = (): ReactElement => {
    const {
      oldValue,
      newValue,
      useDarkTheme,
      leftTitle,
      rightTitle,
      splitView,
      compareMethod,
      hideLineNumbers,
      nonce,
    } = this.props;

    if (
      typeof compareMethod === "string" &&
      compareMethod !== DiffMethod.JSON
    ) {
      if (typeof oldValue !== "string" || typeof newValue !== "string") {
        throw Error('"oldValue" and "newValue" should be strings');
      }
    }

    this.styles = this.computeStyles(this.props.styles || {}, useDarkTheme ?? false, nonce ?? '');
    const nodes = this.renderDiff();

    let colSpanOnSplitView = 3;
    let colSpanOnInlineView = 4;

    if (hideLineNumbers) {
      colSpanOnSplitView -= 1;
      colSpanOnInlineView -= 1;
    }

    if (this.props.renderGutter) {
      colSpanOnSplitView += 1;
      colSpanOnInlineView += 1;
    }

    let deletions = 0;
    let additions = 0;
    for (const l of nodes.lineInformation) {
      if (l.left?.type === DiffType.ADDED) {
        additions++;
      }
      if (l.right?.type === DiffType.ADDED) {
        additions++;
      }
      if (l.left?.type === DiffType.REMOVED) {
        deletions++;
      }
      if (l.right?.type === DiffType.REMOVED) {
        deletions++;
      }
    }
    const totalChanges = deletions + additions;

    const percentageAddition = Math.round((additions / totalChanges) * 100);
    const blocks: ReactElement[] = [];
    for (let i = 0; i < 5; i++) {
      if (percentageAddition > i * 20) {
        blocks.push(
          <span
            key={i}
            className={cn(this.styles.block, this.styles.blockAddition)}
          />,
        );
      } else {
        blocks.push(
          <span
            key={i}
            className={cn(this.styles.block, this.styles.blockDeletion)}
          />,
        );
      }
    }
    const allExpanded =
      this.state.expandedBlocks.length === nodes.blocks.length;

    return (
      <div>
        <div className={this.styles.summary} role={"banner"}>
          <button
            type={"button"}
            className={this.styles.allExpandButton}
            onClick={() => {
              this.setState({
                expandedBlocks: allExpanded
                  ? []
                  : nodes.blocks.map((b) => b.index),
              });
            }}
          >
            {allExpanded ? <Fold /> : <Expand />}
          </button>{" "}
          {totalChanges}
          <div style={{ display: "flex", gap: "1px" }}>{blocks}</div>
          {this.props.summary ? <span>{this.props.summary}</span> : null}
        </div>
        <table
          className={cn(this.styles.diffContainer, {
            [String(this.styles.splitView)]: splitView,
          })}
          onMouseUp={() => {
            const elements = document.getElementsByClassName("right");
            for (let i = 0; i < elements.length; i++) {
              const element = elements.item(i);
              if (element) {
                element.classList.remove(String(this.styles.noSelect)); // Also ensure style key is string
              }
            }
            const elementsLeft = document.getElementsByClassName("left");
            for (let i = 0; i < elementsLeft.length; i++) {
              const element = elementsLeft.item(i);
              if (element) {
                element.classList.remove(String(this.styles.noSelect)); // Also ensure style key is string
              }
            }
          }}
        >
          <tbody>
            <tr>
              {!this.props.hideLineNumbers ? <td width={"50px"} /> : null}
              {!splitView && !this.props.hideLineNumbers ? (
                <td width={"50px"} />
              ) : null}
              {this.props.renderGutter ? <td width={"50px"} /> : null}
              <td width={"28px"} />
              <td width={"100%"} />
              {splitView ? (
                <>
                  {!this.props.hideLineNumbers ? <td width={"50px"} /> : null}
                  {this.props.renderGutter ? <td width={"50px"} /> : null}
                  <td width={"28px"} />
                  <td width={"100%"} />
                </>
              ) : null}
            </tr>
            {leftTitle || rightTitle ? (
              <tr>
                <th
                  colSpan={splitView ? colSpanOnSplitView : colSpanOnInlineView}
                  className={cn(this.styles.titleBlock, this.styles.column)}
                >
                  {leftTitle ? (
                    <pre className={this.styles.contentText}>{leftTitle}</pre>
                  ) : null}
                </th>
                {splitView ? (
                  <th
                    colSpan={colSpanOnSplitView}
                    className={cn(this.styles.titleBlock, this.styles.column)}
                  >
                    {rightTitle ? (
                      <pre className={this.styles.contentText}>
                        {rightTitle}
                      </pre>
                    ) : null}
                  </th>
                ) : null}
              </tr>
            ) : null}
            {nodes.diffNodes}
          </tbody>
        </table>
      </div>
    );
  };
}

export default DiffViewer;
export { DiffMethod };
export type { ReactDiffViewerStylesOverride };
