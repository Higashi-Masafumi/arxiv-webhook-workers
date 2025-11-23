/**
 * ArXiv 論文データ
 */
export interface ArxivPaper {
  title: string;
  authors: string[];
  summary: string;
  link: string;
  publishedYear: number;
}
