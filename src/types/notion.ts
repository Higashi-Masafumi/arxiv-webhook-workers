import type { Paper } from "./paper";

export type { Paper, PaperProvider } from "./paper";

/**
 * ArXiv 論文データ
 * @deprecated 取得元が ArXiv 以外にも広がったため {@link Paper} を使う
 */
export type ArxivPaper = Paper;
