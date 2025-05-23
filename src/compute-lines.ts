import * as diff from "diff";

const jsDiff: { [key: string]: any } = diff;

export enum DiffType {
  DEFAULT = 0,
  ADDED = 1,
  REMOVED = 2,
  CHANGED = 3,
}

// See https://github.com/kpdecker/jsdiff/tree/v4.0.1#api for more info on the below JsDiff methods
export enum DiffMethod {
  CHARS = "diffChars",
  WORDS = "diffWords",
  WORDS_WITH_SPACE = "diffWordsWithSpace",
  LINES = "diffLines",
  TRIMMED_LINES = "diffTrimmedLines",
  SENTENCES = "diffSentences",
  CSS = "diffCss",
  JSON = "diffJson",
}

export interface DiffInformation {
  value?: string | DiffInformation[];
  lineNumber?: number;
  type?: DiffType;
}

export interface LineInformation {
  left?: DiffInformation;
  right?: DiffInformation;
}

export interface ComputedLineInformation {
  lineInformation: LineInformation[];
  diffLines: number[];
}

export interface ComputedDiffInformation {
  left?: DiffInformation[];
  right?: DiffInformation[];
}

// See https://github.com/kpdecker/jsdiff/tree/v4.0.1#change-objects for more info on JsDiff
// Change Objects
export interface JsDiffChangeObject {
  added?: boolean;
  removed?: boolean;
  value?: string;
}

/**
 * Splits diff text by new line and computes final list of diff lines based on
 * conditions.
 *
 * @param value Diff text from the js diff module.
 */
const constructLines = (value: string): string[] => {
  if (value === "") return [];

  const lines = value.replace(/\n$/, "").split("\n");

  return lines;
};

/**
 * Computes word diff information in the line.
 * [TODO]: Consider adding options argument for JsDiff text block comparison
 *
 * @param oldValue Old word in the line.
 * @param newValue New word in the line.
 * @param compareMethod JsDiff text diff method from https://github.com/kpdecker/jsdiff/tree/v4.0.1#api
 */
const computeDiff = (
  oldValue: string | Record<string, unknown>,
  newValue: string | Record<string, unknown>,
  compareMethod:
    | DiffMethod
    | ((oldStr: string, newStr: string) => diff.Change[]) = DiffMethod.CHARS,
): ComputedDiffInformation => {
  const compareFunc =
    typeof compareMethod === "string" ? jsDiff[compareMethod] : compareMethod;
  const diffArray: JsDiffChangeObject[] = compareFunc(oldValue, newValue);
  const computedDiff: ComputedDiffInformation = {
    left: [],
    right: [],
  };
  
  // Ensure left and right arrays are initialized
  if (!computedDiff.left) computedDiff.left = [];
  if (!computedDiff.right) computedDiff.right = [];
  diffArray.forEach(({ added, removed, value }): DiffInformation => {
    const diffInformation: DiffInformation = {};
    if (added) {
      diffInformation.type = DiffType.ADDED;
      diffInformation.value = value;
      if (computedDiff.right) computedDiff.right.push(diffInformation);
    }
    if (removed) {
      diffInformation.type = DiffType.REMOVED;
      diffInformation.value = value;
      if (computedDiff.left) computedDiff.left.push(diffInformation);
    }
    if (!removed && !added) {
      diffInformation.type = DiffType.DEFAULT;
      diffInformation.value = value;
      if (computedDiff.right) computedDiff.right.push(diffInformation);
      if (computedDiff.left) computedDiff.left.push(diffInformation);
    }
    return diffInformation;
  });
  return computedDiff;
};

/**
 * [TODO]: Think about moving common left and right value assignment to a
 * common place. Better readability?
 *
 * Computes line wise information based in the js diff information passed. Each
 * line contains information about left and right section. Left side denotes
 * deletion and right side denotes addition.
 *
 * @param oldString Old string to compare.
 * @param newString New string to compare with old string.
 * @param disableWordDiff Flag to enable/disable word diff.
 * @param lineCompareMethod JsDiff text diff method from https://github.com/kpdecker/jsdiff/tree/v4.0.1#api
 * @param linesOffset line number to start counting from
 * @param showLines lines that are always shown, regardless of diff
 */
const computeLineInformation = (
  oldString: string | Record<string, unknown>,
  newString: string | Record<string, unknown>,
  disableWordDiff = false,
  lineCompareMethod:
    | DiffMethod
    | ((oldStr: string, newStr: string) => diff.Change[]) = DiffMethod.CHARS,
  linesOffset = 0,
  showLines: string[] = [],
): ComputedLineInformation => {
  let diffArray: Diff.Change[] = [];

  // Use diffLines for strings, and diffJson for objects...
  if (typeof oldString === "string" && typeof newString === "string") {
    diffArray = diff.diffLines(oldString, newString, {
      newlineIsToken: false,
      ignoreWhitespace: false,
      ignoreCase: false,
    });
  } else {
    diffArray = diff.diffJson(oldString, newString);
  }

  let rightLineNumber = linesOffset;
  let leftLineNumber = linesOffset;
  let lineInformation: LineInformation[] = [];
  let counter = 0;
  const diffLines: number[] = [];
  const ignoreDiffIndexes: string[] = [];
  const getLineInformation = (
    value: string,
    diffIndex: number,
    added?: boolean,
    removed?: boolean,
    evaluateOnlyFirstLine?: boolean,
  ): LineInformation[] => {
    const lines = constructLines(value);
    
    // Create a type-safe array to hold the results
    const result: LineInformation[] = [];

    return lines
      .map((line: string, lineIndex): LineInformation | null => {
        const left: DiffInformation = {};
        const right: DiffInformation = {};
        if (
          ignoreDiffIndexes.includes(`${diffIndex}-${lineIndex}`) ||
          (evaluateOnlyFirstLine && lineIndex !== 0)
        ) {
          return null;
        }
        if (added || removed) {
          let countAsChange = true;
          if (removed) {
            leftLineNumber += 1;
            left.lineNumber = leftLineNumber;
            left.type = DiffType.REMOVED;
            left.value = line || " ";
            // When the current line is of type REMOVED, check the next item in
            // the diff array whether it is of type ADDED. If true, the current
            // diff will be marked as both REMOVED and ADDED. Meaning, the
            // current line is a modification.
            const nextDiff = diffArray[diffIndex + 1];
            if (nextDiff?.added) {
              const nextDiffLines = constructLines(nextDiff.value)[lineIndex];
              if (nextDiffLines) {
                const nextDiffLineInfo = getLineInformation(
                  nextDiffLines,
                  diffIndex,
                  true,
                  false,
                  true,
                );

                const rightInfo = nextDiffLineInfo[0].right;
                if (!rightInfo) return null;
                
                const rightValue = rightInfo.value;
                const lineNumber = rightInfo.lineNumber;
                const type = rightInfo.type;

                // When identified as modification, push the next diff to ignore
                // list as the next value will be added in this line computation as
                // right and left values.
                ignoreDiffIndexes.push(`${diffIndex + 1}-${lineIndex}`);

                right.lineNumber = lineNumber;
                if (left.value === rightValue) {
                  // The new value is exactly the same as the old
                  countAsChange = false;
                  right.type = 0;
                  left.type = 0;
                  right.value = rightValue;
                } else {
                  right.type = type;
                  // Do char level diff and assign the corresponding values to the
                  // left and right diff information object.
                  if (disableWordDiff) {
                    right.value = rightValue;
                  } else {
                    const computedDiff = computeDiff(
                      line,
                      rightValue as string,
                      lineCompareMethod,
                    );
                    right.value = computedDiff.right;
                    left.value = computedDiff.left;
                  }
                }
              }
            }
          } else {
            rightLineNumber += 1;
            right.lineNumber = rightLineNumber;
            right.type = DiffType.ADDED;
            right.value = line;
          }
          if (countAsChange && !evaluateOnlyFirstLine) {
            if (!diffLines.includes(counter)) {
              diffLines.push(counter);
            }
          }
        } else {
          leftLineNumber += 1;
          rightLineNumber += 1;

          left.lineNumber = leftLineNumber;
          left.type = DiffType.DEFAULT;
          left.value = line;
          right.lineNumber = rightLineNumber;
          right.type = DiffType.DEFAULT;
          right.value = line;
        }

        if (
          showLines?.includes(`L-${left.lineNumber}`) ||
          (showLines?.includes(`R-${right.lineNumber}`) &&
            !diffLines.includes(counter))
        ) {
          diffLines.push(counter);
        }

        if (!evaluateOnlyFirstLine) {
          counter += 1;
        }
        return { right, left };
      })
      .filter((item): item is LineInformation => item !== null);
  };

  diffArray.forEach(({ added, removed, value }: diff.Change, index): void => {
    lineInformation = [
      ...lineInformation,
      ...getLineInformation(value, index, added, removed),
    ];
  });

  return {
    lineInformation,
    diffLines,
  };
};

export { computeLineInformation };
