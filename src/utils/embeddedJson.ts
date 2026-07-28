/**
 * HTML の <script> 内に埋め込まれた JSON オブジェクトを取り出す
 *
 * 多くの論文サイトは SPA 化しており、DOM を舐めるより
 * サーバーが埋め込んだ状態オブジェクトを読む方が遥かに安定する。
 * （例: IEEE Xplore の `xplGlobal.document.metadata`）
 */

/**
 * `marker` の直後に現れる最初の JSON オブジェクトを、対応する `}` まで切り出す
 *
 * 文字列リテラル内の波括弧とエスケープを考慮するため、
 * 単純な正規表現ではなく手書きで走査する。
 *
 * @returns 切り出した JSON 文字列。見つからなければ null
 */
export function extractJsonObjectAfter(source: string, marker: string): string | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;

  const start = source.indexOf("{", markerIndex + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  // 対応する閉じ括弧が見つからない（本文が途中で打ち切られた等）
  return null;
}

/**
 * `marker` の直後の JSON オブジェクトをパースする。失敗時は null
 */
export function parseEmbeddedJsonObject<T>(source: string, marker: string): T | null {
  const json = extractJsonObjectAfter(source, marker);
  if (!json) return null;

  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
